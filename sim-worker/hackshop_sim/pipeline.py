"""End-to-end: Assembly IR -> resolve -> compile -> control (scripted/agent) ->
rollout -> render -> artifacts on disk. Returns a JSON-able result dict.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import List, Optional

from .agent import loop as agent_loop
from .assets.resolve import resolve
from .ir import Assembly, BuildPlanIR, ComponentMedia, SimulateOptions
from .media import download_component_images
from .report import build_summary_html
from .runtime.render import render_studio, render_video
from .runtime.run import run_rollout
from .scene.compile import STUDIO_CAMERAS, compile_scene, compile_studio_scene
from .scene.schematic import build_schematic_svg

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
        (run_dir / ARTIFACT_FILES["result"]).write_text(json.dumps(out, indent=2))
        return out

    robot = res.robot
    scene = compile_scene(assembly, robot, bounded=options.bounded)
    (run_dir / ARTIFACT_FILES["scene"]).write_text(scene.xml)

    # Bounded mode (MCP): cap duration, no agent, smaller render.
    duration = options.duration_s
    render_fps = 30.0
    width, height = 640, 480
    use_agent = options.agent
    if options.bounded:
        # Cap generously enough for the pulled-in bounded goal (~2.4m at proxy
        # speed) plus the 1s dwell, but still small enough for one tool call.
        duration = min(duration, 10.0)
        use_agent = False
        render_fps = 25.0
        width, height = 480, 360

    world_desc = _world_desc(assembly, scene.goal_xy, scene.goal_radius)

    def runner(act):
        return run_rollout(scene, act, duration_s=duration, render_fps=render_fps)

    outcome = agent_loop.build(world_desc, runner, use_agent, options.agent_max_iters)
    result = outcome.result

    # persist control + telemetry + trajectory
    (run_dir / ARTIFACT_FILES["control"]).write_text(outcome.control_source)
    (run_dir / ARTIFACT_FILES["telemetry"]).write_text(json.dumps(result.telemetry, indent=2))
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
    (run_dir / ARTIFACT_FILES["trajectory"]).write_text(json.dumps(trajectory))

    artifacts = {
        "telemetry": ARTIFACT_FILES["telemetry"],
        "trajectory": ARTIFACT_FILES["trajectory"],
        "control": ARTIFACT_FILES["control"],
        "scene": ARTIFACT_FILES["scene"],
    }

    video_rel = None
    poster_rel = None
    if options.render:
        try:
            video_path = render_video(
                scene.xml, result.frame_qpos, result.fps,
                str(run_dir / ARTIFACT_FILES["video"]), width=width, height=height,
                poster_path=str(run_dir / ARTIFACT_FILES["poster"]),
            )
            if video_path:
                video_rel = ARTIFACT_FILES["video"]
                artifacts["video"] = video_rel
                if (run_dir / ARTIFACT_FILES["poster"]).exists():
                    poster_rel = ARTIFACT_FILES["poster"]
                    artifacts["poster"] = poster_rel
        except Exception as e:  # pragma: no cover - render is best-effort
            print(f"[pipeline] render failed: {e}")

    # High-fidelity beauty renders (robot alone on a clean stage, multiple
    # angles). Skipped in bounded/MCP mode to keep that path snappy.
    studio_renders: dict = {}
    if options.render and not options.bounded:
        try:
            studio_xml = compile_studio_scene(assembly, robot)
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
        (run_dir / ARTIFACT_FILES["schematic"]).write_text(schematic_svg)
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
        (run_dir / ARTIFACT_FILES["summary"]).write_text(summary_html)
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
    (run_dir / ARTIFACT_FILES["result"]).write_text(json.dumps(out, indent=2))
    return out
