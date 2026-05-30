"""Deterministic scripted diff-drive navigation baseline.

Go-to-goal heading control + reactive obstacle avoidance from the proxy
rangefinder ring. Good enough to reach the goal in open rooms and to produce
*honest failure theatre* in cluttered worlds (wedging in the trap pocket,
stalling on the ramp) — which is exactly what the user asked to be able to see.

`SOURCE` is the canonical text; the runtime always loads control from source so
the scripted and agent-authored paths are identical. The agent is seeded with
this text as its starting point.
"""

from .loader import compile_control

SOURCE = '''
def act(obs):
    # Reactive go-to-goal with a steer-around-nearest avoidance term.
    he = obs["heading_error"]          # [-pi, pi]
    max_v = obs["max_v"]
    max_w = obs["max_w"]
    min_range = obs["min_range"]
    min_angle = obs["min_angle"]

    # --- avoidance: if something is close ahead, turn away from it ---
    # Clear-ahead distance: only obstacles roughly in front matter for braking.
    ahead = min_range
    for r in obs["ranges"]:
        if abs(r["angle"]) < 0.6:      # ~35deg cone
            ahead = min(ahead, r["dist"])

    danger = 0.7                       # start reacting within 0.7 m
    avoid_w = 0.0
    if min_range < danger and abs(min_angle) < 1.4:
        # Turn away from the obstacle: if it's on the left (+angle), steer right.
        strength = (danger - min_range) / danger
        avoid_w = -math.copysign(1.0, min_angle) * strength * max_w
        # If it's nearly dead-ahead, pick a consistent escape side (left).
        if abs(min_angle) < 0.15:
            avoid_w = 0.9 * max_w

    # --- heading term toward goal ---
    goal_w = 2.2 * he
    w = goal_w + avoid_w
    if w > max_w:
        w = max_w
    elif w < -max_w:
        w = -max_w

    # --- forward speed: slow for big heading error and for nearby obstacles ---
    align = max(0.0, 1.0 - abs(he) / 1.2)
    clear = 1.0 if ahead > danger else max(0.15, ahead / danger)
    v = max_v * align * clear
    if obs["dist_to_goal"] < 0.25:
        v = min(v, 0.45 * max_v)       # ease in near the goal
    return {"v": v, "w": w}
'''

act = compile_control(SOURCE)
