"""Dimensioned primitive bodies for the supported navigation slice.

These are deliberately honest proxies rather than pretend-CAD: registered
products use their real outer dimensions and mass, while unknown products are
clearly labelled generic placeholders. Mounted parts are rigid payloads so their
mass and placement participate in the MuJoCo dynamics.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from ..assets.resolve import RobotSpec, resolve_component_asset
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


# Role defaults are used only when neither the assembly nor registry supplies a
# product manifest. dimensions are full x/y/z extents in metres.
_ROLE_PART = {
    "power": dict(
        dimensions=(0.11, 0.09, 0.044), mass=0.40, mat="part_power",
        color="#34C759", shape="box", low=True,
    ),
    "compute": dict(
        dimensions=(0.09, 0.076, 0.024), mass=0.10, mat="part_compute",
        color="#24262B", shape="box",
    ),
    "sensor": dict(
        dimensions=(0.056, 0.056, 0.044), mass=0.17, mat="part_sensor",
        color="#19C2D1", shape="cylinder", mast=True,
    ),
    "display": dict(
        dimensions=(0.012, 0.12, 0.09), mass=0.20, mat="part_display",
        color="#F0F1F7", shape="box", upright=True,
    ),
    "actuator": dict(
        dimensions=(0.064, 0.064, 0.052), mass=0.15, mat="part_actuator",
        color="#E69E2E", shape="cylinder",
    ),
    "peripheral": dict(
        dimensions=(0.06, 0.052, 0.04), mass=0.08, mat="part_misc",
        color="#B88CF2", shape="box",
    ),
}
_ROLE_ORDER = {"sensor": 0, "compute": 1, "actuator": 2, "peripheral": 3, "display": 4}


def _safe(ref: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", ref) or "part"


def _half_extents(dimensions: Tuple[float, float, float]) -> Tuple[float, float, float]:
    return tuple(float(v) / 2.0 for v in dimensions)


def _geom_xml(
    *,
    name: str,
    shape: str,
    position: Tuple[float, float, float],
    dimensions: Tuple[float, float, float],
    mass: float,
    material: str,
) -> str:
    px, py, pz = (round(v, 5) for v in position)
    hx, hy, hz = _half_extents(dimensions)
    if shape == "cylinder":
        size = f'{round(min(hx, hy), 5)} {round(hz, 5)}'
        geom_type = "cylinder"
    elif shape == "sphere":
        size = f'{round(min(hx, hy, hz), 5)}'
        geom_type = "sphere"
    else:
        size = f'{round(hx, 5)} {round(hy, 5)} {round(hz, 5)}'
        geom_type = "box"
    return (
        f'\n      <geom name="{name}" type="{geom_type}" '
        f'pos="{px} {py} {pz}" size="{size}" mass="{round(mass, 5)}" '
        f'material="{material}" group="3"/>'
    )


def _resolved_part(component: AssemblyComponent) -> dict:
    fallback = _ROLE_PART.get(component.role, _ROLE_PART["peripheral"])
    asset = resolve_component_asset(component)
    return {
        "asset_id": asset.asset_id,
        "asset_version": asset.asset_version,
        "fidelity": asset.fidelity,
        "shape": asset.shape or fallback["shape"],
        "dimensions": asset.dimensions_m or fallback["dimensions"],
        "mass": asset.mass_kg if asset.mass_kg is not None else float(fallback["mass"]),
        "material": fallback["mat"],
        "color": asset.color or fallback["color"],
        "mast": bool(fallback.get("mast")),
        "low": bool(fallback.get("low")),
    }


def _mount_parts(
    components: List[AssemblyComponent],
    hx: float,
    hy: float,
    hz: float,
) -> tuple[str, float, List[dict]]:
    """Return payload MJCF, added mass, and browser-ready visual metadata."""
    parts = [c for c in components if c.role != "chassis"]
    if not parts:
        return "", 0.0, []

    resolved = {id(c): _resolved_part(c) for c in parts}
    low_items = [c for c in parts if resolved[id(c)]["low"]]
    deck_items = [c for c in parts if not resolved[id(c)]["low"]]
    deck_items.sort(key=lambda c: _ROLE_ORDER.get(c.role, 9))

    xml = ""
    added_mass = 0.0
    mounted: List[dict] = []
    used_names: set[str] = set()

    def uniq(base: str) -> str:
        name = base
        index = 1
        while name in used_names:
            index += 1
            name = f"{base}_{index}"
        used_names.add(name)
        return name

    if len(deck_items) == 0:
        xs: List[float] = []
    elif len(deck_items) == 1:
        xs = [0.0]
    else:
        front, back = hx * 0.55, -hx * 0.55
        xs = [
            round(front + (back - front) * i / (len(deck_items) - 1), 4)
            for i in range(len(deck_items))
        ]

    def add_part(component: AssemblyComponent, position: Tuple[float, float, float]) -> None:
        nonlocal xml, added_mass
        part = resolved[id(component)]
        name = uniq(f"part_{_safe(component.ref)}")
        dimensions = tuple(float(v) for v in part["dimensions"])
        mass = float(part["mass"])
        xml += _geom_xml(
            name=name,
            shape=part["shape"],
            position=position,
            dimensions=dimensions,
            mass=mass,
            material=part["material"],
        )
        added_mass += mass
        mounted.append(
            {
                "ref": component.ref,
                "name": component.name,
                "role": component.role,
                "asset_id": part["asset_id"],
                "asset_version": part["asset_version"],
                "fidelity": part["fidelity"],
                "mass_kg": round(mass, 5),
                "position_m": [round(v, 5) for v in position],
                "dimensions_m": [round(v, 5) for v in dimensions],
                "shape": part["shape"],
                "color": part["color"],
            }
        )

    for component, px in zip(deck_items, xs):
        part = resolved[id(component)]
        part_hz = float(part["dimensions"][2]) / 2.0
        if part["mast"]:
            mast_height = 0.05
            mast_position = (px, 0.0, hz + mast_height / 2.0)
            xml += _geom_xml(
                name=f"part_{_safe(component.ref)}_mast",
                shape="cylinder",
                position=mast_position,
                dimensions=(0.012, 0.012, mast_height),
                mass=0.01,
                material="part_misc",
            )
            added_mass += 0.01
            position = (px, 0.0, hz + mast_height + part_hz)
        else:
            position = (px, 0.0, hz + part_hz)
        add_part(component, position)

    # Batteries stay embedded near the chassis centre to keep the CoM low.
    for component in low_items:
        add_part(component, (0.0, 0.0, 0.0))

    return xml, round(added_mass, 5), mounted


def _chassis_geom(spec: RobotSpec, mass: float, body_height: float) -> str:
    dx, dy, _ = spec.dimensions_m
    hx, hy, _ = _half_extents(spec.dimensions_m)
    hz = body_height / 2.0
    if spec.shape == "cylinder":
        size = f"{round(min(dx, dy) / 2.0, 5)} {round(hz, 5)}"
        shape = "cylinder"
    elif spec.shape == "sphere":
        size = f"{round(min(hx, hy, hz), 5)}"
        shape = "sphere"
    else:
        size = f"{round(hx, 5)} {round(hy, 5)} {round(hz, 5)}"
        shape = "box"
    return (
        f'<geom name="chassis" type="{shape}" size="{size}" mass="{mass}" '
        'material="robot" group="3"/>'
    )


def diff_drive(
    spec: RobotSpec,
    start_xy: tuple[float, float],
    start_yaw_deg: float,
    components: Optional[List[AssemblyComponent]] = None,
) -> RobotBuild:
    wr = spec.wheel_radius_m
    wb = spec.wheel_base_m
    hx, hy, _ = _half_extents(spec.dimensions_m)
    envelope_height = spec.dimensions_m[2]
    body_height = max(envelope_height - wr, 0.01)
    body_hz = body_height / 2.0
    cr = min(hx, hy)
    # `dimensions_m` is the complete base envelope. Keep the collision body
    # above the floor/wheels, but shorten it so its top still lands exactly at
    # the declared envelope height.
    z0 = round(wr + body_hz, 5)
    wheel_half_thick = 0.02
    wheel_x = round(-cr * 0.12, 5)
    caster_r = round(wr * 0.55, 5)
    caster_x = round(cr * 0.62, 5)
    rear_gap = 0.006
    wheel_lz = round(wr - z0, 5)
    caster_front_lz = round(caster_r - z0, 5)
    caster_back_lz = round(caster_r + rear_gap - z0, 5)

    # Wheels + casters are part of the registered base mass.
    chassis_mass = round(max(spec.mass_kg - 0.48, 0.2), 5)
    wheel_mass = 0.2
    sx, sy = start_xy
    payload_xml, added_mass, mounted = _mount_parts(
        components or [], hx, hy, body_hz
    )
    chassis_xml = _chassis_geom(spec, chassis_mass, body_height)
    nose_half_depth = round(min(0.01, hx * 0.1), 5)
    nose_x = round(hx - nose_half_depth, 5)
    cam_local = 'pos="-1.9 0 1.55" xyaxes="0 -1 0 0.616 0 0.788"'

    body_xml = f"""
    <body name="chassis" pos="{sx} {sy} {z0}" euler="0 0 {start_yaw_deg}">
      <freejoint name="root"/>
      <camera name="chase" {cam_local} mode="track"/>
      {chassis_xml}
      <geom name="nose" type="box" pos="{nose_x} 0 0" size="{nose_half_depth} {round(hy * 0.4, 5)} {round(body_hz * 0.5, 5)}" mass="0.001" material="nose" group="3"/>
      <body name="left_wheel" pos="{wheel_x} {round(wb / 2.0, 5)} {wheel_lz}">
        <joint name="left" type="hinge" axis="0 1 0" damping="0.01" armature="0.002"/>
        <geom type="cylinder" size="{wr} {wheel_half_thick}" euler="90 0 0" mass="{wheel_mass}" material="wheel" friction="2.5 0.02 0.001" group="3"/>
      </body>
      <body name="right_wheel" pos="{wheel_x} {round(-wb / 2.0, 5)} {wheel_lz}">
        <joint name="right" type="hinge" axis="0 1 0" damping="0.01" armature="0.002"/>
        <geom type="cylinder" size="{wr} {wheel_half_thick}" euler="90 0 0" mass="{wheel_mass}" material="wheel" friction="2.5 0.02 0.001" group="3"/>
      </body>
      <geom name="caster_front" type="sphere" pos="{caster_x} 0 {caster_front_lz}" size="{caster_r}" mass="0.04" friction="0.05 0.005 0.0001" material="wheel" group="3"/>
      <geom name="caster_back" type="sphere" pos="{round(-caster_x, 5)} 0 {caster_back_lz}" size="{caster_r}" mass="0.04" friction="0.05 0.005 0.0001" material="wheel" group="3"/>{payload_xml}
    </body>"""

    total_mass = round(chassis_mass + 2 * wheel_mass + 0.08 + added_mass, 5)
    max_wheel = round(spec.max_wheel_rad_s, 5)
    actuator_xml = f"""
    <velocity name="left_v" joint="left" kv="18.0" ctrlrange="-{max_wheel} {max_wheel}" forcerange="-2.5 2.5"/>
    <velocity name="right_v" joint="right" kv="18.0" ctrlrange="-{max_wheel} {max_wheel}" forcerange="-2.5 2.5"/>"""

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
