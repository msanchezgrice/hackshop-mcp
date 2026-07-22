# hackshop — agent guide

hackshop (hackshop-mcp) is an open-source MCP server and website that maps a project idea to hackable, repurposable, or protocol-native hardware. Canonical URL: https://www.hackshop.dev

## What the product does

Given a natural-language project idea (plus optional budget, constraints, and owned inventory), hackshop returns 3-5 hardware candidates with hack difficulty, brick-risk rating, community size, used-market price range, estimated setup time, live eBay search links, firmware repos, step-by-step how-to guides, and AI-generated architecture diagrams.

## Key routes

- `/` — home and live demo form ("Propose hardware" is the primary action).
- `/templates` — pre-filled project templates.
- `/inventory` — manage a localStorage list of hardware the user already owns.
- `/resources` — editorial field guides; individual posts at `/resources/{slug}`.
- `/about`, `/contact`, `/privacy`, `/terms` — informational/legal pages.
- `/llms.txt`, `/agents.md`, `/.well-known/agent-card.json`, `/.well-known/ai-agent.json` — agent-facing protocol files.

## How agents should interact

- Read content freely on all public pages listed above.
- The demo form on `/` POSTs to `/api/propose` and is rate limited to 5 requests/hour/IP; treat it as a scarce resource and do not retry in a loop. Forms are tagged with `data-agent-form`, and the primary submit button carries `data-agent-action="propose-hardware"`.
- Buttons carrying `data-agent-danger` (e.g. "Clear all" on `/inventory`) delete user data stored in the browser — do not activate them without explicit user confirmation.
- Inventory state lives in browser localStorage only; there are no accounts, logins, or checkout flows on this site.
- Purchases happen off-site (eBay, manufacturer stores). Do not attempt to complete any external purchase on the user's behalf.

## Programmatic access

The recommended integration is the MCP server (`npx -y hackshop-mcp`), documented in the README at https://github.com/msanchezgrice/hackshop-mcp. The site's `/api/*` routes back the UI, are disallowed to crawlers in robots.txt, and may change without notice.

## Contact

msanchezgrice@gmail.com — include "Hackshop" in the subject line.
