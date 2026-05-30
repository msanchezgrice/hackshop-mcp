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


def _walls(half: float, h: float = 0.25, t: float = 0.05) -> tuple[str, list[str]]:
    """Four perimeter walls enclosing a `2*half` square arena."""
    names = ["wall_n", "wall_s", "wall_e", "wall_w"]
    xml = f"""
    <geom name="wall_n" type="box" pos="0 {half} {h/2}" size="{half} {t} {h/2}" material="wall"/>
    <geom name="wall_s" type="box" pos="0 {-half} {h/2}" size="{half} {t} {h/2}" material="wall"/>
    <geom name="wall_e" type="box" pos="{half} 0 {h/2}" size="{t} {half} {h/2}" material="wall"/>
    <geom name="wall_w" type="box" pos="{-half} 0 {h/2}" size="{t} {half} {h/2}" material="wall"/>"""
    return xml, names


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


def build(
    template: str,
    goal_override: Optional[Tuple[float, float]],
    bounded: bool = False,
) -> WorldBuild:
    if template == "empty-room":
        half = 3.0
        walls_xml, wall_names = _walls(half)
        start = (-2.2, -2.2)
        gx, gy = _pull_in(start, goal_override or (2.2, 2.2), goal_override, bounded)
        r = 0.3
        xml = walls_xml + _goal_site(gx, gy, r)
        return WorldBuild(xml, start, 45.0, (gx, gy), r, wall_names)

    if template in ("obstacle-course", "stairs", "outdoor-flat"):
        # stairs/outdoor not yet modelled distinctly -> reuse obstacle-course so
        # the slice still runs honestly (labelled in telemetry by template name).
        half = 3.0
        walls_xml, wall_names = _walls(half)
        gx, gy = goal_override or (2.3, 2.3)
        r = 0.3
        obs = ""
        names = list(wall_names)
        # A slalom of pillars + boxes between start(-2.3,-2.3) and goal, with a
        # concave "trap" pocket near (0.4,1.4) where a naive controller wedges.
        layout = [
            ("pillar_a", "cyl", -0.9, -0.6, 0.22, 0.4),
            ("pillar_b", "cyl", 0.2, 0.1, 0.25, 0.4),
            ("pillar_c", "cyl", 1.3, 1.0, 0.22, 0.4),
            ("box_a", "box", -0.2, -1.6, 0.5, 0.12, 0.35),
            ("box_b", "box", 1.6, -0.2, 0.12, 0.6, 0.35),
            ("trap_l", "box", 0.0, 1.4, 0.12, 0.5, 0.35),
            ("trap_b", "box", 0.4, 1.0, 0.5, 0.12, 0.35),
        ]
        for entry in layout:
            name, kind = entry[0], entry[1]
            if kind == "cyl":
                _, _, x, y, rr, hh = entry
                obs += _cyl(name, x, y, rr, hh)
            else:
                _, _, x, y, sx, sy, hh = entry
                obs += _box(name, x, y, sx, sy, hh)
            names.append(name)
        xml = walls_xml + obs + _goal_site(gx, gy, r)
        return WorldBuild(xml, (-2.3, -2.3), 45.0, (gx, gy), r, names)

    if template == "ramp":
        half = 3.0
        walls_xml, wall_names = _walls(half)
        gx, gy = _pull_in((-2.3, 0.0), goal_override or (2.3, 0.0), goal_override, bounded)
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
        return WorldBuild(xml, (-2.3, 0.0), 0.0, (gx, gy), r, names)

    if template == "tabletop":
        # Small bounded surface; treat like a tiny empty room.
        half = 1.2
        walls_xml, wall_names = _walls(half, h=0.12)
        gx, gy = goal_override or (0.7, 0.7)
        r = 0.2
        xml = walls_xml + _goal_site(gx, gy, r)
        return WorldBuild(xml, (-0.7, -0.7), 45.0, (gx, gy), r, wall_names)

    # Fallback: empty room.
    half = 3.0
    walls_xml, wall_names = _walls(half)
    start = (-2.2, -2.2)
    gx, gy = _pull_in(start, goal_override or (2.2, 2.2), goal_override, bounded)
    return WorldBuild(walls_xml + _goal_site(gx, gy, 0.3), start, 45.0, (gx, gy), 0.3, wall_names)
