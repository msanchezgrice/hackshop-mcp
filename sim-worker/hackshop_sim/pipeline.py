"""End-to-end: Assembly IR -> resolve -> compile -> control (scripted/agent) ->
rollout -> render -> artifacts on disk. Returns a JSON-able result dict.
"""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
import threading
from pathlib import Path
from typing import List, Optional

from .agent import loop as agent_loop
from .assets.resolve import resolve
from .ir import Assembly, BuildPlanIR, ComponentMedia, SimulateOptions
from .media import download_component_images
from .report import build_summary_html
from .runtime.render import render_studio, render_video
from .runtime.run import parse_success_metric, run_rollout
from .scene.compile import STUDIO_CAMERAS, compile_scene, compile_studio_scene
from .scene.schematic import build_schematic_svg

# Templates whose layout is cluttered enough to need a longer rollout than an
# open room; they get a default duration with margin so an honest success isn't
# masked by the clock. The navigable slalom reaches in ~21s, so 30s leaves ample
# margin while keeping the rendered clip under the frame cap (≈900 frames @28fps),
# so reaching clips render at full fps AND fast enough for the web poll window.
_CLUTTERED_TEMPLATES = {"obstacle-course", "stairs", "outdoor-flat"}
_CLUTTERED_DEFAULT_DURATION_S = 30.0
# Bounded/MCP cap: the pulled-in clear-pocket goal is reachable in ~10s; 12s
# gives margin for the success dwell while staying inside one tool call.
_BOUNDED_DURATION_CAP_S = 12.0


# A single machine can't safely run two OSMesa renders at once (shared GL
# context). Serialize the render-heavy section so concurrent /simulate calls
# don't corrupt each other's frames. Set HACKSHOP_SIM_RENDER_PARALLEL=1 to
# disable (e.g. if you ever move to per-process GL).
_RENDER_LOCK = threading.Lock()
_NULL_CTX = contextlib.nullcontext()


def _render_serialized() -> bool:
    return os.environ.get("HACKSHOP_SIM_RENDER_PARALLEL") not in ("1", "true", "True")


def _atomic_write_text(path: Path, text: str) -> None:
    """Write text to a temp file in the same dir, then atomically rename.

    A reader either sees the old file or the fully-written new one — never a
    half-written artifact. Same-directory temp guarantees rename() is atomic.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _atomic_finalize(tmp: Path, final: Path) -> bool:
    """Atomically move a fully-rendered temp artifact into place. Returns True
    if `final` exists afterward (the temp was produced)."""
    if tmp.exists():
        os.replace(tmp, final)
        return True
    return final.exists()


def _default_agent_enabled() -> bool:
    """Enable the builder agent by default on async jobs when a key is present.

    Evaluated at call time (not import) so tests/env changes take effect. Opt
    out with HACKSHOP_SIM_AGENT=0. The agent loop itself falls back to the
    scripted controller when the SDK/key is missing, so this is safe to leave on.
    """
    flag = os.environ.get("HACKSHOP_SIM_AGENT")
    if flag is not None:
        return flag not in ("0", "false", "False", "")
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


ARTIFACT_FILES = {
    "video": "run.mp4",
    "poster": "poster.png",
    "hero": "render_hero.png",
    "schematic": "schematic.svg",
    "summary": "summary.html",
    "telemetry": "telemetry.json",
    "trajectory": "trajectory.json",
    "control": "control.py",
    "scene": "scene.xml",
    "result": "result.json",
}


def _world_desc(assembly: Assembly, goal_xy, goal_radius) -> str:
    return (
        f"template='{assembly.world.template}', goal at "
        f"({goal_xy[0]:.2f},{goal_xy[1]:.2f}) radius {goal_radius:.2f}m. "
        f"Task: {assembly.goal.spec} Success: {assembly.goal.success_metric}"
    )


def run_pipeline(
    assembly: Assembly,
    options: SimulateOptions,
    run_dir: Path,
    build_plan: Optional[BuildPlanIR] = None,
    media: Optional[List[ComponentMedia]] = None,
) -> dict:
    run_dir.mkdir(parents=True, exist_ok=True)

    res = resolve(assembly)
    if not res.supported or res.robot is None:
        out = {
            "status": "unsupported",
            "supported": False,
            "reason": res.reason,
            "world_desc": f"template='{assembly.world.template}', goal kind='{assembly.goal.kind}'",
            "artifacts": {},
        }
        _atomic_write_text(run_dir / ARTIFACT_FILES["result"], json.dumps(out, indent=2))
        return out

    robot = res.robot
    scene = compile_scene(assembly, robot, bounded=options.bounded)
    _atomic_write_text(run_dir / ARTIFACT_FILES["scene"], scene.xml)

    # Cluttered worlds need a lot more wall-clock to clear the slalom than an
    # open room. The scripted controller needs ~44s to thread the obstacle
    # course; at the old 20s default every default run timed out short (a false
    # negative). Give cluttered templates a generous default so an honest
    # success isn't masked by the clock. Explicit larger durations are honored.
    duration = options.duration_s
    if not options.bounded and assembly.world.template in _CLUTTERED_TEMPLATES:
        duration = max(duration, _CLUTTERED_DEFAULT_DURATION_S)
    render_fps = 30.0
    width, height = 640, 480
    use_agent = options.agent
    if not options.bounded:
        # Builder agent self-corrects on async (non-bounded) jobs by default, so
        # an out-of-the-box run can improve a failing controller on its own
        # (Phase 2 acceptance). Env/key-gated: the loop falls back to scripted
        # gracefully when no ANTHROPIC_API_KEY/SDK is present. Callers can still
        # force it off with options.agent=False only if they set it explicitly;
        # absent that we opt in.
        use_agent = options.agent or _default_agent_enabled()
    if options.bounded:
        # Cap generously enough for the pulled-in bounded goal (clear pocket
        # ~2.4m at proxy speed) plus the dwell, but still small enough for one
        # tool call. Bounded stays scripted-only for latency.
        duration = min(duration, _BOUNDED_DURATION_CAP_S)
        use_agent = False
        render_fps = 25.0
        width, height = 480, 360

    world_desc = _world_desc(assembly, scene.goal_xy, scene.goal_radius)

    # Per-proposal success criteria from the free-text success_metric (e.g.
    # "within 0.3m for >2s"); run_rollout falls back to world radius / 1.0s dwell
    # for whichever part is unspecified.
    reach_radius, dwell_s = parse_success_metric(assembly.goal.success_metric)

    def runner(act):
        return run_rollout(
            scene, act, duration_s=duration, render_fps=render_fps,
            reach_radius=reach_radius, dwell_s=dwell_s,
        )

    outcome = agent_loop.build(world_desc, runner, use_agent, options.agent_max_iters)
    result = outcome.result

    # persist control + telemetry + trajectory (atomic temp+rename so a reader
    # never sees a half-written file, and a crash leaves no partial artifact).
    _atomic_write_text(run_dir / ARTIFACT_FILES["control"], outcome.control_source)
    _atomic_write_text(
        run_dir / ARTIFACT_FILES["telemetry"], json.dumps(result.telemetry, indent=2)
    )
    trajectory = {
        "fps": result.fps,
        "meta": {
            "goal_xy": list(scene.goal_xy),
            "goal_radius": scene.goal_radius,
            "start_xy": list(scene.start_xy),
            "template": scene.template,
        },
        "poses": result.poses,
        "qpos": result.frame_qpos,
    }
    _atomic_write_text(run_dir / ARTIFACT_FILES["trajectory"], json.dumps(trajectory))

    artifacts = {
        "telemetry": ARTIFACT_FILES["telemetry"],
        "trajectory": ARTIFACT_FILES["trajectory"],
        "control": ARTIFACT_FILES["control"],
        "scene": ARTIFACT_FILES["scene"],
    }

    video_rel = None
    poster_rel = None
    if options.render:
        # Render to temp files, then atomically rename into place so a concurrent
        # GET never serves a half-muxed run.mp4 / missing poster. Serialize the
        # OSMesa render so two concurrent sims don't share/corrupt the GL context.
        lock = _RENDER_LOCK if _render_serialized() else _NULL_CTX
        try:
            with lock:
                # Keep the real extension (.mp4/.png) so imageio infers the
                # right backend; just prefix with a dot to mark it temp.
                tmp_video = run_dir / (".tmp_" + ARTIFACT_FILES["video"])
                tmp_poster = run_dir / (".tmp_" + ARTIFACT_FILES["poster"])
                video_path = render_video(
                    scene.xml, result.frame_qpos, result.fps,
                    str(tmp_video), width=width, height=height,
                    poster_path=str(tmp_poster),
                )
            if video_path and _atomic_finalize(tmp_video, run_dir / ARTIFACT_FILES["video"]):
                video_rel = ARTIFACT_FILES["video"]
                artifacts["video"] = video_rel
                if _atomic_finalize(tmp_poster, run_dir / ARTIFACT_FILES["poster"]):
                    poster_rel = ARTIFACT_FILES["poster"]
                    artifacts["poster"] = poster_rel
        except Exception as e:  # pragma: no cover - render is best-effort
            print(f"[pipeline] render failed: {e}")

    # High-fidelity beauty renders (robot alone on a clean stage, multiple
    # angles). Skipped in bounded/MCP mode to keep that path snappy.
    studio_renders: dict = {}
    if options.render and not options.bounded:
        lock = _RENDER_LOCK if _render_serialized() else _NULL_CTX
        try:
            studio_xml = compile_studio_scene(assembly, robot)
            with lock:
                # render_studio writes each PNG with imageio.imwrite (single
                # write, effectively atomic at PNG sizes); the lock keeps the
                # OSMesa context single-tenant.
                studio_renders = render_studio(
                    studio_xml, STUDIO_CAMERAS, str(run_dir), prefix="render"
                )
            if studio_renders.get("hero"):
                artifacts["hero"] = studio_renders["hero"]
        except Exception as e:  # pragma: no cover - studio render is best-effort
            print(f"[pipeline] studio render failed: {e}")

    # Best-effort component photos -> local files so summary.html is shareable.
    component_images: dict = {}
    if media and not options.bounded:
        try:
            component_images = download_component_images(media, run_dir)
        except Exception as e:  # pragma: no cover - media is best-effort
            print(f"[pipeline] media fetch failed: {e}")

    # Wiring schematic (pure SVG, always cheap).
    schematic_svg = None
    try:
        schematic_svg = build_schematic_svg(assembly)
        _atomic_write_text(run_dir / ARTIFACT_FILES["schematic"], schematic_svg)
        artifacts["schematic"] = ARTIFACT_FILES["schematic"]
    except Exception as e:  # pragma: no cover - schematic is best-effort
        print(f"[pipeline] schematic build failed: {e}")

    # Shareable one-page summary: product -> components -> renders -> schematic
    # -> assembly -> build plan -> dimensions -> simulation -> verdict.
    try:
        summary_html = build_summary_html(
            assembly=assembly,
            robot=robot,
            scene=scene,
            success=result.success,
            summary=result.summary,
            post_mortem=outcome.post_mortem,
            authored_by=outcome.authored_by,
            telemetry=result.telemetry,
            video_file=video_rel,
            poster_file=poster_rel,
            scene_file=ARTIFACT_FILES["scene"],
            telemetry_file=ARTIFACT_FILES["telemetry"],
            build_plan=build_plan,
            component_images=component_images,
            schematic_svg=schematic_svg,
            studio_renders=studio_renders,
        )
        _atomic_write_text(run_dir / ARTIFACT_FILES["summary"], summary_html)
        artifacts["summary"] = ARTIFACT_FILES["summary"]
    except Exception as e:  # pragma: no cover - summary is best-effort
        print(f"[pipeline] summary build failed: {e}")

    out = {
        "status": "ok",
        "supported": True,
        "success": result.success,
        "metric_value": result.metric_value,
        "summary": result.summary,
        "post_mortem": outcome.post_mortem,
        "authored_by": outcome.authored_by,
        "iterations": outcome.iterations,
        "telemetry": result.telemetry,
        "robot": {
            "device_id": robot.device_id,
            "kind": robot.kind,
            "provenance": robot.provenance,
            "base_mass_kg": robot.mass_kg,
            "total_mass_kg": scene.total_mass_kg,
            "mounted_parts": scene.mounted,
            "notes": robot.notes,
        },
        "world_desc": world_desc,
        "artifacts": artifacts,
        "video_available": video_rel is not None,
    }
    # result.json is written LAST and atomically: its presence is the signal that
    # every other artifact for this job has been finalized on disk. The job store
    # uses it to reconstruct a terminal 'done' status after a restart.
    _atomic_write_text(run_dir / ARTIFACT_FILES["result"], json.dumps(out, indent=2))
    return out
