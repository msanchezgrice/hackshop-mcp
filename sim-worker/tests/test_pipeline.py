import json

from conftest import nav_assembly
from hackshop_sim.control.loader import compile_control
from hackshop_sim.control.scripted import SOURCE
from hackshop_sim.ir import SimulateOptions
from hackshop_sim.pipeline import run_pipeline


def test_control_loads():
    act = compile_control(SOURCE)
    obs = {
        "t": 0.0, "pos": [0, 0], "yaw": 0.0, "goal": [2, 2], "dist_to_goal": 2.8,
        "heading_error": 0.3, "ranges": [{"angle": 0.0, "dist": 5.0}],
        "min_range": 5.0, "min_angle": 0.0, "max_v": 0.5, "max_w": 3.0, "collided": False,
    }
    ctrl = act(obs)
    assert "v" in ctrl and "w" in ctrl
    assert -10 < ctrl["v"] < 10 and -10 < ctrl["w"] < 10


def test_pipeline_empty_room_reaches_goal(tmp_path):
    asm = nav_assembly("empty-room")
    out = run_pipeline(asm, SimulateOptions(duration_s=20.0, render=False), tmp_path)
    assert out["status"] == "ok"
    assert out["supported"] is True
    # scripted controller should actually reach + settle in an open room
    assert out["telemetry"]["min_dist"] < 0.3
    assert out["telemetry"]["reached"] is True
    assert out["success"] is True
    # artifacts written
    assert (tmp_path / "scene.xml").exists()
    assert (tmp_path / "telemetry.json").exists()
    assert (tmp_path / "trajectory.json").exists()
    traj = json.loads((tmp_path / "trajectory.json").read_text())
    assert len(traj["poses"]) > 10


def test_pipeline_renders_mp4(tmp_path):
    asm = nav_assembly("obstacle-course")
    out = run_pipeline(asm, SimulateOptions(duration_s=6.0, render=True), tmp_path)
    assert out["status"] == "ok"
    # render is best-effort; when it succeeds the file must be non-empty
    if out.get("video_available"):
        mp4 = tmp_path / "run.mp4"
        assert mp4.exists() and mp4.stat().st_size > 1000
