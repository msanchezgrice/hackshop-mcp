from hackshop_sim.ir import Assembly


def nav_assembly(template: str = "obstacle-course") -> Assembly:
    return Assembly.model_validate(
        {
            "idea": "a roomba that patrols the office and returns to a dock",
            "components": [
                {
                    "ref": "base",
                    "device_id": "irobot-create-3",
                    "name": "iRobot Create 3",
                    "role": "chassis",
                },
                {
                    "ref": "pi",
                    "device_id": "raspberry-pi-5",
                    "name": "Raspberry Pi 5",
                    "role": "compute",
                },
            ],
            "edges": [
                {"from": "pi", "to": "base", "transport": "ros2", "payload": "/cmd_vel"}
            ],
            "goal": {
                "kind": "navigate",
                "spec": "reach the goal marker without hitting obstacles",
                "success_metric": "within 0.3m of goal for >2s",
            },
            "world": {"template": template},
        }
    )


def full_assembly(template: str = "obstacle-course") -> Assembly:
    """A richer buildout: base + compute + lidar + camera + battery + screen."""
    return Assembly.model_validate(
        {
            "idea": "an autonomous delivery rover with lidar nav and a status screen",
            "components": [
                {"ref": "base", "device_id": "irobot-create-3", "name": "iRobot Create 3", "role": "chassis"},
                {"ref": "pi", "device_id": "raspberry-pi-5", "name": "Raspberry Pi 5", "role": "compute"},
                {"ref": "lidar", "device_id": "rplidar-c1", "name": "RPLidar C1", "role": "sensor"},
                {"ref": "cam", "device_id": "pi-camera-3", "name": "Pi Camera 3", "role": "sensor"},
                {"ref": "batt", "device_id": "lipo-4s", "name": "4S LiPo Pack", "role": "power"},
                {"ref": "screen", "device_id": "waveshare-3in5", "name": "3.5in LCD", "role": "display"},
            ],
            "edges": [
                {"from": "pi", "to": "base", "transport": "ros2", "payload": "/cmd_vel"},
                {"from": "lidar", "to": "pi", "transport": "usb", "payload": "/scan"},
            ],
            "goal": {
                "kind": "navigate",
                "spec": "reach the goal marker without hitting obstacles",
                "success_metric": "within 0.3m of goal for >1s",
            },
            "world": {"template": template},
        }
    )
