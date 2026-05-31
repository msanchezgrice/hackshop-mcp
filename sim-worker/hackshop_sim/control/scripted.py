"""Deterministic scripted diff-drive navigation baseline.

Go-to-goal heading control + reactive obstacle avoidance from the proxy
rangefinder ring, plus a **wedge-recovery** behaviour: a purely reactive
controller settles into local minima in a concave trap (it stalls, balancing the
goal pull against the obstacle push). When it detects it has stopped making
progress, it backs out and pivots toward an escape side, then resumes — so the
robot *struggles, recovers, and reaches the goal* instead of staying wedged. The
ramp world still genuinely stalls (a slope, not a trap), preserving honest
failure theatre there.

State is kept in a module-level dict mutated in place (the control sandbox has no
`setattr`/attributes) and reset at the first step of each rollout (t<=0).

`SOURCE` is the canonical text; the runtime always loads control from source so
the scripted and agent-authored paths are identical. The agent is seeded with
this text as its starting point.
"""

from .loader import compile_control

SOURCE = '''
# Per-rollout controller state (reset at t<=0). Mutated in place — the sandbox
# allows no rebinding of module globals, but in-place dict/list edits are fine.
_S = {"hist": [], "mode": "go", "mode_t": 0.0, "esc": 1.0, "n_rec": 0}


def _reset(t):
    _S["hist"][:] = []
    _S["mode"] = "go"
    _S["mode_t"] = t
    _S["esc"] = 1.0
    _S["n_rec"] = 0


def _go_to_goal(obs):
    # Reactive go-to-goal with a steer-around-nearest avoidance term.
    he = obs["heading_error"]
    max_v = obs["max_v"]
    max_w = obs["max_w"]
    min_range = obs["min_range"]
    min_angle = obs["min_angle"]

    ahead = min_range
    for r in obs["ranges"]:
        if abs(r["angle"]) < 0.6:      # ~35deg cone
            ahead = min(ahead, r["dist"])

    danger = 0.7
    avoid_w = 0.0
    if min_range < danger and abs(min_angle) < 1.4:
        strength = (danger - min_range) / danger
        avoid_w = -math.copysign(1.0, min_angle) * strength * max_w
        if abs(min_angle) < 0.15:
            avoid_w = 0.9 * max_w

    goal_w = 2.2 * he
    w = goal_w + avoid_w
    if w > max_w:
        w = max_w
    elif w < -max_w:
        w = -max_w

    align = max(0.0, 1.0 - abs(he) / 1.2)
    clear = 1.0 if ahead > danger else max(0.15, ahead / danger)
    v = max_v * align * clear
    if obs["dist_to_goal"] < 0.25:
        v = min(v, 0.45 * max_v)       # ease in near the goal
    return {"v": v, "w": w}


def act(obs):
    t = obs["t"]
    if t <= 0.0:                       # first step of a fresh rollout
        _reset(t)
    max_v = obs["max_v"]
    max_w = obs["max_w"]
    x, y = obs["pos"][0], obs["pos"][1]
    dist = obs["dist_to_goal"]
    min_angle = obs["min_angle"]

    # --- recovery state machine -------------------------------------------
    # "back": reverse + spin away from the trap; "turn": commit to the escape
    # heading a beat longer; then resume normal go-to-goal.
    mode = _S["mode"]
    if mode == "back":
        if t - _S["mode_t"] > 0.9:
            _S["mode"] = "turn"
            _S["mode_t"] = t
        else:
            return {"v": -0.55 * max_v, "w": _S["esc"] * 0.9 * max_w}
    elif mode == "turn":
        if t - _S["mode_t"] > 0.7:
            _S["mode"] = "go"
            _S["mode_t"] = t
            _S["hist"][:] = []         # fresh progress window after escaping
        else:
            return {"v": 0.25 * max_v, "w": _S["esc"] * 0.85 * max_w}

    # --- progress tracking + wedge detection ------------------------------
    hist = _S["hist"]
    hist.append((t, x, y))
    while hist and t - hist[0][0] > 1.8:
        hist.pop(0)
    if _S["mode"] == "go" and dist > 0.6 and len(hist) >= 8:
        if t - hist[0][0] > 1.6:
            xs = [h[1] for h in hist]
            ys = [h[2] for h in hist]
            span = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
            if span < 0.10:            # barely moved for >1.6s -> genuinely wedged
                _S["n_rec"] += 1
                # Escape away from the nearest obstacle; alternate side on repeat
                # so we don't loop back into the same pocket.
                d = -math.copysign(1.0, min_angle) if abs(min_angle) > 1e-3 else 1.0
                if _S["n_rec"] % 2 == 0:
                    d = -d
                _S["esc"] = d
                _S["mode"] = "back"
                _S["mode_t"] = t
                hist[:] = []
                return {"v": -0.55 * max_v, "w": _S["esc"] * 0.9 * max_w}

    return _go_to_goal(obs)
'''

act = compile_control(SOURCE)
