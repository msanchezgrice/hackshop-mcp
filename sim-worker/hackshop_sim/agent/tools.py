"""LLM glue for the builder agent. Authors a diff-drive control program given
the control contract + world context, and revises it from telemetry text.

Frames never enter the prompt — only telemetry summaries — per the V2 plan
(cost/size). Falls back cleanly when no API key / SDK is present.
"""

from __future__ import annotations

import os
import re
from typing import Optional

from ..control.scripted import SOURCE as SCRIPTED_SOURCE

_MODEL = os.environ.get("HACKSHOP_SIM_MODEL", "claude-3-5-sonnet-latest")

CONTRACT = """\
You are authoring a Python control program for a differential-drive robot in a
MuJoCo navigation task. Define exactly one function:

    def act(obs):
        ...
        return {"v": forward_speed_mps, "w": turn_rate_rad_s}

`obs` is a dict with keys:
  t            float    sim time (s)
  pos          [x, y]   robot position (m)
  yaw          float    heading (rad)
  goal         [gx, gy] goal position (m)
  dist_to_goal float    (m)
  heading_error float   angle to goal relative to heading, in [-pi, pi]
  ranges       list of {"angle": bearing_rad_rel_heading, "dist": meters}  (proxy lidar ring, ~ -90..+90 deg)
  min_range    float    nearest obstacle distance (m)
  min_angle    float    bearing of nearest obstacle relative to heading (rad)
  max_v        float    forward speed cap (m/s)  -- do not exceed
  max_w        float    turn-rate cap (rad/s)    -- do not exceed
  collided     bool     touched an obstacle this step

Rules:
- Only the `math` module is available. No imports, no I/O, no state across calls
  unless you use function attributes or module-level globals (allowed).
- Return finite numbers within the caps.
- Goal: reach within the goal radius and stop; avoid obstacles and tipping.
Respond with ONLY a Python code block containing the `act` function."""


def _extract_code(text: str) -> Optional[str]:
    m = re.search(r"```(?:python)?\s*(.*?)```", text, re.DOTALL)
    if m:
        return m.group(1).strip()
    if "def act" in text:
        return text.strip()
    return None


def llm_available() -> bool:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return False
    try:
        import anthropic  # noqa: F401
    except Exception:
        return False
    return True


def author_control(world_desc: str, feedback: Optional[str], prior_source: Optional[str]) -> Optional[str]:
    """Ask the LLM for control source. Returns source or None on failure."""
    try:
        import anthropic
    except Exception:
        return None

    client = anthropic.Anthropic()
    if feedback is None:
        user = (
            f"{CONTRACT}\n\nWorld: {world_desc}\n\n"
            f"Here is a working reference controller you may improve on:\n```python\n{SCRIPTED_SOURCE}\n```\n"
            "Write your control program."
        )
    else:
        user = (
            f"{CONTRACT}\n\nWorld: {world_desc}\n\n"
            f"Your previous controller was:\n```python\n{prior_source}\n```\n\n"
            f"Telemetry from running it:\n{feedback}\n\n"
            "Diagnose what went wrong and write an improved controller."
        )

    try:
        msg = client.messages.create(
            model=_MODEL,
            max_tokens=1500,
            messages=[{"role": "user", "content": user}],
        )
        text = "".join(b.text for b in msg.content if getattr(b, "type", None) == "text")
        return _extract_code(text)
    except Exception as e:  # pragma: no cover - network/credential errors
        print(f"[agent] LLM call failed: {e}")
        return None
