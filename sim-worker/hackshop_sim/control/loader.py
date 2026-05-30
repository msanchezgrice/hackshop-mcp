"""Load a control program from source into a callable `act(obs) -> ctrl`.

The control contract (shared by the scripted baseline and the LLM builder
agent):

    def act(obs: dict) -> dict:
        # obs keys:
        #   t            float    sim time (s)
        #   pos          [x, y]   chassis position (m)
        #   yaw          float    heading (rad)
        #   goal         [gx, gy] goal position (m)
        #   dist_to_goal float    (m)
        #   heading_error float   angle to goal relative to heading, [-pi, pi]
        #   ranges       list[{"angle": rad_rel_heading, "dist": m}]  proxy lidar ring
        #   min_range    float    nearest obstacle distance (m)
        #   min_angle    float    bearing of nearest obstacle, rel heading (rad)
        #   max_v        float    forward speed cap (m/s)
        #   max_w        float    turn-rate cap (rad/s)
        #   collided     bool     robot touched an obstacle this step
        # return: {"v": forward_m_s, "w": turn_rad_s}  (runtime clamps to caps)

Programs run in a restricted namespace (math + a tiny safe builtin set). No
imports, file, or network access — the agent authors pure control logic only.
"""

from __future__ import annotations

import math
from typing import Callable

_SAFE_BUILTINS = {
    "abs": abs,
    "min": min,
    "max": max,
    "len": len,
    "range": range,
    "float": float,
    "int": int,
    "bool": bool,
    "round": round,
    "sum": sum,
    "sorted": sorted,
    "enumerate": enumerate,
    "map": map,
    "list": list,
    "dict": dict,
    "tuple": tuple,
}


class ControlError(Exception):
    pass


def compile_control(source: str) -> Callable[[dict], dict]:
    """Compile control source and return its `act`. Raises ControlError on a
    missing/invalid `act` or a syntax error (surfaced to the agent for repair)."""
    ns: dict = {"math": math, "__builtins__": _SAFE_BUILTINS}
    try:
        code = compile(source, "<control>", "exec")
        exec(code, ns)  # noqa: S102 - sandboxed namespace, no real builtins
    except SyntaxError as e:
        raise ControlError(f"syntax error: {e}") from e
    except Exception as e:  # pragma: no cover - defensive
        raise ControlError(f"error evaluating control module: {e}") from e

    act = ns.get("act")
    if not callable(act):
        raise ControlError("control module must define a callable `act(obs) -> {v, w}`")
    return act
