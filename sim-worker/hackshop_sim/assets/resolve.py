"""Asset resolver: Assembly IR -> a simulatable robot spec.

Phase 1 only resolves the diff-drive navigation slice. It picks a registered
proxy by device_id (falling back to a generic parametric base) and reconciles
its mass with any declared component mass. Unsupported embodiments return
`supported=False` with a human-readable reason so the pipeline can degrade to a
feasibility-only result instead of fabricating physics.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional

from ..ir import Assembly

_REGISTRY_PATH = Path(__file__).with_name("registry.json")


@lru_cache(maxsize=1)
def _registry() -> dict:
    return json.loads(_REGISTRY_PATH.read_text())


@dataclass
class RobotSpec:
    kind: str  # "diff_drive"
    device_id: str
    provenance: str  # founder-verified | community-reported | llm-inferred | proxy
    mass_kg: float
    wheel_base_m: float
    wheel_radius_m: float
    chassis_radius_m: float
    chassis_height_m: float
    payload_kg: float
    max_wheel_rad_s: float
    notes: str


@dataclass
class Resolution:
    supported: bool
    robot: Optional[RobotSpec] = None
    reason: str = ""


def _spec_from_entry(device_id: str, entry: dict) -> RobotSpec:
    return RobotSpec(
        kind=entry["kind"],
        device_id=device_id,
        provenance=entry.get("provenance", "proxy"),
        mass_kg=float(entry["mass_kg"]),
        wheel_base_m=float(entry["wheel_base_m"]),
        wheel_radius_m=float(entry["wheel_radius_m"]),
        chassis_radius_m=float(entry["chassis_radius_m"]),
        chassis_height_m=float(entry["chassis_height_m"]),
        payload_kg=float(entry.get("payload_kg", 3.0)),
        max_wheel_rad_s=float(entry.get("max_wheel_rad_s", 12.0)),
        notes=entry.get("notes", ""),
    )


def resolve(assembly: Assembly) -> Resolution:
    """Pick a runnable robot model for the assembly, or explain why we can't."""
    reg = _registry()

    # Phase 1 scope: navigation on a wheeled base. locomote/manipulate land in
    # later phases (pretrained gait policies / arm models).
    if assembly.goal.kind not in ("navigate",):
        return Resolution(
            supported=False,
            reason=(
                f"goal kind '{assembly.goal.kind}' is not simulatable yet — "
                "Phase 1 covers wheeled navigation only. "
                "locomote/manipulate/sense-act arrive in later phases."
            ),
        )

    has_chassis = any(c.role == "chassis" for c in assembly.components)
    has_actuator = any(c.role == "actuator" for c in assembly.components)
    if not (has_chassis or has_actuator):
        return Resolution(
            supported=False,
            reason=(
                "no chassis or actuator in the assembly — nothing to drive. "
                "A navigation slice needs a mobile base."
            ),
        )

    # Prefer a chassis device_id that has a registered model; else first
    # chassis; else the generic proxy.
    chassis_ids = [c.device_id for c in assembly.components if c.role == "chassis"]
    chosen_id = None
    for did in chassis_ids:
        if did in reg["devices"]:
            chosen_id = did
            break
    if chosen_id is None and chassis_ids:
        chosen_id = chassis_ids[0]

    if chosen_id and chosen_id in reg["devices"]:
        spec = _spec_from_entry(chosen_id, reg["devices"][chosen_id])
    else:
        spec = _spec_from_entry(
            chosen_id or "generic-diff-drive", reg["default_diff_drive"]
        )

    # Reconcile mass: if a chassis component declares a sim mass, trust it.
    for c in assembly.components:
        if c.role == "chassis" and c.sim and c.sim.mass_kg:
            spec.mass_kg = float(c.sim.mass_kg)
            break

    return Resolution(supported=True, robot=spec)
