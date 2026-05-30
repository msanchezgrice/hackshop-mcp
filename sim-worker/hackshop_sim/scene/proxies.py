"""Parametric proxy bodies. Honest "proxy dynamics": primitive shapes with real
mass / wheelbase / wheel radius from the asset spec, not scanned CAD.

The diff-drive proxy is a box chassis on two driven hinge wheels plus two
frictionless ball casters (front/back) so it balances like a real round base.
Velocity actuators on each wheel are driven by the runtime from (v, w) commands.

Crucially, the *whole assembly* is built onto the chassis: every non-chassis
component (compute, sensor, power, display, ...) is mounted as a rigid payload
geom with its real (or role-default) mass. So the thing navigating the world is
the proposed buildout, not a bare base — the extra mass and raised center of
mass actually influence stability/tipping, which is the feasibility signal.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional

from ..assets.resolve import RobotSpec
from ..ir import AssemblyComponent


@dataclass
class RobotBuild:
    body_xml: str
    actuator_xml: str
    chassis_body: str
    left_actuator: str
    right_actuator: str
    wheel_base_m: float
    wheel_radius_m: float
    max_wheel_rad_s: float
    spawn_z: float
    mounted: List[dict] = field(default_factory=list)
    total_mass_kg: float = 0.0


# Role -> how to render/mass a mounted part. half-sizes in metres; `mass` is the
# fallback when the component carries no explicit sim mass. `low` parts sit deep
# in the chassis (battery -> keeps CoM down); `mast` raises a sensor on a stalk;
# `upright` stands a thin slab up like a screen.
_ROLE_PART = {
    "power": dict(hs=(0.055, 0.045, 0.022), mass=0.40, mat="part_power", low=True),
    "compute": dict(hs=(0.045, 0.038, 0.012), mass=0.10, mat="part_compute"),
    "sensor": dict(hs=(0.028, 0.028, 0.022), mass=0.17, mat="part_sensor", mast=True),
    "display": dict(hs=(0.006, 0.06, 0.045), mass=0.20, mat="part_display", upright=True),
    "actuator": dict(hs=(0.032, 0.032, 0.026), mass=0.15, mat="part_actuator"),
    "peripheral": dict(hs=(0.03, 0.026, 0.02), mass=0.08, mat="part_misc"),
}
# Front-to-back ordering on the deck (sensors look forward; battery is low/centre).
_ROLE_ORDER = {"sensor": 0, "compute": 1, "actuator": 2, "peripheral": 3, "display": 4}


def _safe(ref: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", ref) or "part"


def _mount_parts(
    components: List[AssemblyComponent],
    hx: float,
    hy: float,
    hz: float,
) -> tuple[str, float, List[dict]]:
    """Build payload geoms for every non-chassis component on the chassis deck.

    Returns (xml, added_mass_kg, mounted[]) where mounted lists what was placed.
    """
    parts = [c for c in components if c.role != "chassis"]
    if not parts:
        return "", 0.0, []

    deck_z = hz  # top surface of the chassis box, local frame
    low_items = [c for c in parts if _ROLE_PART.get(c.role, {}).get("low")]
    deck_items = [c for c in parts if not _ROLE_PART.get(c.role, {}).get("low")]
    deck_items.sort(key=lambda c: _ROLE_ORDER.get(c.role, 9))

    xml = ""
    added = 0.0
    mounted: List[dict] = []
    used_names: set[str] = set()

    def uniq(base: str) -> str:
        name = base
        i = 1
        while name in used_names:
            i += 1
            name = f"{base}_{i}"
        used_names.add(name)
        return name

    # Deck items spread front->back within the chassis footprint so they never
    # poke outside it (and thus never collide before the chassis itself does).
    n = len(deck_items)
    xs: List[float]
    if n == 0:
        xs = []
    elif n == 1:
        xs = [0.0]
    else:
        lo, hi = hx * 0.55, -hx * 0.55  # front (+x) to back (-x)
        xs = [round(lo + (hi - lo) * i / (n - 1), 4) for i in range(n)]

    for c, px in zip(deck_items, xs):
        spec = _ROLE_PART.get(c.role, _ROLE_PART["peripheral"])
        sx, sy, sz = spec["hs"]
        sx, sy = min(sx, hx * 0.42), min(sy, hy * 0.8)
        mass = float(c.sim.mass_kg) if (c.sim and c.sim.mass_kg) else float(spec["mass"])
        mat = spec["mat"]
        name = uniq(f"part_{_safe(c.ref)}")

        if spec.get("mast"):
            # thin stalk + puck on top -> raises CoM (honest tip risk on ramps)
            mast_h = 0.05
            mast_z = deck_z + mast_h / 2
            puck_z = deck_z + mast_h + sz
            xml += (
                f'\n      <geom name="{name}_mast" type="cylinder" pos="{px} 0 {round(mast_z,4)}" '
                f'size="0.006 {round(mast_h/2,4)}" mass="0.01" material="part_misc" group="3"/>'
                f'\n      <geom name="{name}" type="cylinder" pos="{px} 0 {round(puck_z,4)}" '
                f'size="{round(sx,4)} {round(sz,4)}" mass="{round(mass,4)}" material="{mat}" group="3"/>'
            )
            added += mass + 0.01
        elif spec.get("upright"):
            cz = deck_z + sz
            xml += (
                f'\n      <geom name="{name}" type="box" pos="{px} 0 {round(cz,4)}" '
                f'size="{round(sx,4)} {round(sy,4)} {round(sz,4)}" mass="{round(mass,4)}" '
                f'material="{mat}" group="3"/>'
            )
            added += mass
        else:
            cz = deck_z + sz
            xml += (
                f'\n      <geom name="{name}" type="box" pos="{px} 0 {round(cz,4)}" '
                f'size="{round(sx,4)} {round(sy,4)} {round(sz,4)}" mass="{round(mass,4)}" '
                f'material="{mat}" group="3"/>'
            )
            added += mass
        mounted.append({"ref": c.ref, "name": c.name, "role": c.role, "mass_kg": round(mass, 4)})

    # Low items (battery) embedded near the chassis centre to keep CoM down.
    for c in low_items:
        spec = _ROLE_PART[c.role]
        sx, sy, sz = spec["hs"]
        sx, sy = min(sx, hx * 0.6), min(sy, hy * 0.85)
        mass = float(c.sim.mass_kg) if (c.sim and c.sim.mass_kg) else float(spec["mass"])
        name = uniq(f"part_{_safe(c.ref)}")
        xml += (
            f'\n      <geom name="{name}" type="box" pos="0 0 0" '
            f'size="{round(sx,4)} {round(sy,4)} {round(sz,4)}" mass="{round(mass,4)}" '
            f'material="{spec["mat"]}" group="3"/>'
        )
        added += mass
        mounted.append({"ref": c.ref, "name": c.name, "role": c.role, "mass_kg": round(mass, 4)})

    return xml, round(added, 4), mounted


def diff_drive(
    spec: RobotSpec,
    start_xy: tuple[float, float],
    start_yaw_deg: float,
    components: Optional[List[AssemblyComponent]] = None,
) -> RobotBuild:
    wr = spec.wheel_radius_m
    wb = spec.wheel_base_m
    ch = spec.chassis_height_m
    cr = spec.chassis_radius_m
    # Chassis half-extents: a box inscribed in the round footprint.
    hx = round(cr * 0.78, 4)
    hy = round(cr * 0.62, 4)
    hz = round(ch / 2.0, 4)
    # Chassis center height so wheels (children, lowered by hz) rest on the floor
    # with their centers at z=wr, and the chassis underside clears the ground.
    z0 = round(wr + hz, 4)
    wheel_half_thick = 0.02
    # Tricycle stance so the contact set is statically *determinate* and the
    # drive wheels actually carry weight (a 4-point square dumps load onto the
    # casters and the wheels just slip). Wheels sit slightly behind center; one
    # front caster is the load-bearing 3rd point; a rear caster with a small
    # clearance gap only catches a backward tip.
    wheel_x = round(-cr * 0.12, 4)
    caster_r = round(wr * 0.55, 4)
    caster_x = round(cr * 0.62, 4)
    rear_gap = 0.006
    wheel_lz = round(wr - z0, 4)
    caster_front_lz = round(caster_r - z0, 4)
    caster_back_lz = round(caster_r + rear_gap - z0, 4)

    chassis_mass = round(max(spec.mass_kg - 0.4, 0.2), 4)
    wheel_mass = 0.2
    sx, sy = start_xy

    # Mount the rest of the assembly (compute/sensors/power/...) onto the deck.
    payload_xml, added_mass, mounted = _mount_parts(components or [], hx, hy, hz)

    # Chase camera bolted to the chassis. pos/xyaxes are in the chassis LOCAL
    # frame (the body carries the world yaw), so the offset is relative to the
    # robot: 1.9 m behind (local -x), 1.55 m up, pitched ~38° down looking
    # forward (local +x). mode="track" keeps that pose fixed in the WORLD frame
    # and only translates it with the body — a steady 3/4 chase that follows the
    # robot itself (not the whole-model COM, which the obstacles would otherwise
    # dominate, parking the rover at the frame edge).
    cam_local = 'pos="-1.9 0 1.55" xyaxes="0 -1 0 0.616 0 0.788"'

    # All robot geoms live in group 3 so the runtime's ray-cast rangefinder can
    # mask them out (it only senses the world, not its own body).
    body_xml = f"""
    <body name="chassis" pos="{sx} {sy} {z0}" euler="0 0 {start_yaw_deg}">
      <freejoint name="root"/>
      <camera name="chase" {cam_local} mode="track"/>
      <geom name="chassis" type="box" size="{hx} {hy} {hz}" mass="{chassis_mass}" material="robot" group="3"/>
      <!-- heading nose marker (visual only) -->
      <geom name="nose" type="box" pos="{round(hx + 0.03, 4)} 0 0" size="0.03 {round(hy * 0.4, 4)} {round(hz * 0.5, 4)}" mass="0.001" material="nose" group="3"/>
      <body name="left_wheel" pos="{wheel_x} {round(wb / 2.0, 4)} {wheel_lz}">
        <joint name="left" type="hinge" axis="0 1 0" damping="0.01" armature="0.002"/>
        <geom type="cylinder" size="{wr} {wheel_half_thick}" euler="90 0 0" mass="{wheel_mass}" material="wheel" friction="2.5 0.02 0.001" group="3"/>
      </body>
      <body name="right_wheel" pos="{wheel_x} {round(-wb / 2.0, 4)} {wheel_lz}">
        <joint name="right" type="hinge" axis="0 1 0" damping="0.01" armature="0.002"/>
        <geom type="cylinder" size="{wr} {wheel_half_thick}" euler="90 0 0" mass="{wheel_mass}" material="wheel" friction="2.5 0.02 0.001" group="3"/>
      </body>
      <geom name="caster_front" type="sphere" pos="{caster_x} 0 {caster_front_lz}" size="{caster_r}" mass="0.04" friction="0.05 0.005 0.0001" material="wheel" group="3"/>
      <geom name="caster_back" type="sphere" pos="{round(-caster_x, 4)} 0 {caster_back_lz}" size="{caster_r}" mass="0.04" friction="0.05 0.005 0.0001" material="wheel" group="3"/>{payload_xml}
    </body>"""

    total_mass = round(chassis_mass + 2 * wheel_mass + 0.08 + added_mass, 4)

    # Torque-limited velocity servo: a small base can't apply infinite wheel
    # torque, and the cap keeps startup from launching the chassis.
    kv = 18.0
    mw = round(spec.max_wheel_rad_s, 4)
    actuator_xml = f"""
    <velocity name="left_v" joint="left" kv="{kv}" ctrlrange="-{mw} {mw}" forcerange="-2.5 2.5"/>
    <velocity name="right_v" joint="right" kv="{kv}" ctrlrange="-{mw} {mw}" forcerange="-2.5 2.5"/>"""

    return RobotBuild(
        body_xml=body_xml,
        actuator_xml=actuator_xml,
        chassis_body="chassis",
        left_actuator="left_v",
        right_actuator="right_v",
        wheel_base_m=wb,
        wheel_radius_m=wr,
        max_wheel_rad_s=spec.max_wheel_rad_s,
        spawn_z=z0,
        mounted=mounted,
        total_mass_kg=total_mass,
    )
