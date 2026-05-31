"""Physics rollout: step the control loop, sense via ray-cast rangefinder,
record telemetry, trajectory, and frame snapshots (qpos) for rendering.

Telemetry is the *only* thing the LLM builder agent sees — never frames.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Tuple

import mujoco
import numpy as np

from ..scene.compile import SceneBuild

# Default success criteria when the proposal's success_metric is unparseable.
_DEFAULT_DWELL_S = 1.0


def parse_success_metric(
    metric: Optional[str],
) -> Tuple[Optional[float], Optional[float]]:
    """Best-effort parse of a free-text success_metric into (radius_m, dwell_s).

    Recognises phrasings like:
      "within 0.3m of goal for >2s"  -> (0.3, 2.0)
      "within 0.3 m for >1s"          -> (0.3, 1.0)
      "stay within 25cm for 3 seconds" -> (0.25, 3.0)
    Returns (None, None) for the part it can't find so callers fall back to the
    world goal_radius / default dwell. Never raises.
    """
    if not metric:
        return None, None
    text = metric.lower()
    radius: Optional[float] = None
    dwell: Optional[float] = None

    # distance: "within 0.3m" / "within 0.3 m" / "within 25cm"
    m = re.search(r"within\s*([0-9]*\.?[0-9]+)\s*(cm|centimet\w*|m\b|met\w*)", text)
    if m:
        val = float(m.group(1))
        unit = m.group(2)
        radius = val / 100.0 if unit.startswith("c") else val

    # dwell: "for >2s" / "for 2 s" / "for 2 seconds"
    d = re.search(r"for\s*>?\s*([0-9]*\.?[0-9]+)\s*(s\b|sec\w*)", text)
    if d:
        dwell = float(d.group(1))

    return radius, dwell

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
    fps: float  # effective playback fps = 1/(frame_every*dt); muxes in sync
    poses: List[dict]  # [{t,x,y,yaw}] for the lightweight 2D scrubber
    frame_qpos: List[List[float]]  # qpos snapshots aligned to render frames
    requested_fps: float = 0.0  # the fps the caller asked for (pre-rounding)
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
    reach_radius: Optional[float] = None,
    dwell_s: Optional[float] = None,
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
    # Bound total rendered frames. A full-duration (non-reaching) run — e.g. the
    # ramp stall at 60s — would otherwise record ~1700 frames and render too slowly
    # on a shared-CPU host to finish inside the web client's ~3min poll window.
    # Decimating raises frame_every; effective_fps drops to match so the clip still
    # plays in real time (just at a lower fps for long clips), and render wall-time
    # stays bounded. A reaching ~21s run is well under the cap and unaffected.
    _MAX_FRAMES = 900
    if frame_every > 0 and (n_steps // frame_every) > _MAX_FRAMES:
        frame_every = -(-n_steps // _MAX_FRAMES)  # ceil division
    # We snapshot one frame every `frame_every` sim steps, so the TRUE playback
    # rate is 1/(frame_every*dt), not the requested render_fps. E.g. 30fps over
    # dt=0.005 rounds to frame_every=7 -> 28.57 effective fps. Muxing at 30 would
    # play the clip ~5% fast vs telemetry timestamps. Carry the effective fps so
    # the muxer can stay in sync with the recorded timeline.
    effective_fps = 1.0 / (frame_every * dt)

    gx, gy = scene.goal_xy
    # Per-proposal success criteria: a distance threshold + dwell time parsed
    # from the assembly's success_metric (e.g. "within 0.3m for >2s"). Fall back
    # to the world goal_radius / 1.0s dwell when unspecified. The reach radius is
    # the *tighter* of the parsed threshold and the world goal_radius so a
    # proposal can demand more precision than the marker, never less.
    eff_radius = scene.goal_radius if reach_radius is None else min(reach_radius, scene.goal_radius)
    eff_dwell = _DEFAULT_DWELL_S if dwell_s is None else max(0.0, dwell_s)
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
    # collision_events = discrete rising-edge contacts (a fresh bump);
    # collision_steps = number of steps with any obstacle contact;
    # contact_pair_steps = old summed contact-pairs (kept for debugging only).
    collision_events = 0
    collision_steps = 0
    contact_pair_steps = 0
    prev_hit = False
    time_in_goal = 0.0
    reached = False
    reached_t: Optional[float] = None
    tipped = False
    tipped_t: Optional[float] = None
    stuck = False
    stuck_t: Optional[float] = None
    stuck_xy: Optional[list] = None
    stuck_recovered = False
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
                contact_pair_steps += 1  # raw pair count (debug only)
        if hit:
            collision_steps += 1
            if not prev_hit:
                # Rising edge: one discrete collision event, not one-per-pair.
                collision_events += 1
        prev_hit = hit

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
        if dist <= eff_radius:
            time_in_goal += dt
            if time_in_goal >= eff_dwell and not reached:
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
                stuck_recovered = False
            elif stuck and span > 0.25:
                # Robot broke free: it wedged earlier but is moving again. Clear
                # the live flag so we never assert a bare stuck=True at the end;
                # remember that it recovered so the summary can say so honestly.
                stuck = False
                stuck_recovered = True
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

    # Distinguish "ran out of clock while still closing in" from a real stall.
    # If the rollout used (nearly) all its steps without reaching, and distance
    # to goal was still shrinking over the final window, it's a time-cap miss —
    # NOT a stall. (Compare distance ~3s before the end to the final distance.)
    ran_full_duration = len(dist_series) >= n_steps - 1
    timed_out_approaching = False
    if not reached and ran_full_duration and len(dist_series) >= 2:
        look_back = min(len(dist_series) - 1, max(1, window_n))
        dist_then = dist_series[-1 - look_back]
        # Closing the gap (and not wedged) => still approaching at the cap.
        if (dist_then - final_dist) > 0.15 and not stuck:
            timed_out_approaching = True
    # If we ever wedged but reached anyway, force the recovered flag (covers the
    # case where the goal was hit before the span-window cleared the latch).
    if reached and (stuck or stuck_t is not None):
        stuck = False
        stuck_recovered = True

    # `collisions` now reports discrete collision EVENTS (rising edges), not the
    # old summed contact-pairs-per-step (which inflated ~2.5s of wall contact to
    # 1753). contact_seconds = wall-clock the robot spent touching obstacles.
    collisions = collision_events
    contact_seconds = round(collision_steps * dt, 2)

    parts = [
        f"reached={reached}",
        f"final_dist={final_dist:.2f}m",
        f"min_dist={min_dist:.2f}m",
        f"collisions={collision_events}",
        f"contact_seconds={contact_seconds}s",
        f"tipped={tipped}" + (f"@{tipped_t:.1f}s" if tipped else ""),
    ]
    if stuck:
        parts.append(f"stuck@{stuck_xy} for>3s (t={stuck_t:.1f}s)")
    elif stuck_recovered:
        parts.append(f"recovered after wedging at {stuck_xy} (t={stuck_t:.1f}s)")
    if timed_out_approaching:
        parts.append("timed-out while still approaching")
    if heading_osc_deg > 25:
        parts.append(f"heading_osc=±{heading_osc_deg/2:.0f}deg")
    summary = " ".join(parts)

    telemetry = {
        "reached": reached,
        "reached_t": reached_t,
        "final_dist": round(final_dist, 4),
        "min_dist": round(min_dist, 4),
        # discrete collision events (rising edges) — the corrected metric.
        "collisions": collisions,
        "collision_events": collision_events,
        # number of sim steps with any obstacle contact + that in seconds.
        "collision_steps": collision_steps,
        "contact_seconds": contact_seconds,
        # raw summed contact-pairs (the old, inflated metric) for debugging only.
        "contact_pair_steps": contact_pair_steps,
        "tipped": tipped,
        "tipped_t": tipped_t,
        "stuck": stuck,
        "stuck_t": stuck_t,
        "stuck_xy": stuck_xy,
        "stuck_recovered": stuck_recovered,
        # True => ran out the clock while still closing in (not a real stall).
        "timed_out_approaching": timed_out_approaching,
        "heading_osc_deg": round(heading_osc_deg, 1),
        "duration_s": round((len(dist_series) * dt), 2),
        "goal_xy": [gx, gy],
        "goal_radius": scene.goal_radius,
        # Effective success criteria actually applied to the reached check.
        "success_radius": round(eff_radius, 4),
        "success_dwell_s": round(eff_dwell, 3),
        "start_xy": list(scene.start_xy),
        # The REQUESTED template name (never silently swapped); when its geometry
        # is approximated by another layout, `template_approximated_as` says so.
        "template": scene.template,
        "template_approximated_as": scene.approximated_as,
        "max_v": round(max_v, 3),
        "max_w": round(max_w, 3),
    }
    if scene.approximated_as:
        summary += (
            f" [note: '{scene.template}' geometry approximated as "
            f"{scene.approximated_as}]"
        )

    return RunResult(
        success=success,
        metric_value=round(final_dist, 4),
        telemetry=telemetry,
        summary=summary,
        # Effective fps keeps the muxed clip in sync with telemetry timestamps;
        # render_fps was the (rounded) request.
        fps=effective_fps,
        requested_fps=render_fps,
        poses=poses,
        frame_qpos=frame_qpos,
        meta={"n_frames": len(frame_qpos), "frame_every": frame_every},
    )
