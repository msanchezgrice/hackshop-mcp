import mujoco
import pytest

from conftest import full_assembly, nav_assembly
from hackshop_sim.assets.resolve import resolve
from hackshop_sim.scene.compile import compile_scene


@pytest.mark.parametrize(
    "template", ["empty-room", "obstacle-course", "ramp", "tabletop"]
)
def test_scene_compiles_and_loads_in_mujoco(template):
    asm = nav_assembly(template)
    res = resolve(asm)
    assert res.supported and res.robot is not None
    scene = compile_scene(asm, res.robot)
    # MuJoCo must accept the generated MJCF.
    model = mujoco.MjModel.from_xml_string(scene.xml)
    assert model.nbody >= 4  # world + chassis + 2 wheels
    # actuators + goal site exist
    assert model.actuator(scene.left_actuator).id >= 0
    assert model.actuator(scene.right_actuator).id >= 0
    assert model.site("goal").id >= 0


def test_assembly_components_are_mounted_on_the_robot():
    """The whole buildout — not just the base — must end up in the sim."""
    asm = full_assembly("empty-room")
    res = resolve(asm)
    scene = compile_scene(asm, res.robot)

    # Every non-chassis component is mounted and reported.
    mounted_refs = {m["ref"] for m in scene.mounted}
    assert mounted_refs == {"pi", "lidar", "cam", "batt", "screen"}

    # The MJCF actually contains a geom per mounted part.
    model = mujoco.MjModel.from_xml_string(scene.xml)
    for ref in mounted_refs:
        assert model.geom(f"part_{ref}").id >= 0

    # Mounting real parts adds real mass over the bare base.
    assert scene.total_mass_kg > res.robot.mass_kg
    # Total system mass matches MuJoCo's accounting (base + wheels + payload).
    assert model.body("chassis").subtreemass[0] > res.robot.mass_kg


def test_unsupported_goal_kind_is_honest():
    asm = nav_assembly("empty-room")
    asm.goal.kind = "manipulate"
    res = resolve(asm)
    assert res.supported is False
    assert "not simulatable yet" in res.reason
