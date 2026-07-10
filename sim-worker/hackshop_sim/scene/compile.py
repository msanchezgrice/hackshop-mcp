"""Scene compiler: Assembly IR + resolved robot -> a complete MJCF document.

Returns the XML plus the metadata the runtime needs (goal position/radius,
robot body + actuator names, wheel geometry, obstacle geom names for collision
classification).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Tuple

from ..assets.resolve import RobotSpec
from ..ir import Assembly
from . import proxies, worlds


@dataclass
class SceneBuild:
    xml: str
    goal_xy: Tuple[float, float]
    goal_radius: float
    start_xy: Tuple[float, float]
    chassis_body: str
    left_actuator: str
    right_actuator: str
    wheel_base_m: float
    wheel_radius_m: float
    max_wheel_rad_s: float
    obstacle_geoms: List[str]
    world_objects: List[dict]
    template: str
    mounted: List[dict]
    total_mass_kg: float
    # Non-None when `template` is approximated by another layout (e.g. stairs ->
    # obstacle-course). Surfaced honestly in telemetry/summary, never hidden.
    approximated_as: Optional[str] = None


_ASSETS = """
  <visual>
    <global offwidth="640" offheight="480"/>
    <quality shadowsize="2048"/>
    <headlight ambient="0.4 0.4 0.4" diffuse="0.6 0.6 0.6"/>
  </visual>
  <asset>
    <texture name="sky" type="skybox" builtin="gradient" rgb1="0.5 0.7 0.95" rgb2="0.1 0.15 0.3" width="256" height="256"/>
    <texture name="grid" type="2d" builtin="checker" rgb1="0.22 0.24 0.28" rgb2="0.16 0.18 0.21" width="512" height="512" mark="edge" markrgb="0.4 0.42 0.46"/>
    <material name="grid" texture="grid" texrepeat="12 12" reflectance="0.05"/>
    <material name="robot" rgba="0.20 0.55 0.95 1"/>
    <material name="nose" rgba="0.98 0.85 0.20 1"/>
    <material name="wheel" rgba="0.12 0.12 0.14 1"/>
    <material name="wall" rgba="0.45 0.47 0.52 1"/>
    <material name="obstacle" rgba="0.85 0.35 0.30 1"/>
    <material name="goal" rgba="0.20 0.90 0.45 0.55"/>
    <material name="part_compute" rgba="0.14 0.15 0.18 1"/>
    <material name="part_sensor" rgba="0.10 0.80 0.88 1"/>
    <material name="part_power" rgba="0.20 0.78 0.38 1"/>
    <material name="part_display" rgba="0.93 0.94 0.97 1"/>
    <material name="part_actuator" rgba="0.90 0.62 0.18 1"/>
    <material name="part_misc" rgba="0.72 0.55 0.95 1"/>
  </asset>"""


# Studio render: the robot alone on a clean reflective stage, soft 3-point
# lighting + shadows, high resolution. Pure presentation — never simulated for
# telemetry. Cameras aim at the chassis body so framing is automatic.
STUDIO_CAMERAS = ["hero", "iso", "front", "side", "top"]

_STUDIO_ASSETS = """
  <visual>
    <global offwidth="1200" offheight="900" elevation="-20" azimuth="135"/>
    <quality shadowsize="4096" offsamples="8"/>
    <headlight ambient="0.32 0.32 0.36" diffuse="0.3 0.3 0.34" specular="0.25 0.25 0.25"/>
    <map shadowclip="1.5"/>
  </visual>
  <asset>
    <texture name="sky" type="skybox" builtin="gradient" rgb1="0.18 0.20 0.26" rgb2="0.03 0.04 0.06" width="256" height="256"/>
    <texture name="stage" type="2d" builtin="checker" rgb1="0.14 0.15 0.18" rgb2="0.11 0.12 0.15" width="512" height="512" mark="edge" markrgb="0.2 0.21 0.25"/>
    <material name="grid" texture="stage" texrepeat="8 8" reflectance="0.22" shininess="0.5" specular="0.6"/>
    <material name="robot" rgba="0.20 0.55 0.95 1" specular="0.7" shininess="0.55" reflectance="0.05"/>
    <material name="nose" rgba="0.98 0.85 0.20 1" specular="0.6" shininess="0.5"/>
    <material name="wheel" rgba="0.10 0.10 0.12 1" specular="0.4" shininess="0.4"/>
    <material name="wall" rgba="0.45 0.47 0.52 1"/>
    <material name="obstacle" rgba="0.85 0.35 0.30 1"/>
    <material name="goal" rgba="0.20 0.90 0.45 0.55"/>
    <material name="part_compute" rgba="0.14 0.15 0.18 1" specular="0.5" shininess="0.4"/>
    <material name="part_sensor" rgba="0.10 0.80 0.88 1" specular="0.6" shininess="0.5"/>
    <material name="part_power" rgba="0.20 0.78 0.38 1" specular="0.5" shininess="0.4"/>
    <material name="part_display" rgba="0.93 0.94 0.97 1" specular="0.8" shininess="0.7"/>
    <material name="part_actuator" rgba="0.90 0.62 0.18 1" specular="0.6" shininess="0.5"/>
    <material name="part_misc" rgba="0.72 0.55 0.95 1" specular="0.5" shininess="0.4"/>
  </asset>"""

# pos in world frame; mode="targetbody" auto-aims at the chassis so we never
# hand-tune xyaxes. Distances framed for a ~0.3 m footprint base.
_STUDIO_CAMS_XML = """
    <camera name="studio_hero" pos="0.58 -0.44 0.34" mode="targetbody" target="chassis"/>
    <camera name="studio_iso" pos="-0.46 -0.46 0.40" mode="targetbody" target="chassis"/>
    <camera name="studio_front" pos="0.78 0 0.16" mode="targetbody" target="chassis"/>
    <camera name="studio_side" pos="0 -0.80 0.16" mode="targetbody" target="chassis"/>
    <camera name="studio_top" pos="0.03 0 0.92" mode="targetbody" target="chassis"/>"""


def compile_studio_scene(assembly: Assembly, robot: RobotSpec) -> str:
    """A clean, well-lit scene with just the robot at the origin for a
    high-fidelity beauty render (no obstacles, no goal marker)."""
    rb = proxies.diff_drive(robot, (0.0, 0.0), 0.0, assembly.components)
    return f"""<mujoco model="hackshop-studio">
  <compiler angle="degree" autolimits="true"/>
  <option timestep="0.005" integrator="implicitfast" gravity="0 0 -9.81"/>
{_STUDIO_ASSETS}
  <worldbody>
    <light name="key" pos="0.8 -0.8 1.4" dir="-0.5 0.5 -1" diffuse="0.85 0.85 0.88" specular="0.4 0.4 0.4" castshadow="true"/>
    <light name="fill" pos="-1.0 -0.4 1.0" dir="0.6 0.3 -1" diffuse="0.35 0.36 0.42" castshadow="false"/>
    <light name="rim" pos="-0.3 1.0 0.9" dir="0.2 -0.8 -0.7" diffuse="0.30 0.32 0.40" castshadow="false"/>
    <geom name="floor" type="plane" size="0 0 0.1" material="grid"/>
{_STUDIO_CAMS_XML}
{rb.body_xml}
  </worldbody>
  <actuator>
{rb.actuator_xml}
  </actuator>
</mujoco>
"""


def compile_scene(
    assembly: Assembly, robot: RobotSpec, bounded: bool = False
) -> SceneBuild:
    w = worlds.build(assembly.world.template, assembly.world.goal_xy, bounded)
    rb = proxies.diff_drive(robot, w.start_xy, w.start_yaw_deg, assembly.components)

    xml = f"""<mujoco model="hackshop-{assembly.world.template}">
  <compiler angle="degree" autolimits="true"/>
  <option timestep="0.005" integrator="implicitfast" gravity="0 0 -9.81"/>
{_ASSETS}
  <worldbody>
    <light name="key" pos="0 0 5" dir="0 0 -1" diffuse="0.8 0.8 0.8"/>
    <light name="fill" pos="3 -3 4" dir="-0.5 0.5 -1" diffuse="0.4 0.4 0.4"/>
    <geom name="floor" type="plane" size="0 0 0.1" material="grid"/>
    <camera name="top" pos="0 0 8" xyaxes="1 0 0 0 1 0"/>
{w.obstacles_xml}
{rb.body_xml}
  </worldbody>
  <actuator>
{rb.actuator_xml}
  </actuator>
</mujoco>
"""

    return SceneBuild(
        xml=xml,
        goal_xy=w.goal_xy,
        goal_radius=w.goal_radius,
        start_xy=w.start_xy,
        chassis_body=rb.chassis_body,
        left_actuator=rb.left_actuator,
        right_actuator=rb.right_actuator,
        wheel_base_m=rb.wheel_base_m,
        wheel_radius_m=rb.wheel_radius_m,
        max_wheel_rad_s=rb.max_wheel_rad_s,
        obstacle_geoms=w.obstacle_geoms,
        world_objects=w.visual_objects,
        template=assembly.world.template,
        mounted=rb.mounted,
        total_mass_kg=rb.total_mass_kg,
        approximated_as=w.approximated_as,
    )
