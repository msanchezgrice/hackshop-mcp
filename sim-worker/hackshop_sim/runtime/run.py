"""Physics rollout: step the control loop, sense via ray-cast rangefinder,
record telemetry, trajectory, and frame snapshots (qpos) for rendering.

Telemetry is the *only* thing the LLM builder agent sees — never frames.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, List, Optional

import mujoco
import numpy as np

from ..scene.compile import SceneBuild

# Rangefinder ring: bearings (rad, relative to heading) sampled each step.
_RAY_BEARINGS = [
    -1.57, -1.05, -0.7, -0.45, -0.22, 0.0, 0.22, 0.45, 0.7, 1.05, 1.57,
]
_RAY_MAX = 5.0
_GROUP_MASK = np.array([1, 1, 1, 0, 0, 0], dtype=np.uint8)  # exclude group 3 (robot)


@dataclass
class RunResult:
    success: bool
    metric_value: float  # final distance to goal (m)
    telemetry: dict
    summary: str  # concise text for the agent
    fps: float
    poses: List[dict]  # [{t,x,y,yaw}] for the lightweight 2D scrubber
    frame_qpos: List[List[float]]  # qpos snapshots aligned to render frames
    meta: dict = field(default_factory=dict)


def _yaw_from_xmat(xmat: np.ndarray) -> float:
    # body local +x axis in world = first column of R (row-major 3x3).
    return math.atan2(xmat[3], xmat[0])


def _up_z(xmat: np.ndarray) -> float:
    # world-z component of body local +z axis = R[2][2].
    return xmat[8]


def _norm_angle(a: float) -> float:
    while a > math.pi:
        a -= 2 * math.pi
    while a < -math.pi:
        a += 2 * math.pi
    return a


def run_rollout(
    scene: SceneBuild,
    control_act: Callable[[dict], dict],
    duration_s: float = 12.0,
    render_fps: float = 30.0,
    max_forward_mps: Optional[float] = None,
) -> RunResult:
    model = mujoco.MjModel.from_xml_string(scene.xml)
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)

    chassis_id = model.body(scene.chassis_body).id
    left_act = model.actuator(scene.left_actuator).id
    right_act = model.actuator(scene.right_actuator).id

    # Map obstacle geom names -> ids for collision classification.
    obstacle_ids = set()
    for name in scene.obstacle_geoms:
        try:
            obstacle_ids.add(model.geom(name).id)
        except KeyError:
            pass

    dt = model.opt.timestep
    n_steps = int(round(duration_s / dt))
    frame_every = max(1, int(round((1.0 / render_fps) / dt)))

    gx, gy = scene.goal_xy
    wb = scene.wheel_base_m
    wr = scene.wheel_radius_m
    max_wheel = scene.max_wheel_rad_s
    # Forward/turn caps derived from wheel limits (and an optional bound cap).
    max_v = wr * max_wheel
    if max_forward_mps is not None:
        max_v = min(max_v, max_forward_mps)
    max_w = (2.0 * wr * max_wheel) / wb

    geomid = np.zeros(1, dtype=np.int32)

    def sense_ranges(pnt: np.ndarray, yaw: float) -> list[dict]:
        out = []
        for b in _RAY_BEARINGS:
            ang = yaw + b
            vec = np.array([math.cos(ang), math.sin(ang), 0.0], dtype=np.float64)
            dist = mujoco.mj_ray(model, data, pnt, vec, _GROUP_MASK, 1, -1, geomid)
            out.append({"angle": b, "dist": _RAY_MAX if dist < 0 else float(dist)})
        return out

    # Telemetry accumulators
    poses: List[dict] = []
    frame_qpos: List[List[float]] = []
    dist_series: List[float] = []
    min_dist = float("inf")
    collisions = 0
    collision_steps = 0
    time_in_goal = 0.0
    reached = False
    reached_t: Optional[float] = None
    tipped = False
    tipped_t: Optional[float] = None
    stuck = False
    stuck_t: Optional[float] = None
    stuck_xy: Optional[list] = None
    yaw_window: List[float] = []
    pos_window: List[tuple] = []
    window_n = int(round(3.0 / dt))
    heading_osc_deg = 0.0

    for step in range(n_steps):
        xpos = data.body(chassis_id).xpos
        xmat = data.body(chassis_id).xmat
        x, y = float(xpos[0]), float(xpos[1])
        yaw = _yaw_from_xmat(xmat)
        up = _up_z(xmat)

        dx, dy = gx - x, gy - y
        dist = math.hypot(dx, dy)
        bearing_to_goal = math.atan2(dy, dx)
        heading_error = _norm_angle(bearing_to_goal - yaw)

        ray_origin = np.array([x, y, max(0.08, scene.wheel_radius_m + 0.02)], dtype=np.float64)
        ranges = sense_ranges(ray_origin, yaw)
        min_r = min(ranges, key=lambda r: r["dist"])

        # collision detection this step
        hit = False
        for ci in range(data.ncon):
            c = data.contact[ci]
            g1, g2 = int(c.geom1), int(c.geom2)
            g1_robot = model.geom_group[g1] == 3
            g2_robot = model.geom_group[g2] == 3
            g1_obs = g1 in obstacle_ids
            g2_obs = g2 in obstacle_ids
            if (g1_robot and g2_obs) or (g2_robot and g1_obs):
                hit = True
                collisions += 1
        if hit:
            collision_steps += 1

        obs = {
            "t": step * dt,
            "pos": [x, y],
            "yaw": yaw,
            "goal": [gx, gy],
            "dist_to_goal": dist,
            "heading_error": heading_error,
            "ranges": ranges,
            "min_range": min_r["dist"],
            "min_angle": min_r["angle"],
            "max_v": max_v,
            "max_w": max_w,
            "collided": hit,
        }

        try:
            ctrl = control_act(obs)
            v = float(ctrl.get("v", 0.0))
            w = float(ctrl.get("w", 0.0))
            if not math.isfinite(v):
                v = 0.0
            if not math.isfinite(w):
                w = 0.0
        except Exception:
            v, w = 0.0, 0.0

        v = max(-max_v, min(max_v, v))
        w = max(-max_w, min(max_w, w))

        # diff-drive: wheel angular velocities (rad/s)
        left_target = (v - w * wb / 2.0) / wr
        right_target = (v + w * wb / 2.0) / wr
        left_target = max(-max_wheel, min(max_wheel, left_target))
        right_target = max(-max_wheel, min(max_wheel, right_target))
        data.ctrl[left_act] = left_target
        data.ctrl[right_act] = right_target

        # bookkeeping
        dist_series.append(dist)
        min_dist = min(min_dist, dist)
        if dist <= scene.goal_radius:
            time_in_goal += dt
            if time_in_goal >= 1.0 and not reached:
                reached = True
                reached_t = step * dt
        else:
            time_in_goal = 0.0
        if up < 0.5 and not tipped:
            tipped = True
            tipped_t = step * dt

        yaw_window.append(yaw)
        pos_window.append((x, y))
        if len(yaw_window) > window_n:
            yaw_window.pop(0)
            pos_window.pop(0)
        if len(pos_window) == window_n and not reached:
            xs = [p[0] for p in pos_window]
            ys = [p[1] for p in pos_window]
            span = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
            if span < 0.08 and (step * dt) > 3.0 and not stuck:
                stuck = True
                stuck_t = step * dt
                stuck_xy = [round(x, 2), round(y, 2)]
            unwrapped = [_norm_angle(a - yaw_window[0]) for a in yaw_window]
            osc = math.degrees(max(unwrapped) - min(unwrapped))
            heading_osc_deg = max(heading_osc_deg, osc)

        if step % frame_every == 0:
            poses.append({"t": round(step * dt, 3), "x": round(x, 4), "y": round(y, 4), "yaw": round(yaw, 4)})
            frame_qpos.append([float(q) for q in data.qpos])

        mujoco.mj_step(model, data)
        if reached:
            # keep rolling a little after success for a satisfying clip, then stop
            if step * dt > (reached_t or 0) + 1.0:
                break

    final_dist = dist_series[-1] if dist_series else float("inf")
    success = reached and not tipped

    parts = [
        f"reached={reached}",
        f"final_dist={final_dist:.2f}m",
        f"min_dist={min_dist:.2f}m",
        f"collisions={collisions}",
        f"collision_steps={collision_steps}",
        f"tipped={tipped}" + (f"@{tipped_t:.1f}s" if tipped else ""),
    ]
    if stuck:
        parts.append(f"stuck@{stuck_xy} for>3s (t={stuck_t:.1f}s)")
    if heading_osc_deg > 25:
        parts.append(f"heading_osc=±{heading_osc_deg/2:.0f}deg")
    summary = " ".join(parts)

    telemetry = {
        "reached": reached,
        "reached_t": reached_t,
        "final_dist": round(final_dist, 4),
        "min_dist": round(min_dist, 4),
        "collisions": collisions,
        "collision_steps": collision_steps,
        "tipped": tipped,
        "tipped_t": tipped_t,
        "stuck": stuck,
        "stuck_t": stuck_t,
        "stuck_xy": stuck_xy,
        "heading_osc_deg": round(heading_osc_deg, 1),
        "duration_s": round((len(dist_series) * dt), 2),
        "goal_xy": [gx, gy],
        "goal_radius": scene.goal_radius,
        "start_xy": list(scene.start_xy),
        "template": scene.template,
        "max_v": round(max_v, 3),
        "max_w": round(max_w, 3),
    }

    return RunResult(
        success=success,
        metric_value=round(final_dist, 4),
        telemetry=telemetry,
        summary=summary,
        fps=render_fps,
        poses=poses,
        frame_qpos=frame_qpos,
        meta={"n_frames": len(frame_qpos)},
    )
