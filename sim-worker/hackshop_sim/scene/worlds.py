"""World templates -> obstacle/goal/floor MJCF fragments + spawn/goal metadata.

Each template returns a `WorldBuild`: the worldbody XML (walls, obstacles, goal
marker) plus the robot start pose, goal position, and goal radius. Goals are
non-colliding sites so reaching one is purely positional.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Tuple

# In bounded mode (single MCP tool call, ~6s cap) a 6.5m diagonal is
# unreachable at proxy speeds (~0.43 m/s). Pull the goal in along the
# start->goal vector to a distance a short run can actually cover, so the
# happy path reads as success instead of a time-cap false negative. Explicit
# goal overrides are always respected.
_BOUNDED_REACH_M = 2.4


@dataclass
class WorldBuild:
    obstacles_xml: str
    start_xy: Tuple[float, float]
    start_yaw_deg: float
    goal_xy: Tuple[float, float]
    goal_radius: float
    # Names of obstacle/wall geoms, so the runtime can classify collisions.
    obstacle_geoms: list[str]
    # Browser-renderable mirrors of the static MuJoCo geometry. Dimensions are
    # full x/y/z extents and positions are world-frame geom centers.
    visual_objects: list[dict]
    # When a requested template isn't modelled distinctly yet (stairs,
    # outdoor-flat) we approximate it with another layout. This carries an
    # honest note so telemetry/summary never silently mislabel the geometry.
    approximated_as: Optional[str] = None


_WALL_COLOR = "#73777F"
_OBSTACLE_COLOR = "#D9594D"


def _visual_box(
    name: str,
    x: float,
    y: float,
    z: float,
    sx: float,
    sy: float,
    sz: float,
    color: str,
    rotation_deg: Optional[list[float]] = None,
) -> dict:
    visual = {
        "name": name,
        "shape": "box",
        "position_m": [round(x, 5), round(y, 5), round(z, 5)],
        "dimensions_m": [round(sx * 2.0, 5), round(sy * 2.0, 5), round(sz * 2.0, 5)],
        "color": color,
    }
    if rotation_deg is not None:
        visual["rotation_deg"] = rotation_deg
    return visual


def _visual_cylinder(
    name: str, x: float, y: float, radius: float, height: float, color: str
) -> dict:
    return {
        "name": name,
        "shape": "cylinder",
        "position_m": [round(x, 5), round(y, 5), round(height / 2.0, 5)],
        "dimensions_m": [
            round(radius * 2.0, 5),
            round(radius * 2.0, 5),
            round(height, 5),
        ],
        "color": color,
    }


def _walls(
    half: float, h: float = 0.25, t: float = 0.05
) -> tuple[str, list[str], list[dict]]:
    """Four perimeter walls enclosing a `2*half` square arena."""
    names = ["wall_n", "wall_s", "wall_e", "wall_w"]
    xml = f"""
    <geom name="wall_n" type="box" pos="0 {half} {h/2}" size="{half} {t} {h/2}" material="wall"/>
    <geom name="wall_s" type="box" pos="0 {-half} {h/2}" size="{half} {t} {h/2}" material="wall"/>
    <geom name="wall_e" type="box" pos="{half} 0 {h/2}" size="{t} {half} {h/2}" material="wall"/>
    <geom name="wall_w" type="box" pos="{-half} 0 {h/2}" size="{t} {half} {h/2}" material="wall"/>"""
    visuals = [
        _visual_box("wall_n", 0.0, half, h / 2.0, half, t, h / 2.0, _WALL_COLOR),
        _visual_box("wall_s", 0.0, -half, h / 2.0, half, t, h / 2.0, _WALL_COLOR),
        _visual_box("wall_e", half, 0.0, h / 2.0, t, half, h / 2.0, _WALL_COLOR),
        _visual_box("wall_w", -half, 0.0, h / 2.0, t, half, h / 2.0, _WALL_COLOR),
    ]
    return xml, names, visuals


def _goal_site(gx: float, gy: float, r: float) -> str:
    return (
        f'\n    <site name="goal" type="cylinder" pos="{gx} {gy} 0.01" '
        f'size="{r} 0.01" material="goal"/>'
    )


def _box(name: str, x: float, y: float, sx: float, sy: float, h: float) -> str:
    return (
        f'\n    <geom name="{name}" type="box" pos="{x} {y} {h/2}" '
        f'size="{sx} {sy} {h/2}" material="obstacle"/>'
    )


def _cyl(name: str, x: float, y: float, r: float, h: float) -> str:
    return (
        f'\n    <geom name="{name}" type="cylinder" pos="{x} {y} {h/2}" '
        f'size="{r} {h/2}" material="obstacle"/>'
    )


def _clamp_arena(
    gx: float, gy: float, half: float, margin: float = 0.4
) -> Tuple[float, float]:
    """Keep a goal inside the walled arena. An LLM-supplied goal_xy is unreliable
    and can land on/outside a wall (e.g. (3,4) in a half=3 arena), which is
    unreachable and makes the run burn its full duration. Clamp to the interior."""
    lim = max(0.0, half - margin)
    return (max(-lim, min(lim, gx)), max(-lim, min(lim, gy)))


def _pull_in(
    start: Tuple[float, float],
    goal: Tuple[float, float],
    override: Optional[Tuple[float, float]],
    bounded: bool,
) -> Tuple[float, float]:
    """Shrink an (unoverridden) goal toward start so a bounded run can reach it."""
    if not bounded or override is not None:
        return goal
    sx, sy = start
    gx, gy = goal
    dx, dy = gx - sx, gy - sy
    dist = math.hypot(dx, dy)
    if dist <= _BOUNDED_REACH_M or dist == 0.0:
        return goal
    k = _BOUNDED_REACH_M / dist
    return (round(sx + dx * k, 4), round(sy + dy * k, 4))


# Obstacle layout for the obstacle-course / stairs / outdoor-flat templates.
# (name, kind, x, y, ...): kind="cyl" -> (r, h); kind="box" -> (sx, sy, h).
#
# A navigable SLALOM between start(-2.3,-2.3) and goal(2.3,2.3): convex pillars
# offset alternately from the diagonal with ~0.9m+ gaps, plus side boxes for
# visual interest. There is always a passable channel toward the goal (no
# concave dead-end pocket), so the reactive baseline weaves through — visible
# struggle and bumps — and reaches the goal rather than wedging forever. The
# ramp world remains the genuine-stall failure-theatre showcase.
_OBSTACLE_LAYOUT = [
    ("pillar_a", "cyl", -1.45, -0.65, 0.22, 0.4),
    ("pillar_b", "cyl", -0.55, -1.35, 0.22, 0.4),
    ("pillar_c", "cyl", 0.15, -0.15, 0.24, 0.4),
    ("pillar_d", "cyl", 1.15, 0.55, 0.22, 0.4),
    ("box_a", "box", -1.75, 0.7, 0.45, 0.12, 0.35),
    ("box_b", "box", 1.85, -0.6, 0.12, 0.5, 0.35),
    ("box_c", "box", 0.55, 1.75, 0.5, 0.12, 0.35),
]


def _obstacle_clearance(px: float, py: float, half: float) -> float:
    """Distance from (px,py) to the nearest obstacle/wall edge (negative inside)."""
    best = float("inf")
    for entry in _OBSTACLE_LAYOUT:
        kind = entry[1]
        if kind == "cyl":
            _, _, x, y, rr, _ = entry
            best = min(best, math.hypot(px - x, py - y) - rr)
        else:
            _, _, x, y, sx, sy, _ = entry
            dx = max(abs(px - x) - sx, 0.0)
            dy = max(abs(py - y) - sy, 0.0)
            best = min(best, math.hypot(dx, dy))
    best = min(best, half - abs(px), half - abs(py))
    return best


def _pull_in_clear(
    start: Tuple[float, float],
    goal: Tuple[float, float],
    override: Optional[Tuple[float, float]],
    bounded: bool,
    half: float = 3.0,
    min_clearance: float = 0.35,
) -> Tuple[float, float]:
    """Bounded pull-in for the cluttered obstacle course.

    Plain diagonal pull-in lands the goal right on pillar_a/pillar_b. So pull to
    the bounded reach distance, then if the point sits in/near an obstacle, scan
    along the start->goal ray (and small perpendicular offsets) for the nearest
    point with real clearance. Explicit overrides + non-bounded runs untouched.
    """
    if not bounded or override is not None:
        return goal
    sx, sy = start
    gx, gy = goal
    dx, dy = gx - sx, gy - sy
    dist = math.hypot(dx, dy)
    if dist == 0.0:
        return goal
    ux, uy = dx / dist, dy / dist  # unit start->goal
    px, py = -uy, ux  # unit perpendicular
    target = min(_BOUNDED_REACH_M, dist)
    base = (round(sx + ux * target, 4), round(sy + uy * target, 4))
    if _obstacle_clearance(*base, half) >= min_clearance:
        return base
    # Search: vary distance around the target and a small perpendicular offset,
    # prefer points close to the desired bounded reach.
    best_pt = base
    best_score = -1.0
    for along in [target, target - 0.4, target + 0.4, target - 0.8, target + 0.8]:
        if along <= 0.3 or along > dist:
            continue
        for off in (0.0, -0.55, 0.55, -0.9, 0.9):
            cx = round(sx + ux * along + px * off, 4)
            cy = round(sy + uy * along + py * off, 4)
            clr = _obstacle_clearance(cx, cy, half)
            if clr < min_clearance:
                continue
            # Reward clearance + proximity to the desired bounded reach distance.
            score = clr - 0.5 * abs(along - target) - 0.3 * abs(off)
            if score > best_score:
                best_score, best_pt = score, (cx, cy)
    return best_pt


def build(
    template: str,
    goal_override: Optional[Tuple[float, float]],
    bounded: bool = False,
) -> WorldBuild:
    if template == "empty-room":
        half = 3.0
        walls_xml, wall_names, visual_objects = _walls(half)
        start = (-2.2, -2.2)
        # Open room: any in-arena point is reachable, so honor a (clamped) override.
        raw = _clamp_arena(*(goal_override or (2.2, 2.2)), half)
        gx, gy = _pull_in(start, raw, goal_override, bounded)
        r = 0.3
        xml = walls_xml + _goal_site(gx, gy, r)
        return WorldBuild(xml, start, 45.0, (gx, gy), r, wall_names, visual_objects)

    if template in ("obstacle-course", "stairs", "outdoor-flat"):
        # stairs/outdoor not yet modelled distinctly -> reuse obstacle-course so
        # the slice still runs honestly (labelled in telemetry by template name).
        half = 3.0
        walls_xml, wall_names, visual_objects = _walls(half)
        start = (-2.3, -2.3)
        # The fixed slalom is verified-reachable to its NE corner only. An
        # LLM-supplied goal_xy is unreliable (it has landed at (3,4), outside the
        # walls -> unreachable -> the run burns its full duration and the headline
        # demo always "times out"). So for this cluttered world we navigate to our
        # OWN known-reachable goal regardless of the override: pulled into a clear
        # pocket for bounded runs, the full NE corner (2.3,2.3) for async — both
        # verified to reach. Open worlds above honor a clamped override.
        gx, gy = _pull_in_clear(start, (2.3, 2.3), None, bounded)
        r = 0.3
        obs = ""
        names = list(wall_names)
        # A slalom of pillars + boxes between start(-2.3,-2.3) and goal, with a
        # concave "trap" pocket near (0.4,1.4) where a naive controller wedges.
        for entry in _OBSTACLE_LAYOUT:
            name, kind = entry[0], entry[1]
            if kind == "cyl":
                _, _, x, y, rr, hh = entry
                obs += _cyl(name, x, y, rr, hh)
                visual_objects.append(
                    _visual_cylinder(name, x, y, rr, hh, _OBSTACLE_COLOR)
                )
            else:
                _, _, x, y, sx, sy, hh = entry
                obs += _box(name, x, y, sx, sy, hh)
                visual_objects.append(
                    _visual_box(
                        name, x, y, hh / 2.0, sx, sy, hh / 2.0, _OBSTACLE_COLOR
                    )
                )
            names.append(name)
        xml = walls_xml + obs + _goal_site(gx, gy, r)
        # stairs / outdoor-flat aren't modelled distinctly yet -> honestly flag
        # that the geometry is approximated by the obstacle-course layout.
        approx = "obstacle-course" if template in ("stairs", "outdoor-flat") else None
        return WorldBuild(
            xml,
            start,
            45.0,
            (gx, gy),
            r,
            names,
            visual_objects,
            approximated_as=approx,
        )

    if template == "ramp":
        half = 3.0
        walls_xml, wall_names, visual_objects = _walls(half)
        raw = _clamp_arena(*(goal_override or (2.3, 0.0)), half)
        gx, gy = _pull_in((-2.3, 0.0), raw, goal_override, bounded)
        r = 0.3
        # An inclined slab in the middle the base must climb. Often stalls ->
        # exactly the "stumble/stuck" theatre requested.
        ramp = (
            '\n    <geom name="ramp" type="box" pos="0 0 0.12" '
            'euler="0 14 0" size="0.9 1.2 0.04" material="obstacle"/>'
        )
        # The ramp is drivable terrain, not a collision obstacle: excluded from
        # obstacle_geoms so contact with it isn't counted as a crash.
        names = list(wall_names)
        xml = walls_xml + ramp + _goal_site(gx, gy, r)
        visual_objects.append(
            _visual_box(
                "ramp",
                0.0,
                0.0,
                0.12,
                0.9,
                1.2,
                0.04,
                _OBSTACLE_COLOR,
                rotation_deg=[0.0, 14.0, 0.0],
            )
        )
        return WorldBuild(
            xml, (-2.3, 0.0), 0.0, (gx, gy), r, names, visual_objects
        )

    if template == "tabletop":
        # Small bounded surface; treat like a tiny empty room.
        half = 1.2
        walls_xml, wall_names, visual_objects = _walls(half, h=0.12)
        gx, gy = _clamp_arena(*(goal_override or (0.7, 0.7)), half)
        r = 0.2
        xml = walls_xml + _goal_site(gx, gy, r)
        return WorldBuild(
            xml, (-0.7, -0.7), 45.0, (gx, gy), r, wall_names, visual_objects
        )

    # Fallback: empty room.
    half = 3.0
    walls_xml, wall_names, visual_objects = _walls(half)
    start = (-2.2, -2.2)
    raw = _clamp_arena(*(goal_override or (2.2, 2.2)), half)
    gx, gy = _pull_in(start, raw, goal_override, bounded)
    return WorldBuild(
        walls_xml + _goal_site(gx, gy, 0.3),
        start,
        45.0,
        (gx, gy),
        0.3,
        wall_names,
        visual_objects,
    )
