# hackshop-mcp

Hardware-literate AI scout for tinkerers. Idea-to-hardware mapping via MCP.

You describe a project. The agent surfaces 3-5 hackable hardware options you wouldn't have thought of, with brick risk, firmware links, and a suggested eBay search query. Compose with [`ebay-mcp`](https://github.com/YosefHayim/ebay-mcp) for live listings.

## Why

A tinkerer has an idea. The idea would be cooler with the right piece of hardware attached: an old screen, an abandoned smart speaker, a bricked frame, a hackable handheld. The tinkerer doesn't know what hardware exists, what's hackable, or what would creatively *fit* the idea. So the idea stays purely software, or gets paired with a Raspberry Pi.

This is a hardware-knowledge layer on top of LLMs. Two tools, 27 hand-vetted devices, one closed-set tag vocabulary, and a brick-risk safety rule that won't let the agent fabricate a score for hardware classes where bricks are unrecoverable.

## Status

V0.0.2 — published on npm. Install with `npx hackshop-mcp` or add to your MCP client config.

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

## Architecture

- TypeScript + `@modelcontextprotocol/sdk`
- LLM reasoning delegated to the host via `sampling/createMessage` (no Anthropic SDK bundled, no BYO key)
- Catalog stored as `catalog.json` in the repo (JSON, version-controllable, 27 devices in V0.0.2 — growing)
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

## Day-0 Smoke Test (REQUIRED before scaffolding more)

This server depends on `sampling/createMessage`. Some MCP hosts don't support it. Verify yours does first.

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

Restart Claude Desktop. Ask Claude to call the `smoke_check` tool. If it returns "Smoke OK," your architecture works. If it fails, stop here — `hackshop-mcp` won't work in this host.

## Install (target host)

After dev is done and smoke passes, add to your MCP client config:

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
