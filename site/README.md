# site/ — Live website for hackshop-mcp

Next.js 16 + AI SDK v6 + Anthropic. Marketing page that IS a working product preview: visitors submit an idea, the server calls Anthropic with the catalog, returns real proposals with brick-risk + eBay URLs.

## Local dev

```bash
cd site
cp .env.example .env.local
# edit .env.local and set ANTHROPIC_API_KEY
npm install
npm run dev
```

Open http://localhost:3000. Submit an idea in the demo form to verify the API route works.

## Deploy to Vercel

### One-time setup (CLI route)

```bash
cd site
npx vercel link        # links this directory to a Vercel project
npx vercel env add ANTHROPIC_API_KEY production    # paste your key when prompted
npx vercel deploy --prod
```

### One-time setup (Dashboard route)

1. Go to https://vercel.com/new
2. Import `msanchezgrice/hackshop-mcp`
3. **Set Root Directory to `site/`** (critical — this monorepo has the npm package at root)
4. Framework: Next.js (auto-detected)
5. Add env var: `ANTHROPIC_API_KEY` = your key
6. Deploy

After the first deploy, Vercel auto-deploys on every push to `main` that touches `site/`.

## Costs

Default model is `claude-haiku-4-5-20251001` to keep demo costs near zero (~$0.002/call). Switch to Sonnet via the `HACKSHOP_MODEL` env var if quality matters more than cost.

Rate limit is 5 requests/hour/IP (in-process, lost on cold start). For real launch volume, swap for Upstash Redis or Vercel KV via the marketplace.

## Sync catalog from the npm package

The site has its own copies of `catalog.json` and `tags.md` (Vercel deploys can only access files inside the project root). When the parent's catalog updates, sync:

```bash
cd site
npm run sync-data    # cp ../catalog.json ./catalog.json && cp ../tags.md ./tags.md
git add catalog.json tags.md
git commit -m "site: sync catalog from npm package"
```

V1.x improvement: import directly from the published `hackshop-mcp` npm package. Currently we duplicate to keep the deploy boundary clean.

## What it does NOT do

- Stream the response (turn-based fetch; user sees a "Thinking…" spinner for ~3-8s)
- Persist anything (no DB, no analytics)
- Track users (no cookies, no auth, no rate-limit storage beyond per-instance)
- Embed an MCP server in the browser (the MCP server is the npm package; this is a regular HTTP API for the demo)

## Stack

- Next.js 16 App Router
- Server-side `/api/propose` (Fluid Compute, Node.js runtime)
- AI SDK v6 with `@ai-sdk/anthropic`
- Zod for input validation
- Vanilla CSS (no Tailwind, no shadcn — kept lean)
