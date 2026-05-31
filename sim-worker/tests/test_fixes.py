"""Regression tests for the physics/worker fixes (P1-1, -2, -7, -8, -19, -25,
-26, -3, -4)."""

from __future__ import annotations

import json

from conftest import nav_assembly
from hackshop_sim import jobs
from hackshop_sim.assets.resolve import resolve
from hackshop_sim.control.loader import compile_control
from hackshop_sim.control.scripted import SOURCE
from hackshop_sim.ir import SimulateOptions
from hackshop_sim.pipeline import run_pipeline
from hackshop_sim.runtime.run import parse_success_metric, run_rollout
from hackshop_sim.scene import worlds
from hackshop_sim.scene.compile import compile_scene


# ── P1-1: bounded obstacle-course goal is pulled in + reachable ───────────────
def test_bounded_obstacle_course_pulls_in_goal_and_reaches(tmp_path):
    asm = nav_assembly("obstacle-course")
    out = run_pipeline(asm, SimulateOptions(bounded=True, render=False), tmp_path)
    t = out["telemetry"]
    # Goal was pulled in from the full (2.3,2.3) diagonal.
    assert t["goal_xy"] != [2.3, 2.3]
    # And the bounded run actually reaches it.
    assert t["reached"] is True
    assert out["success"] is True


def test_pull_in_avoids_obstacles():
    """The bounded pull-in target must sit in a clear pocket, not on a pillar."""
    wb = worlds.build("obstacle-course", None, bounded=True)
    clr = worlds._obstacle_clearance(wb.goal_xy[0], wb.goal_xy[1], 3.0)
    assert clr >= 0.3, f"bounded goal clearance too low: {clr}"


# ── P1-2: default cluttered duration + timed_out distinction ──────────────────
def test_default_obstacle_course_reaches_goal(tmp_path):
    asm = nav_assembly("obstacle-course")
    # Default options -> pipeline bumps the cluttered default duration.
    out = run_pipeline(asm, SimulateOptions(render=False), tmp_path)
    t = out["telemetry"]
    assert t["reached"] is True
    assert out["success"] is True
    # Ran longer than the old 20s default.
    assert t["duration_s"] > 25


def test_timed_out_approaching_is_not_a_stall():
    """A short rollout that's still closing in is flagged timed_out, not stuck."""
    asm = nav_assembly("obstacle-course")
    scene = compile_scene(asm, resolve(asm).robot, bounded=False)
    act = compile_control(SOURCE)
    r = run_rollout(scene, act, duration_s=18.0, render_fps=30.0)
    t = r.telemetry
    assert t["reached"] is False
    assert t["timed_out_approaching"] is True
    assert t["stuck"] is False


# ── P1-7: collision counter is discrete events, not contact-pairs ─────────────
def test_collisions_are_discrete_events_not_pairs():
    # The scripted baseline now navigates the slalom cleanly (0 collisions), so to
    # exercise the metric we drive STRAIGHT into the arena wall: sustained contact
    # for many steps = many summed contact-pairs but only a few discrete events.
    asm = nav_assembly("obstacle-course")
    scene = compile_scene(asm, resolve(asm).robot, bounded=False)

    def ram(obs):  # full speed ahead, no steering -> rams the wall and holds
        return {"v": obs["max_v"], "w": 0.0}

    r = run_rollout(scene, ram, duration_s=20.0, render_fps=30.0)
    t = r.telemetry
    # It made contact.
    assert t["collisions"] > 0
    # `collisions` is the discrete-event count (the corrected metric)...
    assert t["collisions"] == t["collision_events"]
    # ...and the honest ordering holds: rising-edge EVENTS <= steps-with-contact
    # <= raw summed contact-PAIRS (the old, inflated metric). Sustained contact
    # makes pair_steps strictly larger, which is exactly the inflation P1-7 fixed.
    assert t["collision_events"] <= t["collision_steps"] <= t["contact_pair_steps"]
    assert t["contact_pair_steps"] > t["collision_events"]
    # contact_seconds is sane (seconds of wall contact, not minutes).
    assert 0 <= t["contact_seconds"] <= t["duration_s"]


# ── P1-8: stuck never co-asserts with reached ─────────────────────────────────
def test_stuck_and_reached_not_both_true():
    asm = nav_assembly("obstacle-course")
    scene = compile_scene(asm, resolve(asm).robot, bounded=False)
    act = compile_control(SOURCE)
    r = run_rollout(scene, act, duration_s=46.0, render_fps=30.0)
    t = r.telemetry
    assert not (t["stuck"] and t["reached"]), "telemetry asserts stuck AND reached"
    # The scripted controller wedges then recovers in this layout.
    if t["reached"] and t["stuck_t"] is not None:
        assert t["stuck_recovered"] is True


# ── P1-19: success_metric dwell/threshold is parsed + applied ─────────────────
def test_parse_success_metric():
    assert parse_success_metric("within 0.3m of goal for >2s") == (0.3, 2.0)
    assert parse_success_metric("within 0.3 m for >1s") == (0.3, 1.0)
    assert parse_success_metric("stay within 25cm for 3 seconds") == (0.25, 3.0)
    assert parse_success_metric(None) == (None, None)
    assert parse_success_metric("reach it eventually") == (None, None)


def test_success_dwell_applied_from_metric(tmp_path):
    asm = nav_assembly("empty-room")  # success_metric: "within 0.3m of goal for >2s"
    out = run_pipeline(asm, SimulateOptions(render=False), tmp_path)
    t = out["telemetry"]
    assert t["success_dwell_s"] == 2.0
    assert t["success_radius"] == 0.3


# ── P1-25: stairs/outdoor-flat are honestly labelled as approximated ──────────
def test_all_six_templates_accepted_and_labelled():
    for tmpl in ["empty-room", "obstacle-course", "ramp", "tabletop", "stairs", "outdoor-flat"]:
        asm = nav_assembly(tmpl)
        scene = compile_scene(asm, resolve(asm).robot)
        assert scene.template == tmpl  # requested name preserved
    # The two approximated templates carry an honest note.
    for tmpl in ["stairs", "outdoor-flat"]:
        scene = compile_scene(nav_assembly(tmpl), resolve(nav_assembly(tmpl)).robot)
        assert scene.approximated_as == "obstacle-course"
    # Real templates do not.
    for tmpl in ["empty-room", "obstacle-course", "ramp", "tabletop"]:
        scene = compile_scene(nav_assembly(tmpl), resolve(nav_assembly(tmpl)).robot)
        assert scene.approximated_as is None


def test_approximated_note_in_telemetry(tmp_path):
    out = run_pipeline(nav_assembly("stairs"), SimulateOptions(bounded=True, render=False), tmp_path)
    assert out["telemetry"]["template"] == "stairs"
    assert out["telemetry"]["template_approximated_as"] == "obstacle-course"


# ── P1-26: effective fps is reported (not the rounded request) ────────────────
def test_effective_fps_matches_frame_cadence():
    asm = nav_assembly("empty-room")
    scene = compile_scene(asm, resolve(asm).robot)
    act = compile_control(SOURCE)
    r = run_rollout(scene, act, duration_s=6.0, render_fps=30.0)
    # dt=0.005 -> frame_every=round(0.0333/0.005)=7 -> 1/(7*0.005)=28.571.
    assert abs(r.fps - (1.0 / (7 * 0.005))) < 1e-6
    assert r.requested_fps == 30.0
    assert r.fps != r.requested_fps


# ── P1-3 / P1-4: job state survives an in-process wipe (reconstruct from disk) ─
def test_job_reconstructed_from_disk_after_restart(tmp_path, monkeypatch):
    monkeypatch.setattr(jobs, "RUNS_DIR", tmp_path)
    monkeypatch.setenv("HACKSHOP_SIM_AGENT", "0")

    asm = nav_assembly("empty-room")
    job = jobs.run_sync(asm, SimulateOptions(render=False))
    assert job.status == "done"
    jid = job.id
    # result.json was written.
    assert (tmp_path / jid / "result.json").is_file()

    # Simulate a worker restart: wipe the in-process dict entirely.
    jobs._JOBS.clear()
    assert jobs._JOBS.get(jid) is None

    # GET must reconstruct a terminal 'done' job from disk, not 404.
    recovered = jobs.get_job(jid)
    assert recovered is not None
    assert recovered.status == "done"
    assert recovered.result is not None
    assert recovered.result["telemetry"]["template"] == "empty-room"


def test_job_record_persisted_on_create(tmp_path, monkeypatch):
    monkeypatch.setattr(jobs, "RUNS_DIR", tmp_path)
    job = jobs.create_job()
    rec = tmp_path / job.id / "job.json"
    assert rec.is_file()
    data = json.loads(rec.read_text())
    assert data["id"] == job.id
    assert data["status"] == "queued"
