# hackshop-mcp

Hardware-literate AI scout for tinkerers. Idea-to-hardware mapping via MCP.

You describe a project. The agent surfaces 3-5 hackable hardware options you wouldn't have thought of, with brick risk, firmware links, and a suggested eBay search query. Compose with [`ebay-mcp`](https://github.com/YosefHayim/ebay-mcp) for live listings.

## Why

A tinkerer has an idea. The idea would be cooler with the right piece of hardware attached: an old screen, an abandoned smart speaker, a bricked frame, a hackable handheld. The tinkerer doesn't know what hardware exists, what's hackable, or what would creatively *fit* the idea. So the idea stays purely software, or gets paired with a Raspberry Pi.

This is a hardware-knowledge layer on top of LLMs. Three tools, 68 hand-vetted devices, one closed-set tag vocabulary, and a brick-risk safety rule that won't let the agent fabricate a score for hardware classes where bricks are unrecoverable. The third tool — `simulate_assembly` — drops a proposed robot into a MuJoCo physics world and tells you, honestly, whether it would actually move.

## Status

v0.0.3 — published on npm. Install with `npx hackshop-mcp` or add to your MCP client config. Three tools (`propose_hardware`, `assess_hackability`, `simulate_assembly`), 68 hand-vetted devices. The simulation layer is live at [hackshop.dev](https://hackshop.dev).

## Install in 30 seconds

Add to your MCP client config (Claude Desktop / Claude Code / Cursor):

```json
{
  "mcpServers": {
    "hackshop": {
      "command": "npx",
      "args": ["-y", "hackshop-mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

The `ANTHROPIC_API_KEY` env var is **optional but recommended**. The server first tries `sampling/createMessage` (host-delegated reasoning, no key needed). If your host doesn't support that — many don't yet — the server falls back to a direct Anthropic API call when this key is set. Without it, you'll get raw catalog matches in degraded mode.

## Tools

### `propose_hardware(idea, budget_usd?, constraints?)`

Returns 3-5 hardware proposals, each with:

- `name` and `category`
- `why_this_fits` — one sentence referencing your idea explicitly
- `hack_difficulty` (1-5)
- `brick_risk` — numeric score, OR null + "unknown" label for hard-to-recover categories with LLM-inferred risk
- `brick_risk_disclaimer` — present when llm-inferred but score retained
- `firmware_links` — github repos, hackaday articles
- `community_size` — `tiny | small | active | thriving`
- `ebay_query_suggestion` — pass to `ebay-mcp`'s search tool for live listings

### `assess_hackability(device_name)`

Lookup by id, exact name, or substring. Returns the same shape as a single proposal. Use when you have a device in mind and want to verify hackability before searching for one to buy.

### `simulate_assembly(assembly)`

Takes an **Assembly IR** — `{ idea, components[{ref,device_id,name,role}], edges[], goal{kind,spec,success_metric}, world{template,goal_xy?} }` (build it from the site's assembly output or by hand) — drops it into a MuJoCo physics world, and runs a **bounded, synchronous** rollout (`duration_s` ≤ 10, default 8) on the sim-worker. It returns:

- `success` — did the rollout pass the typed position, collision, and upright acceptance criteria
- `summary` / `post_mortem` — natural-language verdict plus honest failure theatre (stuck / tipped / collisions / heading-oscillation)
- `artifacts` — hosted URLs for the rendered `video`, `scene` (MJCF), `control` (control.py), and `telemetry.json`
- `metric_value`, `telemetry`, `authored_by`, `world_desc`

Today it simulates the diff-drive **`navigate`** slice; other goal kinds return an honest `unsupported` rather than faking a pass. Set `SIM_WORKER_URL` to point at a running sim-worker (defaults to `http://127.0.0.1:8000`). The bounded rollout here is intentionally small so it fits in a single tool call; the **rich, longer, agent-driven runs happen via the web app** at [hackshop.dev](https://hackshop.dev), backed by the worker at [hackshop-sim.fly.dev](https://hackshop-sim.fly.dev).

## Simulation (v2)

The site turns a proposal into a watchable robot: **proposal → select one complete build → deterministic feasibility check → MuJoCo rollout → interactive 3D replay**, with a shareable summary page you can link to. Honest by design — a robot that gets stuck on a ramp gets a post-mortem, not a green checkmark.

The current navigation slice deliberately has a narrow fidelity contract:

- alternative chassis are separate candidates, never merged into one BOM;
- Create 3 uses an explicit Pi + RPLIDAR build, while TurtleBot 4 Lite preserves its factory-integrated Pi/camera/lidar stack;
- versioned manifests provide real outer dimensions and mass to product-specific primitive proxies (not pretend CAD);
- the controller only runs when the assembly declares the 2D-lidar observations it consumes;
- typed position/collision/upright criteria drive the verdict; and
- the browser replay supports orbit, zoom, playback/scrubbing, world geometry, path/goal overlays, and collision/failure markers.

- **Live:** [https://hackshop.dev](https://hackshop.dev)
- **Worker:** [https://hackshop-sim.fly.dev](https://hackshop-sim.fly.dev)
- **Design doc:** [`docs/v2-simulation-plan.md`](docs/v2-simulation-plan.md)

The `simulate_assembly` MCP tool above is the bounded, single-call entry point into this same physics worker.

## Architecture

- TypeScript + `@modelcontextprotocol/sdk`
- LLM reasoning delegated to the host via `sampling/createMessage` first; falls back to a direct Anthropic API call (`@anthropic-ai/sdk`) when `ANTHROPIC_API_KEY` is set and the host lacks sampling
- `simulate_assembly` calls out to a separate Python MuJoCo **sim-worker** over HTTP (`SIM_WORKER_URL`); the worker isn't bundled in the npm package
- Catalog stored as `catalog.json` in the repo (JSON, version-controllable, 68 devices in v0.0.3 — growing)
- Tag vocabulary in `tags.md`, validated at boot — server refuses to start on tag drift
- eBay integration is **not** in this server. Compose with [`ebay-mcp`](https://github.com/YosefHayim/ebay-mcp) at the host level.

## Install (local dev)

```bash
git clone <this-repo>
cd hackshop-mcp
npm install
npm run validate   # verifies catalog + tags
npm test           # safety + schema + lookup tests
npm run build      # tsc -> dist/
```

## Troubleshooting: verify sampling support

`propose_hardware` reasons via `sampling/createMessage`. Some MCP hosts don't support it (and without an `ANTHROPIC_API_KEY` fallback you'll get degraded, raw-catalog responses). If proposals come back without reasoning, verify your host supports sampling with this quick smoke check.

```bash
npm install
```

Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "hackshop-smoke": {
      "command": "tsx",
      "args": ["/Users/YOU/hackshop-mcp/scripts/smoke.ts"]
    }
  }
}
```

Restart Claude Desktop. Ask Claude to call the `smoke_check` tool. If it returns "Smoke OK," sampling works in your host. If it fails, set an `ANTHROPIC_API_KEY` (see install above) or expect degraded responses from `propose_hardware`.

## Install (local build → host)

To run a locally built copy instead of `npx`, add to your MCP client config:

```json
{
  "mcpServers": {
    "hackshop": {
      "command": "node",
      "args": ["/Users/YOU/hackshop-mcp/dist/server.js"]
    }
  }
}
```

For idea-to-hardware-to-listings flow, also install `ebay-mcp` from `YosefHayim/ebay-mcp`.

## The Story

The founder had an Electric Objects EO1 picture frame. The company shut down; the device bricked. He revived it with Claude, ~6 hours of firmware reverse-engineering. Wondered: "what if an agent already knew this stuff?" That's `hackshop-mcp`.

## Safety Rule (P0)

Bricking unrecoverable hardware is the single failure mode that ends this product. The catalog tracks brick-risk provenance: `founder-verified | community-reported | llm-inferred`. For categories where bricks are unrecoverable (`handheld`, `sbc`), the server **refuses to surface LLM-inferred brick-risk scores**. It returns "brick-risk unknown — research before flashing" instead. This is a tested release gate. See `src/safety.ts` and `test/safety.test.ts`.

## Contributing

See `CONTRIBUTING.md`. New devices come in via PR; tag changes require a `tags.md` edit; `community-reported` is the default provenance for community contributions.

## License

MIT.
