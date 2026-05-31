"""Builder-agent loop integration: the agent must self-correct a failing run.

Phase 2 acceptance is "the agent improves a failing run on its own". We mock the
LLM (`author_control`) so the test is hermetic — no API key, no network — but we
exercise the *real* loop: compile -> rollout -> read telemetry -> revise, and we
assert it retries across iterations and writes a post-mortem.
"""

from __future__ import annotations

from conftest import nav_assembly
from hackshop_sim.agent import loop as agent_loop
from hackshop_sim.agent import tools
from hackshop_sim.ir import SimulateOptions
from hackshop_sim.pipeline import run_pipeline

# A controller that never moves (always fails to reach the goal).
_STALL_SRC = '''
def act(obs):
    return {"v": 0.0, "w": 0.0}
'''

# A controller that drives straight at the goal + a heading term — good enough to
# reach in an open room. Used as the "improved" revision.
_GOOD_SRC = '''
def act(obs):
    he = obs["heading_error"]
    max_v = obs["max_v"]
    max_w = obs["max_w"]
    w = max(-max_w, min(max_w, 2.2 * he))
    align = max(0.0, 1.0 - abs(he) / 1.2)
    v = max_v * align
    if obs["dist_to_goal"] < 0.25:
        v = min(v, 0.45 * max_v)
    return {"v": v, "w": w}
'''


def test_agent_loop_retries_and_improves(monkeypatch):
    """The loop should try the stalling controller, see it fail in telemetry,
    then accept the improved one and stop — recording >1 iteration."""
    monkeypatch.setattr(tools, "llm_available", lambda: True)

    calls = {"n": 0}
    sources = [_STALL_SRC, _GOOD_SRC]

    def fake_author(world_desc, feedback, prior_source):
        i = calls["n"]
        calls["n"] += 1
        # First call: no feedback yet. Second call: feedback must carry the
        # failing telemetry so we know the loop actually fed it back.
        if i == 0:
            assert feedback is None
        else:
            assert feedback is not None and "reached=False" in feedback
        return sources[min(i, len(sources) - 1)]

    monkeypatch.setattr(tools, "author_control", fake_author)

    captured = {}

    def runner(act):
        from hackshop_sim.assets.resolve import resolve
        from hackshop_sim.scene.compile import compile_scene
        from hackshop_sim.runtime.run import run_rollout

        asm = nav_assembly("empty-room")
        scene = compile_scene(asm, resolve(asm).robot)
        r = run_rollout(scene, act, duration_s=20.0, render_fps=30.0)
        captured.setdefault("results", []).append(r.success)
        return r

    outcome = agent_loop.build("empty room, goal far", runner, use_agent=True, max_iters=3)

    # It retried: the stalling controller failed, the improved one was tried.
    assert calls["n"] >= 2, "agent did not request a revision after failure"
    assert len(outcome.iterations) >= 2
    # First attempt failed, a later attempt succeeded.
    assert captured["results"][0] is False
    assert outcome.result.success is True
    assert outcome.authored_by == "llm"
    # A post-mortem is always produced.
    assert outcome.post_mortem
    assert "reached the goal" in outcome.post_mortem


def test_agent_falls_back_to_scripted_without_key(monkeypatch, tmp_path):
    """No API key/SDK -> the loop runs the scripted baseline once, never errors,
    and still produces a watchable result + post-mortem."""
    monkeypatch.setattr(tools, "llm_available", lambda: False)

    asm = nav_assembly("empty-room")
    out = run_pipeline(asm, SimulateOptions(agent=True, render=False), tmp_path)
    assert out["status"] == "ok"
    assert out["authored_by"] == "scripted"
    assert out["post_mortem"]


def test_pipeline_agent_default_enabled_on_async(monkeypatch):
    """With a (mocked) key present and agent unset, async jobs opt the agent in
    by default; it retries and writes a post-mortem. Bounded stays scripted."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.delenv("HACKSHOP_SIM_AGENT", raising=False)
    monkeypatch.setattr(tools, "llm_available", lambda: True)

    calls = {"n": 0}

    def fake_author(world_desc, feedback, prior_source):
        calls["n"] += 1
        return _GOOD_SRC

    monkeypatch.setattr(tools, "author_control", fake_author)

    import tempfile
    from pathlib import Path

    asm = nav_assembly("empty-room")
    # agent left at its default (False) -> pipeline opts it in for async.
    out = run_pipeline(asm, SimulateOptions(render=False), Path(tempfile.mkdtemp()))
    assert out["authored_by"] == "llm"
    assert calls["n"] >= 1
    assert out["post_mortem"]

    # Bounded stays scripted regardless of the key.
    calls["n"] = 0
    out_b = run_pipeline(
        asm, SimulateOptions(bounded=True, render=False), Path(tempfile.mkdtemp())
    )
    assert out_b["authored_by"] == "scripted"
    assert calls["n"] == 0
