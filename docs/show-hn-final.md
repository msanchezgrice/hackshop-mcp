# Show HN — final, ready to submit

Submit at https://news.ycombinator.com/submit when you're ready. Post Tuesday or Wednesday, 8-10am Pacific (peak HN engagement). Have your demo recording attached as a comment, not in the title (HN strips images).

## Title

```
Show HN: Hackshop-MCP – an AI agent that knows what hardware is hackable
```

(70 chars, well under the 80-char limit. The em-dash is a regular hyphen for HN compatibility.)

## URL field

```
https://github.com/msanchezgrice/hackshop-mcp
```

(HN prefers a GitHub link over an npm link for Show HN posts.)

## Text field (the post body)

```
A few months ago I had an Electric Objects EO1 picture frame that bricked when the company shut down. Six hours of forum-diving and Claude assistance to revive it. The hack was fun. Finding what hardware is even hackable was the time-sink.

Hackshop-MCP is a small open-source MCP server that closes that gap. Tell your AI agent the project idea — "always-on family calendar for the kitchen, light colors, no animation, e-paper preferred" — and it returns 3-5 hand-vetted candidates: Waveshare 7.5" e-paper HAT, Pimoroni Inky Impression 7.3", reMarkable 2, jailbroken Kindle Paperwhite. Each proposal includes brick-risk, firmware repo links, community size, and clickable eBay/Hackaday/Reddit search URLs.

Two design choices I'm proudest of:

1. It composes with ebay-mcp at the host level instead of vendoring eBay integration. Knowledge layer (what's hackable) and procurement layer (what's currently for sale) stay separate. ~50% less code, no OAuth in this server.

2. There's a strict safety rule: for hardware classes where bricks are unrecoverable (handhelds, SBCs), the server refuses to surface LLM-inferred brick-risk scores. Hallucinating risk data is the failure mode that ends a tool like this in month one.

V0.0.2 ships 27 devices, two tools, and an Anthropic API fallback for hosts that don't yet implement sampling/createMessage cleanly. Install:

  npx hackshop-mcp

  or in any MCP client config:
  {
    "mcpServers": {
      "hackshop": {
        "command": "npx",
        "args": ["-y", "hackshop-mcp"],
        "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
      }
    }
  }

Built it for myself first; sharing because I can't be the only person who'd use this. Catalog PRs and "what device should I add" issues both very welcome.

GitHub: https://github.com/msanchezgrice/hackshop-mcp
npm:    https://www.npmjs.com/package/hackshop-mcp
```

## First comment to drop right after posting

Post immediately as a top-level comment on your own submission, before anyone else replies:

```
Author here. Two things worth flagging up front:

1. The catalog is currently 27 devices. That's deliberately tight — I'd rather have hand-vetted entries than a thousand half-checked ones. If your device isn't here and you want to vouch for its hackability, open an issue or PR.

2. The biggest UX gotcha: not every MCP host implements sampling/createMessage cleanly today. If you see "Reasoning unavailable" in the output, set ANTHROPIC_API_KEY in your client's env config — the server falls back to direct API calls. Documentation in SAMPLING.md.

Happy to answer architecture questions about why I went MCP-server-as-knowledge-layer vs CLI vs web app.
```

## Comments to be ready for

Anticipated, with prepared answers:

- **"Why not just use [generic AI search]?"** Web search returns articles. You wanted ranked devices that fit a specific project, with verifiable brick-risk and firmware repos. Different output shape, different defensibility.

- **"Why MCP and not a CLI?"** Because the agent can chain it: hackshop proposes hardware, ebay-mcp finds listings, your shopping agent buys it. CLI is a fallback, not the lead form.

- **"Catalog is too small."** Yes. V0.0.2 is 27 devices. The moat is verification quality, not size. Each entry includes brick-risk provenance — founder-verified, community-reported, or LLM-inferred — and the safety rule strips inferred scores for hardware classes where bricks are unrecoverable. That's the trade I'm making.

- **"Doesn't the LLM hallucinate device IDs?"** It does, occasionally. The server post-filters every pick against the catalog and drops anything not present. Tested in test/propose_hardware.test.ts.

- **"What's the business model?"** None. MIT, personal use, V0.x is the demand experiment.

- **"Why not also wrap the Hackaday/Reddit APIs to show recent posts?"** Considered. Decided against for V0 because: (a) every device proposal already includes a Hackaday search URL the agent can chain, (b) those APIs change shape often, and (c) keeping the server stateless is a feature.

- **"What about safety for the user — recommending devices that might be illegal to modify?"** Catalog is opt-in by the founder. If an entry is added that's questionable (DMCA territory, anti-circumvention), it gets removed. The safety rule above protects against bricking, not legality.

## What to NOT do

- **Don't post on a Friday.** HN dies over the weekend.
- **Don't link the npm tarball directly.** Repo first.
- **Don't apologize for "still being early."** Don't hedge. The package is real, install path is `npx hackshop-mcp`, that's enough.
- **Don't engage with snark or low-effort negativity.** Reply once with a real answer; don't get into it.

## Post-launch (first 4 hours)

- Sit at the laptop and answer comments within 15 min for the first hour. HN front-page survival depends on engagement velocity.
- If a comment surfaces a real bug, fix it on a branch, comment back ("fixed in 0.0.3 just published"). That motion = real founder behavior, gets upvotes.
- Track GitHub stars + npm install count. Goal for first 24h: ≥30 stars, ≥10 installs, ≥5 issues opened.
