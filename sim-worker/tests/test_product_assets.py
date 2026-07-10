from __future__ import annotations

import json

import mujoco
import pytest

from conftest import nav_assembly
from hackshop_sim import ir
from hackshop_sim.assets.resolve import resolve, resolve_component_asset
from hackshop_sim.ir import Assembly, SimulateOptions
from hackshop_sim.pipeline import run_pipeline
from hackshop_sim.runtime import run as runtime_run
from hackshop_sim.scene import worlds
from hackshop_sim.scene.compile import compile_scene


def _with_component_payload(assembly: Assembly, component: dict) -> Assembly:
    payload = assembly.model_dump(by_alias=True)
    payload["components"].append(component)
    return Assembly.model_validate(payload)


def test_ir_mirrors_typed_criteria_and_extended_sim_handle():
    payload = nav_assembly("empty-room").model_dump(by_alias=True)
    payload["goal"]["criteria"] = {
        "position_tolerance_m": 0.2,
        "dwell_s": 1.5,
        "max_collision_events": 0,
        "require_upright": True,
    }
    payload["components"][1]["sim"] = {
        "asset_id": "raspberry-pi-5",
        "asset_version": "1",
        "dimensions_m": [0.085, 0.056, 0.017],
        "fidelity": "dimensioned-proxy",
        "mass_kg": 0.045,
    }

    assembly = Assembly.model_validate(payload)
    dumped = assembly.model_dump(mode="json", by_alias=True, exclude_none=True)

    assert dumped["goal"]["criteria"] == payload["goal"]["criteria"]
    assert dumped["components"][1]["sim"] == payload["components"][1]["sim"]


@pytest.mark.parametrize(
    "invalid_handle",
    [
        {"asset_id": ""},
        {"asset_version": ""},
        {"dimensions_m": [0.085, -0.056, 0.017]},
        {"mass_kg": 0},
    ],
)
def test_sim_handle_rejects_values_rejected_by_the_typescript_contract(invalid_handle):
    with pytest.raises(ValueError):
        ir.SimHandle.model_validate(invalid_handle)


def test_turtlebot_4_lite_resolves_to_its_canonical_dimensioned_manifest():
    assembly = nav_assembly("empty-room")
    assembly.components[0].device_id = "turtlebot-4-lite"

    robot = resolve(assembly).robot

    assert robot is not None
    assert robot.device_id == "turtlebot-4-lite"
    assert robot.asset_id == "turtlebot-4-lite"
    assert robot.fidelity == "dimensioned-proxy"
    assert robot.shape == "cylinder"
    assert robot.dimensions_m == pytest.approx((0.341, 0.339, 0.192))
    assert robot.mass_kg == pytest.approx(3.3)


def test_legacy_turtlebot_alias_resolves_to_canonical_product():
    assembly = nav_assembly("empty-room")
    assembly.components[0].device_id = "turtlebot4"

    robot = resolve(assembly).robot

    assert robot is not None
    assert robot.device_id == "turtlebot-4-lite"
    assert robot.asset_id == "turtlebot-4-lite"


def test_create_3_navigation_requires_a_declared_2d_lidar():
    payload = nav_assembly("empty-room").model_dump(by_alias=True)
    payload["components"] = [
        component for component in payload["components"] if component["role"] != "sensor"
    ]
    payload["edges"] = [
        edge
        for edge in payload["edges"]
        if edge["from"] != "lidar" and edge["to"] != "lidar"
    ]

    resolution = resolve(Assembly.model_validate(payload))

    assert resolution.supported is False
    assert "2D lidar" in resolution.reason


def test_registered_chassis_rejects_unavailable_asset_version():
    assembly = nav_assembly("empty-room")
    assembly.components[0].sim = ir.SimHandle(
        asset_id="irobot-create-3",
        asset_version="999",
    )

    resolution = resolve(assembly)

    assert resolution.supported is False
    assert "version '999'" in resolution.reason
    assert "registered version is '1'" in resolution.reason


def test_registered_chassis_rejects_format_without_a_loaded_model():
    assembly = nav_assembly("empty-room")
    assembly.components[0].sim = ir.SimHandle(
        asset_id="irobot-create-3",
        asset_version="1",
        format="urdf",
        model_uri="https://example.invalid/create3.urdf",
        fidelity="device-model",
    )

    resolution = resolve(assembly)

    assert resolution.supported is False
    assert "format 'urdf'" in resolution.reason
    assert "loaded format is 'proxy'" in resolution.reason


def test_registered_chassis_reports_loaded_manifest_fidelity():
    assembly = nav_assembly("empty-room")
    assembly.components[0].sim = ir.SimHandle(
        asset_id="irobot-create-3",
        asset_version="1",
        fidelity="device-model",
    )

    resolution = resolve(assembly)

    assert resolution.supported is True
    assert resolution.robot is not None
    assert resolution.robot.asset_id == "irobot-create-3"
    assert resolution.robot.asset_version == "1"
    assert resolution.robot.fidelity == "dimensioned-proxy"


def test_registered_chassis_reports_canonical_manifest_asset_id():
    assembly = nav_assembly("empty-room")
    assembly.components[0].device_id = "turtlebot-4-lite"
    assembly.components[0].sim = ir.SimHandle(
        asset_id="turtlebot4",
        asset_version="1",
    )

    resolution = resolve(assembly)

    assert resolution.supported is True
    assert resolution.robot is not None
    assert resolution.robot.asset_id == "turtlebot-4-lite"


def test_create_3_uses_cylindrical_chassis_dimensions_in_mujoco():
    assembly = nav_assembly("empty-room")
    robot = resolve(assembly).robot
    assert robot is not None

    scene = compile_scene(assembly, robot)
    model = mujoco.MjModel.from_xml_string(scene.xml)
    chassis = model.geom("chassis")

    assert robot.shape == "cylinder"
    assert robot.dimensions_m == pytest.approx((0.34, 0.34, 0.09))
    assert model.geom_type[chassis.id] == mujoco.mjtGeom.mjGEOM_CYLINDER
    assert model.geom_size[chassis.id][:2] == pytest.approx([0.17, 0.027])

    # The registered dimensions are an outer base envelope: wheels and the
    # visual nose marker must stay inside it rather than silently making a
    # taller/longer collision model.
    chassis_body = model.body("chassis")
    left_wheel = model.body("left_wheel")
    nose = model.geom("nose")
    assert chassis_body.pos[2] == pytest.approx(0.063)
    assert chassis_body.pos[2] + left_wheel.pos[2] == pytest.approx(0.036)
    assert float(nose.pos[0] + nose.size[0]) <= 0.170001


def test_registered_and_explicit_part_dimensions_drive_proxy_geometry():
    assembly = nav_assembly("empty-room")
    assembly.components[1].sim = ir.SimHandle.model_validate(
        {
            "asset_id": "raspberry-pi-5",
            "dimensions_m": [0.12, 0.08, 0.03],
            "fidelity": "dimensioned-proxy",
            "mass_kg": 0.2,
        }
    )
    assembly = _with_component_payload(
        assembly,
        {
            "ref": "tof",
            "device_id": "adafruit-vl53l4cd",
            "name": "Adafruit VL53L4CD",
            "role": "sensor",
        },
    )
    robot = resolve(assembly).robot
    assert robot is not None

    scene = compile_scene(assembly, robot)
    model = mujoco.MjModel.from_xml_string(scene.xml)
    pi_geom = model.geom("part_pi")
    tof_geom = model.geom("part_tof")

    assert model.geom_type[pi_geom.id] == mujoco.mjtGeom.mjGEOM_BOX
    assert model.geom_size[pi_geom.id] == pytest.approx([0.06, 0.04, 0.015])
    assert model.geom_type[tof_geom.id] == mujoco.mjtGeom.mjGEOM_BOX
    assert model.geom_size[tof_geom.id] == pytest.approx([0.01275, 0.00885, 0.00235])

    mounted = {part["ref"]: part for part in scene.mounted}
    assert mounted["pi"]["dimensions_m"] == pytest.approx([0.12, 0.08, 0.03])
    assert mounted["pi"]["mass_kg"] == pytest.approx(0.2)
    assert mounted["tof"]["dimensions_m"] == pytest.approx([0.0255, 0.0177, 0.0047])
    assert mounted["tof"]["mass_kg"] == pytest.approx(0.002)
    for part in mounted.values():
        assert len(part["position_m"]) == 3
        assert part["shape"] in {"box", "cylinder", "sphere"}
        assert part["color"].startswith("#")


def test_registered_part_reports_loaded_manifest_version_and_fidelity():
    assembly = nav_assembly("empty-room")
    component = assembly.components[1]
    component.sim = ir.SimHandle(
        asset_id="raspberry-pi-5",
        asset_version="999",
        fidelity="device-model",
    )

    asset = resolve_component_asset(component)

    assert asset.asset_id == "raspberry-pi-5"
    assert asset.asset_version == "1"
    assert asset.fidelity == "dimensioned-proxy"


def test_pipeline_returns_inline_robot_visual_metadata(tmp_path):
    assembly = nav_assembly("empty-room")
    output = run_pipeline(
        assembly,
        SimulateOptions(duration_s=0.05, render=False),
        tmp_path,
    )

    robot = output["robot"]
    assert robot["shape"] == "cylinder"
    assert robot["dimensions_m"] == pytest.approx([0.34, 0.34, 0.09])
    assert robot["color"].startswith("#")
    assert robot["fidelity"] == "dimensioned-proxy"
    assert robot["asset_id"] == "irobot-create-3"
    mounted = {part["ref"]: part for part in robot["mounted_parts"]}
    assert mounted["pi"]["dimensions_m"] == pytest.approx(
        [0.085, 0.056, 0.017]
    )
    assert mounted["lidar"]["asset_id"] == "rplidar-a1m8"


def test_zero_collision_typed_criterion_overrides_reached_state():
    criteria_type = getattr(ir, "GoalCriteria", None)
    evaluate_success = getattr(runtime_run, "evaluate_success", None)
    assert criteria_type is not None, "typed GoalCriteria is missing"
    assert evaluate_success is not None, "typed success evaluator is missing"

    criteria = criteria_type(
        position_tolerance_m=0.3,
        dwell_s=1.0,
        max_collision_events=0,
        require_upright=True,
    )
    success, checks = evaluate_success(
        reached=True,
        tipped=False,
        collision_events=1,
        criteria=criteria,
    )

    assert success is False
    assert checks["position"] is True
    assert checks["collision_events"] is False
    assert checks["upright"] is True


def test_goal_criteria_rejects_absurd_position_tolerance():
    with pytest.raises(ValueError):
        ir.GoalCriteria(
            position_tolerance_m=100.0,
            dwell_s=0.0,
            max_collision_events=0,
            require_upright=True,
        )


def test_typed_criteria_are_reported_as_the_applied_scoring_contract(tmp_path):
    payload = nav_assembly("empty-room").model_dump(by_alias=True)
    payload["goal"]["criteria"] = {
        "position_tolerance_m": 0.17,
        "dwell_s": 0.4,
        "max_collision_events": 0,
        "require_upright": True,
    }
    output = run_pipeline(
        Assembly.model_validate(payload),
        SimulateOptions(duration_s=0.05, render=False),
        tmp_path,
    )

    telemetry = output["telemetry"]
    assert telemetry["success_radius"] == pytest.approx(0.17)
    assert telemetry["success_dwell_s"] == pytest.approx(0.4)
    assert telemetry["criteria"]["max_collision_events"] == 0
    assert telemetry["criteria"]["require_upright"] is True
    assert telemetry["criteria_checks"] == {
        "position": False,
        "collision_events": True,
        "upright": True,
    }


def test_world_visual_objects_match_physics_and_are_persisted_for_replay(tmp_path):
    obstacle_world = worlds.build("obstacle-course", None)
    objects = {item["name"]: item for item in obstacle_world.visual_objects}

    assert objects["wall_n"] == {
        "name": "wall_n",
        "shape": "box",
        "position_m": [0.0, 3.0, 0.125],
        "dimensions_m": [6.0, 0.1, 0.25],
        "color": "#73777F",
    }
    assert objects["pillar_a"] == {
        "name": "pillar_a",
        "shape": "cylinder",
        "position_m": [-1.45, -0.65, 0.2],
        "dimensions_m": [0.44, 0.44, 0.4],
        "color": "#D9594D",
    }

    ramp_objects = {item["name"]: item for item in worlds.build("ramp", None).visual_objects}
    assert ramp_objects["ramp"]["rotation_deg"] == [0.0, 14.0, 0.0]
    assert ramp_objects["ramp"]["dimensions_m"] == [1.8, 2.4, 0.08]

    run_pipeline(
        nav_assembly("obstacle-course"),
        SimulateOptions(duration_s=0.05, render=False),
        tmp_path,
    )
    trajectory = json.loads((tmp_path / "trajectory.json").read_text())
    assert trajectory["meta"]["world_objects"] == obstacle_world.visual_objects
