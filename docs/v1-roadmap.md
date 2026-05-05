# V1 Roadmap — Captured Ideas (NOT to implement now)

This document captures structural ideas from an external review of v0.0.2 (2026-05-05). They are good ideas. They are not v0.1 work.

The bar for promoting any of these to a build is **a usage signal that requires it** — at least one external user asking, repeatedly, for the capability the idea unlocks. With v0.0.2 sitting at 1 confirmed user (the founder) and 0 measured external installs, schema-shaped speculation is premature. Ship, watch, then revisit this document.

For each idea below: what it is, when to build it, what the trigger is.

---

## 1. Agent-operability axis (alongside hackability)

**The idea.** A device's `hack_difficulty` measures whether a tinkerer can flash custom firmware. It does not measure whether an *agent* can call observable / controllable / programmable / recoverable interfaces on it. A Kindle is hackable but agent-hostile (humans flash it, then babysit KOReader). A Reachy Mini has Python SDK + REST + WebRTC and an agent can literally call its functions. These are different classes of fit for an MCP-driven flow.

Add to each device:

```yaml
agent_operability:
  observable: [camera, mic, telemetry, screen, logs, ...]
  controllable: [head_pose, speaker, motor_mode, GPIO, ...]
  programmable: [python_sdk, rest_api, websocket_api, webrtc, ros2, ...]
  recoverable: [power_cycle, simulator_first, safe_mode, reflash, ...]
```

**Build trigger.** A user asks `propose_hardware` "find me devices an agent can control" and the answer is bad because the catalog can't filter on it. Until then, the LLM's general knowledge handles this implicitly via the candidate notes.

**Cost when built.** Schema migration on 27+ devices, ~200 cells of judgment. Plan for ~1 day of catalog work + half a day of UI surfacing. The schema work compounds with idea #4 below.

---

## 2. Interface-manifest tool (`get_interface_manifest`)

**The idea.** A tool that returns the exact callable surface of a device:

```ts
get_interface_manifest("reachy-mini") -> {
  interfaces: [
    { name: "Python SDK", transport: "local", observes: ["camera", ...], controls: [...], setup_required: [...] },
    { name: "REST API",    transport: "http",  ... },
    { name: "WebRTC",      transport: "browser", ... },
  ]
}
```

This is the natural pair of #1: the agent doesn't just know the device is operable, it knows *how*.

**Build trigger.** A real agent host (Claude Desktop / Claude Code / Cursor) has chained `propose_hardware` → `get_interface_manifest` → produced executable integration code. Right now that flow is hypothetical.

**Cost when built.** Depends on how rich the manifest is. A trivial version (just enumerate the entry's `firmware_links` with annotations) is ~2 hours. A real version (machine-readable affordances per interface) is ~3-5 days plus catalog work.

---

## 3. Verification ledger (`record_verification_result`)

**The most important idea on this list. Save it for V1.x.** This is the moat.

```ts
record_verification_result({
  device_id: "reachy-mini",
  test_id: "python_sdk_connect_and_move_head",
  result: "passed",
  evidence: { log: "...", video: "...", sdk_version: "..." },
  promote_evidence_level_to: "agent-verified",
})
```

What this unlocks: a catalog where every entry is annotated with *what an agent has actually done with it, recently*. Crowd-sourced agent-runs are hard to fake and compound over time. Vendor docs say "ROS 2 supported"; the ledger says "an agent successfully drove this Create 3 to dock on 2026-06-12, here's the log."

**Build trigger.** ≥10 unsolicited GitHub issues asking "I tried X with this device, did anyone else?" That's the demand signal that justifies the infrastructure.

**Cost when built.** This is a real product, not a feature. ~2-3 weeks: receive endpoint, anti-fraud, reputation, UI for the ledger, evidence-promotion workflow. Probably warrants its own service.

---

## 4. Protocol records as first-class objects

**The idea.** Today the catalog has device entries with `firmware_links`. There is no first-class `Protocol` entity. With ~30 devices and ~10 protocols (ROS 2, REST, WebRTC, ESPHome, Home Assistant, OpenWrt, ADB, …), that's fine. At 200+ devices and 50+ protocols, queries like *"find devices that speak ROS 2 with a simulator"* become painful without a join table.

**Build trigger.** Catalog crosses ~75 devices AND a user asks for a protocol-shaped query that's awkward to satisfy with the current shape.

**Cost when built.** ~2 days: schema migration, importer for existing entries, search-by-protocol UI.

---

## 5. `recommend_stack` and `compare_operability` tools

Both are speculative. Neither has a usage signal yet. Capture and skip.

**`recommend_stack`** would return device + SDK + framework as a bundle (Reachy Mini + Python SDK + Hugging Face Space + LLM). Useful when users start asking "what's the full stack?"

**`compare_operability`** would rank devices for a task on operability axes, not just price/condition. Useful when users start saying "Create 3 vs TurtleBot 4 — which works better with my agent?"

**Build trigger for either.** A real, repeated query in the wild. Right now: zero queries.

---

## 6. Multi-axis risk (beyond `brick_risk`)

**Partially shipped (V0.0.2 + this update).** The premium catalog now carries `actuation_risk` and `privacy_risk` because Reachy Mini and Crazyflie genuinely need them. The reviewer proposed seven axes (brick / actuation / privacy / network / battery-fire / cloud-dependency / human-setup). Five of those would currently be defaulted to "low" or "unknown" for most devices = false precision.

**Build trigger for the next axis.** A specific device whose risk profile is misrepresented by what we have today, *and* a user has been confused by it. Most likely first: `cloud_dependency_risk` when a device's vendor sunsets the cloud service the agent depends on.

---

## 7. Larger taxonomy (16+ categories with subtypes)

The reviewer proposed splitting `display` → `hackable-display | repurposable-display | protocol-native-display`, and adding `robot-arm`, `mobile-robot`, `capture-device`, `agent-workbench-bundle`, etc.

**At 27 devices and 8 categories, this is over-classification.** The `idea_fit_tags` set already does most of the work the subtypes would do. Promote a subtype to a category only when ≥5 devices fit it cleanly.

**Build trigger.** A category swells past ~10 devices and starts to be heterogeneous (e.g., `display` accumulates OLED panels, e-paper, projectors, LED matrices, AR glasses, holograms). At that point splitting becomes useful.

---

## 8. Repositioning copy

**Already done in this iteration.** The homepage tagline now reads "what hardware is hackable, repurposable, or protocol-native." The reviewer was right that the prior copy under-sold the protocol-native side.

---

## What to actually do in v0.0.x → v0.1.x

In priority order:

1. **Ship for usage.** Show HN, Hackaday, MCP registry. The right v0.1 question is "did anyone install this?", not "what features does it lack?"
2. **Watch the live demo and the issues.** If issues cluster on a specific theme (e.g., "I can't tell if my agent can actually use this"), that becomes a real build trigger from this list.
3. **Grow the catalog by ~2-3 devices per week** as people open issues and PRs. Catalog quality compounds; schema sophistication does not, until users ask.
4. **Re-read this doc quarterly.** Promote items only when their build triggers fire.

The reviewer was right about the destination. They were wrong about the timing.
