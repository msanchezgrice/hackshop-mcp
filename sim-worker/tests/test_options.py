import pytest

from hackshop_sim.ir import SimulateOptions
from hackshop_sim import pipeline
from conftest import nav_assembly


def test_explicit_agent_false_wins_over_environment_default(monkeypatch):
    monkeypatch.delenv("HACKSHOP_SIM_AGENT", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

    resolver = getattr(pipeline, "resolve_agent_enabled", None)
    assert resolver is not None, "agent option resolver is missing"
    assert resolver(SimulateOptions()) is True
    assert resolver(SimulateOptions(agent=False)) is False
    assert resolver(SimulateOptions(agent=True)) is True
    assert resolver(SimulateOptions(agent=True, bounded=True)) is False


def test_pipeline_returns_numeric_iteration_count_and_separate_log(tmp_path):
    output = pipeline.run_pipeline(
        nav_assembly("empty-room"),
        SimulateOptions(duration_s=0.05, render=False, agent=False),
        tmp_path,
    )

    assert isinstance(output["iterations"], int)
    assert output["iterations"] == len(output["iteration_log"])
    assert output["iteration_log"][0]["iter"] == 0


@pytest.mark.parametrize("duration_s", [0.0, 60.01])
def test_simulate_options_rejects_duration_outside_public_contract(duration_s):
    with pytest.raises(ValueError):
        SimulateOptions(duration_s=duration_s)


@pytest.mark.parametrize("agent_max_iters", [0, 7])
def test_simulate_options_rejects_agent_iterations_outside_public_contract(
    agent_max_iters,
):
    with pytest.raises(ValueError):
        SimulateOptions(agent_max_iters=agent_max_iters)
