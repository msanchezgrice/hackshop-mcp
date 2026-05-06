# Catalog Research Spec

This document is the complete schema and sourcing-standards bible for adding entries to `hackshop-mcp`'s catalogs. Hand this to a research agent / contractor / LLM workflow and they should be able to produce paste-ready JSON entries without back-and-forth.

Two catalogs exist:

| Catalog | File | Audience | Primary market |
|---|---|---|---|
| **Used** | `catalog.json` | Tinkerers buying secondhand on eBay/etc. | Secondary market |
| **Premium** | `site/premium-catalog.json` | Builders buying NEW open-source hardware direct | Primary market (manufacturer / Adafruit / Pimoroni / Crowd Supply) |

Choose the right catalog: if the device is mainly bought used, it's **Used**. If it's a current-production open-source kit you order from the maker, it's **Premium**. When in doubt, premium.

---

## Goals for this round

- **+30 premium entries** across robotics, displays/screens, sensors. Lean into HuggingFace / LeRobot ecosystem because that's where the agent-operability frontier is.
- **+20 used entries** of the "open-source firmware only" type (must have a public GitHub/GitLab repo in `firmware_links`).

Quality > volume. A well-vetted entry is worth 5 hand-wavy ones.

---

## Schema — Used catalog (`catalog.json`)

Every entry MUST have every field unless marked optional. Validation is enforced at server boot — bad entries crash the server.

```jsonc
{
  "id": "lowercase-kebab-case-slug",          // unique, /^[a-z0-9-]+$/, max 60 chars
  "name": "Marketing-correct device name",     // what eBay sellers actually call it
  "category": "display | speaker | input | sensor | bulb | sbc | handheld | mini-pc | wearable | router | other",
  "idea_fit_tags": ["display", "e-ink", ...], // 1-8 tags, ALL must exist in tags.md (see vocabulary below)
  "hack_difficulty": 1,                        // int 1-5: 1 = plug-and-play firmware, 5 = board-level RE
  "brick_risk": 1,                             // int 1-5: 1 = unbrickable, 5 = easily permabricked
  "brick_provenance": "founder-verified | community-reported | llm-inferred",
  "last_verified": "2026-05-05",               // ISO YYYY-MM-DD; date the entry was confirmed
  "firmware_links": [                          // 0+ URLs. github.com/gitlab.com qualify as "open source"
    "https://github.com/...",
    "https://hackaday.com/..."
  ],
  "community_size_bucket": "tiny | small | active | thriving",
  "notes": "≤500 chars. Concrete. What's hackable, what's the catch, what's it good for.",
  "est_used_price_usd_min": 30,                // optional, integer
  "est_used_price_usd_max": 70,                // optional, integer
  "est_setup_hours_min": 1,                    // optional, number (decimals OK for sub-hour)
  "est_setup_hours_max": 4                     // optional, number
}
```

### Tag vocabulary (closed set)

Tags must be in `tags.md`. To add a new tag you must edit `tags.md` in the same PR. Current 24 tags:

```
display | framed-art | e-ink | ambient
voice | audio-out | drone
input | kiosk | wearable
sensor | bulb | color-cycle
sbc | mini-pc | low-power
retrogaming | handheld | network | iot | peripheral | educational | industrial | creative-coding
```

If you find yourself wanting a new tag, name it in your research notes and we'll add it once 3+ devices need it.

### Brick provenance (the safety-critical field)

This is the one field where being honest matters most. The server applies a hard refusal rule for `llm-inferred + (handheld | sbc)` because those are the categories where bricks are unrecoverable.

| Value | Means | Examples |
|---|---|---|
| `founder-verified` | The maintainer has personally flashed/used this device | Reserved — only Miguel sets this |
| `community-reported` | Public, reproducible reports from 3+ unique sources (forum threads, GitHub issues, blog posts), not all linking back to one source | A jailbreak documented on MobileRead + XDA + a YouTube tutorial |
| `llm-inferred` | LLM general knowledge says it's hackable, but no reproducible evidence collected | Anything you couldn't substantiate in 5 minutes of search |

When in doubt, mark `llm-inferred`. The safety rule will protect users.

### Acceptable firmware_links

Order by usefulness. First link should be the most authoritative.

- ✅ GitHub / GitLab / Codeberg / SourceForge repos (the "open source" filter checks for these specifically)
- ✅ Hackaday articles, MobileRead forum threads, XDA threads
- ✅ Manufacturer documentation (Espressif docs, Raspberry Pi docs)
- ✅ Wiki pages (OpenWrt wiki, Linux Wireless wiki)
- ❌ Random YouTube tutorials (unstable URLs)
- ❌ Reddit threads (often deleted)
- ❌ Wayback links unless the original is gone

### Community size buckets

Rough estimate of active user community. Bucketed because precision is fake.

| Bucket | Heuristic |
|---|---|
| `tiny` | <100 active users; 1-2 GitHub repos that haven't seen a commit in 18+ months |
| `small` | 100-1k; one active repo, occasional PRs |
| `active` | 1k-10k; multiple active repos, regular issue traffic |
| `thriving` | 10k+; multi-vendor support, books written about it, conference talks |

### Price + setup hours

Use training-data eBay norms. If you're unsure, leave the fields out (they're optional). Conservative upper bound — first-time tinkerer setup time, not expert.

---

## Schema — Premium catalog (`site/premium-catalog.json`)

Premium entries are NEW open-source hardware bought direct. Different shape because brick-risk is rarely the right axis (these are designed for hacking) and capabilities/software-stack matter more.

```jsonc
{
  "id": "lowercase-kebab-case-slug",
  "name": "Reachy Mini",
  "manufacturer": "Pollen Robotics × Hugging Face",   // vendor + sponsoring entity if relevant
  "category": "robot | drone | sbc | wearable | display | audio | sensor | tool | computer",
  "capabilities": [                                    // 1+ short strings, concrete; what the device can DO
    "wide-angle HD camera",
    "4-mic array (sound localization)",
    "5W speaker",
    "6-DoF head (pan/tilt/roll)"
  ],
  "software_stack": [                                  // 1+; SDKs, frameworks, integrations
    "Python SDK",
    "Hugging Face Hub (1.7M+ models)",
    "simulation SDK"
  ],
  "price_usd_min": 299,
  "price_usd_max": 449,                                // range covers kit / lite / full variants
  "vendor_url": "https://huggingface.co/blog/reachy-mini",  // where to BUY, not just docs
  "open_source_repo": "https://github.com/pollen-robotics/reachy_mini",  // optional but heavily preferred
  "idea_fit_tags": ["voice", "creative-coding", ...], // same closed-set tags as used catalog
  "notes": "≤500 chars. Concrete. What it can do out of the box.",
  "actuation_risk": 3,                                 // 1-5: 1 = no motion, 5 = serious moving parts (drone)
  "privacy_risk": 4,                                   // 1-5: 1 = nothing, 5 = always-on cam+mic+radio
  "image_url": "https://...",                          // optional; will be served via /api/img proxy
  "est_setup_hours_min": 2,
  "est_setup_hours_max": 6
}
```

### Inclusion bar for premium

Include if the device meets ALL of these:

1. **Open-source hardware OR firmware OR both** — not just "we publish a few example sketches." Open hardware = schematics + KiCad/Altium files public. Open firmware = any github repo with the runtime code.
2. **Currently purchasable from the manufacturer or an authorized retailer.** Not "preorder closed two years ago, occasionally on eBay."
3. **English-language documentation** — at least the canonical setup guide.
4. **An agent can plausibly call its interfaces** — Python SDK, REST API, MCP server, ROS topic, GPIO with documentation, USB protocol, etc. Pure consumer products with no programmable surface don't qualify.

### Risk axes

These are NEW for premium (replaces brick_risk in the used catalog). Both 1-5.

#### actuation_risk

How dangerous is the device's motion?

| Score | Bar | Examples |
|---|---|---|
| 1 | No moving parts | MagTag, Tufty, e-paper boards, ESP32 dev kits |
| 2 | Tiny vibration / haptic | PineTime (vibration motor), Crazyflie at idle |
| 3 | Moving parts at human scale, bounded by software | Reachy Mini (head tilts but small), servo arms |
| 4 | Could injure / damage if pointed wrong | Crazyflie in flight, Roomba, mobile robots |
| 5 | Industrial-scale or unbounded motion | full-size robot arms, off-road rovers |

#### privacy_risk

What does it observe / transmit?

| Score | Bar | Examples |
|---|---|---|
| 1 | No sensors, no radio, or only inward-facing | LiPo SBCs, status displays, bare microcontrollers |
| 2 | Bluetooth/Wi-Fi but no cam/mic | PineTime, MagTag |
| 3 | Mic OR camera, occasional capture | M5Stack Core2 (mic + small cam if added) |
| 4 | Always-on cam+mic OR RF transceiver | Reachy Mini, LimeSDR |
| 5 | Mobile, networked, multi-sensor | autonomous drone with cam + GPS + telemetry |

### risk_callouts (auto-derived)

Don't populate `risk_callouts` manually. The server scans `capabilities[]` for words like "camera", "microphone", "motor", "radio" and derives the list. Just write good capabilities.

---

## Sourcing checklist (do this for EVERY new entry)

For each candidate, verify before adding:

- [ ] **Vendor URL is currently 200**. Curl it.
- [ ] **Open source repo URL is 200** (if claimed). Curl it.
- [ ] **Repo has commits within the last 12 months** (or it's a finished kit not abandoned project).
- [ ] **Image URL is 200** if you provide one. Better to leave blank than to ship broken.
- [ ] **Brick provenance honest**: do you have 3+ independent sources for `community-reported`?
- [ ] **All `idea_fit_tags` exist in `tags.md`**.
- [ ] **Notes are concrete** — what makes this device useful, what's the catch.
- [ ] **Price range is plausible** — check the actual product page or eBay completed listings.

If any of these fails, either fix it or downgrade the entry's claims (mark llm-inferred, drop unverified URLs, etc.).

---

## Target product types for this round

### Premium (target ~30 new)

#### Robotics (priority — reviewer asked, agent-operability frontier)

- **LeRobot ecosystem**: SO-101, SO-100, Koch v1.1, Moss arm. All HuggingFace-blessed open arms. Repos under huggingface/lerobot or pollen-robotics.
- **iRobot Create 3** (mobile robot, ROS 2 native).
- **TurtleBot 4** (Lite + Standard). ROS 2 platform built on Create 3.
- **Crazyflie family** beyond 2.1+: Crazyflie 2.1+ (already in catalog), check 2.0 still sold.
- **PupperV3** (open-source quadruped, Stanford / others).
- **OpenCat** kits (Petoi).
- **Hexapods**: Pimoroni's HexyBot or similar.
- **Open RC platforms**: F1Tenth-style.

#### Displays / screens (open-source ecosystem)

- **Pimoroni Inky Frame** (4.0", 5.7", 7.3" Pico-driven e-paper). Distinct from Inky Impression (already in catalog) — the Frame variant has a Pico 2 W aboard.
- **Adafruit MagTag, FeatherWing TFTs, Sharp Memory Display**.
- **LILYGO T-Display family** (T-Display S3, T-Display AMOLED, larger T5 variants).
- **M5Stack** family beyond Core2: M5Paper, M5StickC Plus 2, M5Cardputer.
- **Hyperpixel touch displays** (already partially covered).
- **Reachy Mini's antennas** display ambient state — that's a wearable-display angle.
- **Pico-Display 2.0** boards.

#### Sensors / IoT

- **Adafruit Feather + STEMMA QT** ecosystem. Many sensor boards: SHT4x, AHT20, BME680, SCD-30 (CO₂), AS7341 (color), VL53L1X (lidar).
- **SparkFun Qwiic** sensor boards (similar STEMMA QT-compatible).
- **Pimoroni Enviro** indoor & outdoor.
- **TheThings Indoor Gateway** for LoRaWAN.
- **OpenMV** vision boards (open-source MicroPython + camera).

### Used (target ~20 new, MUST have public GitHub/GitLab repo in firmware_links)

#### Strong candidates with known GitHub presence

- **Steam Link box** (delisted but cheap on eBay; community OS exists)
- **Apple TV 4 / 4K** (jailbreakable via blackb0x for older firmware)
- **Bose SoundTouch / SoundLink** (community web API explorations on GitHub)
- **Sonos Play:1** (limited but firmware tools on GitHub)
- **Fire HD 7" / 8" older gens** (LineageOS port for some)
- **TI-84 Plus CE** (calculator, jailbreaks + linker tools on GitHub)
- **Logitech Harmony Hub** (community Python lib + Home Assistant)
- **Huawei E5573 mobile hotspot** (Linux underneath, OpenWrt-ish ports)
- **Old Android phones**: Pixel 3a / OnePlus 5T / Galaxy S8 (LineageOS support page is the firmware_link)
- **GoPro Hero 4** (custom firmware on GitHub)
- **Original Apple Watch S0** (very limited but homebrew exists)
- **Ricoh Theta S** (360 camera, github SDK)
- **Yale Lock / smart deadbolts** with public Z-Wave config
- **Rabbit R1** (already a meme, but firmware research on GitHub)
- **Humane AI Pin** (sad, but there's interest)

#### Routers / network gear with OpenWrt support

- **TP-Link Archer C7 / C2600 / C7 v5**
- **Linksys WRT3200ACM**
- **GL.iNet Slate / Beryl AX** (already OpenWrt-friendly)
- **Mikrotik hAP series** (RouterOS hacking)

#### Smart-home oddballs with community firmware

- **Sonoff Basic / Mini** (Tasmota / ESPHome)
- **Shelly 1 / 2.5** (already runs MQTT but Tasmota/ESPHome alternatives exist)
- **Aqara Hub M2** (community Z2M support)
- **IKEA Tradfri lights** (Zigbee2MQTT supports natively)

---

## Workflow for the research agent

1. **Pick a candidate** from the target lists above (or a related device you find that meets the inclusion bar).
2. **Verify the vendor URL is 200** via `curl -A "Mozilla/5.0" -sIL -o /dev/null -w "%{http_code}\n" "<url>"`.
3. **Verify the open-source repo URL is 200** and has recent commits (clone or check the API).
4. **Source 3 independent reports** for `community-reported` brick provenance. If you can only find 1, mark `llm-inferred`.
5. **Choose tags** from the closed set in `tags.md`. If you need a new tag, list it in the PR with a one-line definition.
6. **Estimate price + setup hours** from real evidence: vendor page, recent eBay sold listings, the canonical guide's stated "this took me X hours."
7. **Write notes** that pass the "would a tinkerer skim and decide" test in 1-2 sentences.
8. **Validate the JSON** locally with `cd site && npm run validate` before committing.

---

## Examples of good vs bad entries

### Good (passes the bar)

```json
{
  "id": "irobot-create-3",
  "name": "iRobot Create 3",
  "manufacturer": "iRobot",
  "category": "robot",
  "capabilities": [
    "32-bit ARM Cortex-M7 onboard",
    "ROS 2 Humble preinstalled",
    "Wi-Fi + USB-C control",
    "1080p IR + cliff sensors",
    "30+ ROS 2 topics published"
  ],
  "software_stack": [
    "ROS 2 Humble",
    "Create 3 ROS 2 API (/cmd_vel, /cmd_lightring, /cmd_audio)",
    "iRobot Education simulator (Webots)",
    "Python via rclpy"
  ],
  "price_usd_min": 199,
  "price_usd_max": 299,
  "vendor_url": "https://edu.irobot.com/what-we-offer/create3",
  "open_source_repo": "https://github.com/iRobotEducation/create3_examples",
  "idea_fit_tags": ["sensor", "iot", "creative-coding", "low-power"],
  "notes": "Mobile robot platform. Built on Roomba i-series chassis with full ROS 2 stack: subscribe to /odom, publish to /cmd_vel, drive it. Used in education + research widely. Indoor-only.",
  "actuation_risk": 4,
  "privacy_risk": 2,
  "est_setup_hours_min": 1,
  "est_setup_hours_max": 4
}
```

Why it's good: every URL is verifiable, capabilities are SPECIFIC (lists the actual ROS topics), software_stack mentions concrete tools, notes are concrete, risk scores match the device (mobile robot = 4 actuation, no cam/mic on stock = 2 privacy).

### Bad (rejected)

```json
{
  "id": "some-cool-robot",
  "name": "Some Cool Robot",
  "manufacturer": "Various",
  "category": "robot",
  "capabilities": ["does cool stuff"],
  "software_stack": ["software"],
  "price_usd_min": 100,
  "price_usd_max": 1000,
  "vendor_url": "https://maker-faire.example.com",
  "open_source_repo": null,
  "idea_fit_tags": ["robotics"],
  "notes": "A robot that does things",
  "actuation_risk": 3,
  "privacy_risk": 3
}
```

Why it's bad: Vague name. Capabilities not concrete. Software stack empty. Price range too wide (means you didn't check). Vendor URL probably 404s. No open-source repo. Tag "robotics" doesn't exist in tags.md. Notes useless.

---

## Output format for the research agent

For each candidate, deliver:

```
=== <id> ===
<paste the full JSON object>

VERIFICATION
- vendor_url: <code from curl>
- open_source_repo: <code from curl, last commit date>
- 3 community-reported sources (or "n/a, marked llm-inferred"):
    1. <url>  (one-line summary)
    2. <url>
    3. <url>
- New tags needed: <list, or "none">

NOTES FOR REVIEWER
- <anything ambiguous, pricing rationale, why this category, etc.>
```

That makes it trivial to merge into the catalog and to QA the work.

---

## When in doubt

- Skip the entry. A weak entry hurts more than a missing one.
- Mark `llm-inferred` and let the safety rule protect users.
- Open an issue on the repo asking for community input.

---

## After the research lands

The maintainer:

1. Reviews each entry against this spec.
2. Runs `cd site && npm run validate && npm test`.
3. Adds new tags to `tags.md` if any.
4. Spot-checks 2-3 of the firmware links manually.
5. Commits + bumps catalog version.

The catalog is the moat. Quality > quantity. Always.
