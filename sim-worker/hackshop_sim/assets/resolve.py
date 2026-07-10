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
from typing import Optional, Tuple

from ..ir import Assembly, AssemblyComponent

_REGISTRY_PATH = Path(__file__).with_name("registry.json")


@lru_cache(maxsize=1)
def _registry() -> dict:
    return json.loads(_REGISTRY_PATH.read_text())


@dataclass
class RobotSpec:
    kind: str  # "diff_drive"
    device_id: str
    asset_id: str
    asset_version: str
    fidelity: str
    shape: str
    dimensions_m: Tuple[float, float, float]
    color: str
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


@dataclass(frozen=True)
class ComponentAsset:
    asset_id: str
    asset_version: str
    fidelity: str
    shape: Optional[str]
    dimensions_m: Optional[Tuple[float, float, float]]
    color: Optional[str]
    mass_kg: Optional[float]


def _canonical_id(device_id: str) -> str:
    return _registry().get("aliases", {}).get(device_id, device_id)


def _entry_for_asset(asset_id: str) -> tuple[str, Optional[dict]]:
    """Resolve either a canonical device id, legacy alias, or manifest asset id."""
    reg = _registry()
    canonical = _canonical_id(asset_id)
    entry = reg["devices"].get(canonical)
    if entry is not None:
        return canonical, entry
    for device_id, candidate in reg["devices"].items():
        if candidate.get("asset_id") == asset_id:
            return device_id, candidate
    return canonical, None


def _spec_from_entry(device_id: str, entry: dict) -> RobotSpec:
    dimensions = entry.get(
        "dimensions_m",
        [
            float(entry["chassis_radius_m"]) * 2.0,
            float(entry["chassis_radius_m"]) * 2.0,
            float(entry["chassis_height_m"]),
        ],
    )
    return RobotSpec(
        kind=entry["kind"],
        device_id=device_id,
        asset_id=entry.get("asset_id", device_id),
        asset_version=str(entry.get("asset_version", "1")),
        fidelity=entry.get("fidelity", "generic-placeholder"),
        shape=entry.get("shape", "box"),
        dimensions_m=tuple(float(v) for v in dimensions),
        color=entry.get("color", "#3478F6"),
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


def resolve_component_asset(component: AssemblyComponent) -> ComponentAsset:
    """Resolve product geometry while keeping manifest identity authoritative."""
    requested_asset = (
        component.sim.asset_id
        if component.sim is not None and component.sim.asset_id
        else component.device_id
    )
    canonical_id, entry = _entry_for_asset(requested_asset)
    dimensions = entry.get("dimensions_m") if entry else None
    mass = entry.get("mass_kg") if entry else None
    fidelity = (
        entry.get("fidelity", "generic-placeholder")
        if entry
        else "generic-placeholder"
    )

    if component.sim is not None:
        if component.sim.dimensions_m is not None:
            dimensions = component.sim.dimensions_m
        if component.sim.mass_kg is not None:
            mass = component.sim.mass_kg

    asset_version = str(entry.get("asset_version", "1")) if entry else "1"

    return ComponentAsset(
        asset_id=(entry.get("asset_id", canonical_id) if entry else requested_asset),
        asset_version=asset_version,
        fidelity=fidelity,
        shape=entry.get("shape") if entry else None,
        dimensions_m=(tuple(float(v) for v in dimensions) if dimensions else None),
        color=entry.get("color") if entry else None,
        mass_kg=float(mass) if mass is not None else None,
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
    chassis = [c for c in assembly.components if c.role == "chassis"]
    chosen_component: Optional[AssemblyComponent] = None
    chosen_id = None
    chosen_entry = None
    for component in chassis:
        requested_asset = (
            component.sim.asset_id
            if component.sim is not None and component.sim.asset_id
            else component.device_id
        )
        canonical_id, entry = _entry_for_asset(requested_asset)
        if entry is not None and entry.get("kind") == "diff_drive":
            if (
                component.sim is not None
                and component.sim.asset_version is not None
                and component.sim.asset_version
                != str(entry.get("asset_version", "1"))
            ):
                return Resolution(
                    supported=False,
                    reason=(
                        f"asset '{entry.get('asset_id', canonical_id)}' version "
                        f"'{component.sim.asset_version}' is unavailable; registered "
                        f"version is '{entry.get('asset_version', '1')}'"
                    ),
                )
            if (
                component.sim is not None
                and component.sim.format is not None
                and component.sim.format != entry.get("format", "proxy")
            ):
                return Resolution(
                    supported=False,
                    reason=(
                        f"asset '{entry.get('asset_id', canonical_id)}' format "
                        f"'{component.sim.format}' is unavailable; loaded format is "
                        f"'{entry.get('format', 'proxy')}'"
                    ),
                )
            chosen_component = component
            chosen_id = canonical_id
            chosen_entry = entry
            break
    if chosen_component is None and chassis:
        chosen_component = chassis[0]
        chosen_id = _canonical_id(chosen_component.device_id)

    if chosen_entry is not None and chosen_id is not None:
        spec = _spec_from_entry(chosen_id, chosen_entry)
    else:
        spec = _spec_from_entry(
            chosen_id or "generic-diff-drive", reg["default_diff_drive"]
        )
        # The placeholder describes this requested chassis, not a product it is
        # pretending to recognize.
        spec.device_id = chosen_id or "generic-diff-drive"

    # The current controller consumes a sparse planar lidar scan. Only run it
    # when the selected integrated base or an explicit component manifest
    # declares that observation model; otherwise a passing rollout would rely
    # on sensors the proposed product does not contain.
    has_planar_lidar = bool(
        chosen_entry is not None
        and chosen_entry.get("observation_model") == "2d-lidar"
    )
    if not has_planar_lidar:
        for component in assembly.components:
            requested_asset = (
                component.sim.asset_id
                if component.sim is not None and component.sim.asset_id
                else component.device_id
            )
            _, component_entry = _entry_for_asset(requested_asset)
            if (
                component_entry is not None
                and component_entry.get("observation_model") == "2d-lidar"
            ):
                has_planar_lidar = True
                break
    if not has_planar_lidar:
        return Resolution(
            supported=False,
            reason=(
                "the navigation controller requires a declared 2D lidar; "
                "this assembly does not include the observation hardware the "
                "rollout would consume"
            ),
        )

    # An assembly may refine physical dimensions/mass, but the loaded manifest
    # remains authoritative for asset identity, version, format, and fidelity.
    if chosen_component is not None and chosen_component.sim is not None:
        handle = chosen_component.sim
        if handle.mass_kg is not None:
            spec.mass_kg = float(handle.mass_kg)
        if handle.dimensions_m is not None:
            spec.dimensions_m = tuple(float(v) for v in handle.dimensions_m)
            spec.chassis_radius_m = min(spec.dimensions_m[0:2]) / 2.0
            spec.chassis_height_m = spec.dimensions_m[2]

    return Resolution(supported=True, robot=spec)
