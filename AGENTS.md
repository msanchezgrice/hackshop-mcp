# AGENTS.md — hackshop-mcp

## What this project is

hackshop is an open-source MCP (Model Context Protocol) server and website that maps a natural-language project idea to hackable, repurposable, or protocol-native hardware. Given an idea (plus optional budget, constraints, and owned inventory), it returns 3-5 hardware candidates with hack difficulty, brick-risk rating, community size, used-market price range, setup-time estimate, live eBay search links, firmware repos, how-to guides, and architecture diagrams. MIT-licensed. Site: https://www.hackshop.dev

## Repository layout

- `src/` — the MCP server (TypeScript, Node). Entry point: `src/server.ts`. Tools in `src/tools/`, catalog logic in `src/catalog/`.
- `catalog.json`, `tags.md`, `catalog-candidates.json` — the device catalog and tagging data (ground truth for recommendations).
- `test/` — Vitest test suite (`npm test`).
- `scripts/` — `regress.ts`, `smoke.ts`, `validate-catalog.ts` (catalog validation / smoke / regression utilities).
- `site/` — the hackshop.dev website (Next.js 16 + React 19, deployed on Vercel). App router in `site/app/`, shared components in `site/components/`, logic in `site/lib/`. Static agent-facing files live in `site/public/`.
- `sim-worker/` — Python physics-simulation worker (Docker, Fly.io).
- `examples/` — example proposal JSON payloads.
- `docs/`, `content/` — planning docs and editorial content.

## Common commands

MCP server (repo root):

- `npm run build` — compile TypeScript (`tsc`)
- `npm run dev` — run the server via tsx
- `npm test` — run the Vitest suite
- `npm run validate` — validate the device catalog
- `npm run regress` / `npm run smoke` — regression and smoke scripts

Website (`site/`):

- `npm run dev` / `npm run build` / `npm start` — standard Next.js commands
- `npm run sync-data` — copy `catalog.json` and `tags.md` from the repo root into `site/`

## How agents should interact

- The site has no accounts, login, or checkout. Purchases happen off-site (eBay, manufacturer stores); never attempt to complete a purchase on a user's behalf.
- The demo on `/` POSTs to `/api/propose`, rate limited to 5 requests/hour/IP — do not loop or retry it. `/api/*` routes are disallowed in robots.txt and back the UI only.
- Controls tagged `data-agent-danger` (e.g. "Clear all" on `/inventory`) delete user data in browser localStorage — require explicit user confirmation.
- Agent-facing protocol files served by the site: `/llms.txt`, `/agents.md`, `/.well-known/agent-card.json`, `/.well-known/ai-agent.json`.
- Preferred programmatic integration: the MCP server itself (`npx -y hackshop-mcp`, requires `ANTHROPIC_API_KEY`).

## Conventions

- TypeScript, ESM, Vitest for tests; follow existing file layout when adding tools or catalog entries.
- Run `npm run validate` after editing `catalog.json`.
- Contact: msanchezgrice@gmail.com (include "Hackshop" in the subject line).
