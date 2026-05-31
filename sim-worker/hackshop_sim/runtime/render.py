"""Offscreen render: replay qpos frame snapshots -> mp4.

Decoupled from physics (replays recorded qpos) so rendering is deterministic and
re-runnable without re-simulating. On macOS MuJoCo renders offscreen via CGL with
no display needed; on headless Linux set MUJOCO_GL=egl.
"""

from __future__ import annotations

from typing import Dict, List, Optional

import mujoco
import numpy as np


def render_video(
    scene_xml: str,
    frame_qpos: List[List[float]],
    fps: float,
    out_path: str,
    width: int = 640,
    height: int = 480,
    camera: str = "chase",
    poster_path: Optional[str] = None,
) -> Optional[str]:
    """Render frames to an mp4 at out_path. Returns the path, or None if the GL
    backend is unavailable (telemetry/trajectory still produced upstream).

    If poster_path is given, also writes a single still (a frame ~1/4 into the
    run, where the robot is clearly under way) as a PNG hero shot.
    """
    if not frame_qpos:
        return None
    try:
        import imageio.v2 as imageio
    except Exception:  # pragma: no cover
        import imageio  # type: ignore

    model = mujoco.MjModel.from_xml_string(scene_xml)
    data = mujoco.MjData(model)

    try:
        renderer = mujoco.Renderer(model, height, width)
    except Exception as e:  # pragma: no cover - GL backend missing
        print(f"[render] renderer unavailable: {e}")
        return None

    # The robot lives in geom group 3 (so the lidar ray-cast can mask its own
    # body). MuJoCo's default visualization culls group 3, which would render an
    # empty world with no robot in it. Force every geom group visible here — this
    # is render-only and does NOT touch the rangefinder's separate ray mask.
    opt = mujoco.MjvOption()
    opt.geomgroup[:] = 1

    # Mux at the EXACT (possibly fractional) effective fps so playback stays in
    # sync with telemetry timestamps. The caller passes 1/(frame_every*dt) — e.g.
    # 28.571 for a 30fps request at dt=0.005 — and rounding that to 30 would play
    # the clip ~5% fast. ffmpeg/libx264 accepts a fractional output rate.
    # imageio passes fps as "-r %.02f"; add a higher-precision "-r" (ffmpeg uses
    # the last one) so a fractional effective fps like 28.571 isn't rounded to
    # 28.57 and drifting vs telemetry over a long clip. pixelformat (yuv420p) is
    # supplied via imageio's own arg to avoid a duplicate -pix_fmt.
    eff_fps = float(fps) if fps and fps > 0 else 30.0

    # STREAM frames straight to the ffmpeg encoder rather than buffering the whole
    # clip in RAM. A 60s rollout is ~1700 frames * 640x480x3 ≈ 1.5GB if collected
    # in a list first — enough to OOM a 1GB container mid-render and hang the box.
    # With a streaming writer only one frame is resident at a time, so render
    # memory is ~O(1) in clip length and any duration is safe. We keep a single
    # copy of the poster frame so the hero still survives the stream.
    n = len(frame_qpos)
    poster_idx = min(n - 1, max(0, n // 4)) if poster_path else -1
    poster_frame = None
    writer = imageio.get_writer(
        out_path,
        fps=eff_fps,
        codec="libx264",
        quality=8,
        macro_block_size=None,
        pixelformat="yuv420p",
        output_params=["-r", f"{eff_fps:.6f}"],
    )
    try:
        for i, q in enumerate(frame_qpos):
            data.qpos[:] = np.asarray(q, dtype=np.float64)
            mujoco.mj_forward(model, data)
            renderer.update_scene(data, camera=camera, scene_option=opt)
            frame = renderer.render()
            writer.append_data(frame)  # consumed synchronously -> no .copy() needed
            if i == poster_idx:
                poster_frame = frame.copy()
    finally:
        writer.close()
        renderer.close()

    if poster_path and poster_frame is not None:
        try:
            imageio.imwrite(poster_path, poster_frame)
        except Exception as e:  # pragma: no cover - poster is best-effort
            print(f"[render] poster write failed: {e}")

    return out_path


def render_studio(
    studio_xml: str,
    cameras: List[str],
    out_dir: str,
    *,
    prefix: str = "render",
    width: int = 1200,
    height: int = 900,
    settle_steps: int = 140,
) -> Dict[str, str]:
    """High-fidelity beauty shots of the robot from several angles.

    Steps the (control-free) studio scene a few frames so the chassis settles
    onto its wheels, then renders each named camera to <out_dir>/<prefix>_<cam>.png.
    Returns {cam: filename} for the shots that succeeded (best-effort: a missing
    GL backend or one bad camera never aborts the run).
    """
    try:
        import imageio.v2 as imageio
    except Exception:  # pragma: no cover
        import imageio  # type: ignore
    import os

    model = mujoco.MjModel.from_xml_string(studio_xml)
    data = mujoco.MjData(model)

    # Let the free body settle on its contacts so it sits naturally.
    for _ in range(max(0, settle_steps)):
        mujoco.mj_step(model, data)
    mujoco.mj_forward(model, data)

    try:
        renderer = mujoco.Renderer(model, height, width)
    except Exception as e:  # pragma: no cover - GL backend missing
        print(f"[render] studio renderer unavailable: {e}")
        return {}

    opt = mujoco.MjvOption()
    opt.geomgroup[:] = 1  # robot lives in group 3 (see render_video note)

    out: Dict[str, str] = {}
    try:
        for cam in cameras:
            cam_name = f"studio_{cam}"
            try:
                renderer.update_scene(data, camera=cam_name, scene_option=opt)
                img = renderer.render().copy()
                fname = f"{prefix}_{cam}.png"
                imageio.imwrite(os.path.join(out_dir, fname), img)
                out[cam] = fname
            except Exception as e:  # pragma: no cover - one bad cam is non-fatal
                print(f"[render] studio cam {cam_name} failed: {e}")
    finally:
        renderer.close()

    return out
