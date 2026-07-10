"""Builder-agent loop: author control -> run -> read telemetry -> revise.

Returns the best rollout found plus an iteration log and a post-mortem. When the
LLM is unavailable it runs the scripted baseline once (authored_by="scripted")
so the pipeline always produces a watchable result.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, List, Optional

from ..control.loader import ControlError, compile_control
from ..control.scripted import SOURCE as SCRIPTED_SOURCE
from ..runtime.run import RunResult
from . import tools


@dataclass
class AgentOutcome:
    control_source: str
    authored_by: str  # "llm" | "scripted"
    result: RunResult
    iterations: List[dict] = field(default_factory=list)
    post_mortem: str = ""


def _collision_phrase(t: dict) -> Optional[str]:
    """Honest collision wording from the corrected (discrete-event) metric."""
    events = t.get("collisions") or 0
    secs = t.get("contact_seconds")
    if not events:
        return None
    base = f"bumped obstacles {events} time{'s' if events != 1 else ''}"
    if isinstance(secs, (int, float)) and secs > 0:
        base += f" ({secs:.1f}s in contact)"
    return base


def _post_mortem(r: RunResult, authored_by: str, iters: int) -> str:
    t = r.telemetry
    who = "The builder agent" if authored_by == "llm" else "The scripted controller"
    if r.success:
        base = f"{who} reached the goal (final distance {t['final_dist']}m)"
        if t.get("stuck_recovered"):
            base += f", recovering after briefly wedging at {t.get('stuck_xy')}"
        cp = _collision_phrase(t)
        if cp:
            base += f", and {cp} along the way"
        if authored_by == "llm" and iters > 1:
            base += f", after {iters} revision(s)"
        return base + "."
    if t.get("reached"):
        checks = t.get("criteria_checks") or {}
        failed = [
            str(name).replace("_", " ")
            for name, passed in checks.items()
            if passed is False
        ]
        failed_label = ", ".join(failed) or "one or more checks"
        base = (
            f"{who} reached the goal position (final distance "
            f"{t['final_dist']}m) but failed the acceptance criteria: "
            f"{failed_label}"
        )
        cp = _collision_phrase(t)
        if cp:
            base += f"; it {cp}"
        return base + "."
    why = []
    if t["tipped"]:
        why.append(f"the base tipped over at t={t['tipped_t']:.1f}s")
    if t["stuck"]:
        why.append(f"it wedged at {t['stuck_xy']} and stopped making progress")
    # >5 discrete collision events is a real thrashing signal (the old metric
    # summed contact-pairs per step and tripped at noise levels).
    if (t.get("collisions") or 0) > 5:
        why.append(f"it kept colliding ({t['collisions']} bumps)")
    if not why:
        if t.get("timed_out_approaching"):
            # Distinguish an honest out-of-time miss from a stall.
            why.append(
                f"it ran out of time still approaching, {t['final_dist']}m out "
                "(it was still closing the gap when the clock stopped)"
            )
        else:
            why.append(f"it stalled {t['final_dist']}m short of the goal")
    detail = "; ".join(why)
    return f"{who} did not reach the goal: {detail}. (got within {t['min_dist']}m at closest)"


def build(
    world_desc: str,
    runner: Callable[[Callable[[dict], dict]], RunResult],
    use_agent: bool,
    max_iters: int = 3,
) -> AgentOutcome:
    """`runner` compiles+rolls out a control callable and returns telemetry."""
    if not (use_agent and tools.llm_available()):
        act = compile_control(SCRIPTED_SOURCE)
        result = runner(act)
        return AgentOutcome(
            control_source=SCRIPTED_SOURCE,
            authored_by="scripted",
            result=result,
            iterations=[{"iter": 0, "summary": result.summary, "success": result.success}],
            post_mortem=_post_mortem(result, "scripted", 1),
        )

    best: Optional[RunResult] = None
    best_source = SCRIPTED_SOURCE
    iterations: List[dict] = []
    feedback: Optional[str] = None
    prior_source: Optional[str] = None

    for i in range(max_iters):
        source = tools.author_control(world_desc, feedback, prior_source)
        if not source:
            iterations.append({"iter": i, "error": "LLM returned no code"})
            break
        try:
            act = compile_control(source)
        except ControlError as e:
            iterations.append({"iter": i, "error": str(e)})
            feedback = f"Your code failed to load: {e}. Fix it."
            prior_source = source
            continue

        result = runner(act)
        iterations.append({"iter": i, "summary": result.summary, "success": result.success})
        if best is None or result.metric_value < best.metric_value:
            best, best_source = result, source
        if result.success:
            break
        feedback = result.summary
        prior_source = source

    if best is None:
        # Every LLM attempt failed to load — fall back to scripted.
        act = compile_control(SCRIPTED_SOURCE)
        best = runner(act)
        best_source = SCRIPTED_SOURCE
        return AgentOutcome(
            control_source=best_source,
            authored_by="scripted",
            result=best,
            iterations=iterations + [{"iter": "fallback", "summary": best.summary}],
            post_mortem=_post_mortem(best, "scripted", 1),
        )

    return AgentOutcome(
        control_source=best_source,
        authored_by="llm",
        result=best,
        iterations=iterations,
        post_mortem=_post_mortem(best, "llm", len([x for x in iterations if "summary" in x])),
    )
