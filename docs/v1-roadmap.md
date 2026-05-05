# V1 Roadmap

This document tracks structural ideas across three buckets: **shipped**, **waiting** (with explicit build triggers), and **DO NOT BUILD**. The bar for promoting a "waiting" item is a usage signal that requires it — not a reviewer hypothesis.

Last updated: 2026-05-05 (v0.0.3 shipping wave).

---

## Shipped (v0.0.2 — v0.0.3)

### ✅ Repositioning copy

Homepage tagline now reads *"...what hardware is hackable, repurposable, or protocol-native"* — captures the protocol-native side without rebuilding the schema.

### ✅ Multi-axis risk (premium catalog only, partial)

`actuation_risk` + `privacy_risk` (1-5) on the 8 premium-catalog entries. Reachy Mini (motors + cam + mic) → actuation 3 / privacy 4. Crazyflie (flying drone) → actuation 4 / privacy 1. UI surfaces these as warning pills only when ≥3, with auto-derived callouts ("camera + microphone + motors").

The reviewer proposed seven risk axes. I implemented two on the catalog where they actually carry signal. Adding more is a *waiting* item below — needs a specific real-world failure to justify the field.

### ✅ Inventory ("things you own") — v0.0.3

LocalStorage-backed inventory at `/inventory`. Add/remove devices from the catalog with one click. Homepage form has a `Use what I already own` toggle that, when on, sends `inventory_ids` to `/api/propose`. Server prepends a system-prompt instruction telling the agent to rank ideas the user can build with what they have first.

V0 has no auth — inventory stays in the user's browser. Cross-device sync is a v1.x problem if anyone asks for it.

### ✅ How-to guides (`/api/howto`) — v0.0.3

New endpoint that takes a `device_id` + optional `idea` and returns an LLM-generated step-by-step walkthrough. Cached in-process for 24 hours per (device, idea) bucket. Brick-risk safety rule applies: refuses to generate guides for `llm-inferred + (handheld | sbc)` devices because the cost of being wrong on those classes is unrecoverable hardware.

UI integration: every proposal card has a "Get how-to →" button that fetches the guide inline.

### ✅ Images + setup-time on proposals — v0.0.3

`image_url` and `est_setup_hours_min/max` fields on every catalog entry (used + premium). UI:
- Proposal cards now lead with a 160px-tall hero image when a URL is present (neutral placeholder otherwise).
- Setup time renders as a pill alongside price + difficulty: `1-2h setup`, `~4h setup`, etc.
- Templates gallery cards show setup time inline with cost: `$80-130 · 4-8h setup`.

Coverage: ~70% of the 35 catalog entries have image URLs (the rest fall back gracefully). 100% have setup-hour estimates.

### ✅ Open-source-only filter — v0.0.3

Homepage form has a third toggle: `Open-source firmware only`. When on, the catalog is pre-filtered to entries that have at least one GitHub / GitLab / Codeberg / SourceForge URL in `firmware_links`. Lets users who care specifically about avoiding proprietary lock-in narrow to those candidates.

### ✅ Trust drift fixes — v0.0.2 patch

- `src/server.ts` VERSION bumped 0.0.1 → 0.0.2 (now also 0.0.3 in this wave).
- README: "fifty hand-vetted devices" → "27"; "~50 devices in V1" → "27 devices growing".
- SAMPLING.md: rewrote "What the server NEVER does" which was lying for v0.0.2 (we DO bundle `@anthropic-ai/sdk`, we DO read `ANTHROPIC_API_KEY` as a fallback, we DO call the Anthropic API directly when host sampling fails).

---

## Waiting (capture only — promote when build trigger fires)

### Agent-operability axis

Add `observable / controllable / programmable / recoverable` arrays to each device. A Kindle is hackable but agent-hostile; a Reachy Mini has documented Python/REST/WebRTC and an agent can call its functions.

**Build trigger:** A user asks `propose_hardware` "find me devices an agent can control" and the answer is bad because the catalog can't filter on it. Until then, the LLM's general knowledge handles this implicitly via the candidate notes.

**Cost when built:** Schema migration on 35+ devices, ~200 cells of judgment. ~1 day catalog work + half a day UI surfacing.

### Interface-manifest tool (`get_interface_manifest`)

A tool that returns the exact callable surface of a device (Python SDK, REST, WebRTC, etc.) with observes/controls/setup-required per interface.

**Build trigger:** A real agent host has chained `propose_hardware` → `get_interface_manifest` → integration code. Right now the flow is hypothetical.

**Cost when built:** 3-5 days. Pairs with the agent-operability axis.

### Verification ledger (`record_verification_result`)

**The most important idea on this list. Save it for V1.x.** Crowd-sourced agent-runs against catalog devices, hard to fake, compounds over time. "An agent successfully drove Create 3 to dock on 2026-06-12, here's the log."

**Build trigger:** ≥10 unsolicited GitHub issues asking "I tried X with this device, did anyone else?"

**Cost when built:** 2-3 weeks. Receive endpoint + anti-fraud + reputation + UI for the ledger + evidence-promotion workflow. Probably its own service.

### Protocol records as first-class objects

ROS 2 / REST / WebRTC / ESPHome / Home Assistant / OpenWrt as first-class entities, with devices linking to one or more.

**Build trigger:** Catalog crosses ~75 devices AND a user asks for a protocol-shaped query that's awkward today.

**Cost when built:** ~2 days. Schema migration + importer.

### `recommend_stack` and `compare_operability` tools

Speculative until a user asks. Both are reasonable v1.x additions; neither has a usage signal.

**Build trigger:** A real, repeated query in the wild ("Create 3 vs TurtleBot 4 — which works better with my agent?").

**Cost when built:** 2-3 days each.

### More risk axes (network / cloud-dependency / battery-fire / human-setup)

Two axes shipped (actuation, privacy). The reviewer wanted seven. The remaining five would mostly be defaulted to "low" or "unknown" today — false precision.

**Build trigger:** A specific device whose risk profile is misrepresented by what we have AND a user has been confused by it. Most likely first: `cloud_dependency_risk` when a vendor sunsets the cloud service the agent depends on.

### Larger taxonomy (16+ categories with subtypes)

`hackable-display` vs `repurposable-display` vs `protocol-native-display`, `robot-arm`, `mobile-robot`, `capture-device`, `agent-workbench-bundle`, etc.

**Build trigger:** A category swells past ~10 devices and starts to be heterogeneous (e.g., `display` accumulates OLED panels, e-paper, projectors, LED matrices, AR glasses). At that point splitting becomes useful.

---

## DO NOT BUILD (capture and forget)

### Autonomous purchase via Stripe

Three reasons:

1. **Office-hours specifically walked away from this.** Q3 of the original session: "agent as autonomous buyer vs agent as scout." We picked autonomous, walked it back to scout-with-human-buyer after the demand check. Stripe-purchase reverts that decision. The current product is right; agents don't have wallets, demand, or taste yet — humans do.

2. **The scope is a separate company.** Stripe + agent auth + fraud + refunds + KYC + vendor relationships + tax + fulfillment is realistically 2-3 months of focused engineering plus ongoing legal/compliance costs. Not v0.x. Not even v1.x for an N=1 builder.

3. **The risk is asymmetric.** A bug in propose-hardware costs you eBay clicks. A bug in autonomous-purchase costs a chargeback dispute, a one-star review, or a refund line item that exceeds your hosting bill for the year.

**Capture this as a v2.x note** for the moment when (a) ≥1000 users are using inventory + how-to guides AND (b) a coherent agent-commerce protocol like AP2 / x402 is mature enough to plug into. Then revisit. For now: forget about it.

---

## Quarterly review

Re-read this doc every ~3 months. Promote items only when their build triggers fire. Resist the urge to ship schema before users.

The reviewer was right about the destination. They were wrong about the timing.
