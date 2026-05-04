# Show HN — hackshop-mcp

Two versions below. Pick one based on tone. The first is the founder-story version; the second is the technical-thesis version. Both run ~150 words for the body so the title carries weight.

---

## Version A — The founder-story title

**Show HN: hackshop-mcp — an AI agent that knows what hardware is hackable**

I had an Electric Objects digital art frame that bricked when the company shut down. It took me ~6 hours of forum-diving and Claude assistance to revive it. I kept thinking: why doesn't the agent already know this?

`hackshop-mcp` is an MCP server that maps a project idea to hackable hardware. Tell it "I want an always-on family calendar in my kitchen, light colors, no animation, e-paper if possible" and it surfaces 3-5 candidates: Nook Touch, Kindle Paperwhite, iPad 2 in kiosk mode — with brick-risk, firmware links, and an eBay search query. Compose with `ebay-mcp` at the host level for live listings.

V1 is two tools, 50 hand-vetted devices, and a strict safety rule that refuses to hallucinate brick-risk for hardware classes where bricks are unrecoverable.

GitHub: github.com/USERNAME/hackshop-mcp

I'm building this for myself. If you tinker, please try it and tell me what's missing.

---

## Version B — The technical-thesis title

**Show HN: hackshop-mcp — composing MCP servers as a knowledge layer**

A pattern I keep seeing: AI agents have eBay tools (`ebay-mcp` exposes 325 of them), but no idea what's actually hackable. The hardware database is the missing piece.

`hackshop-mcp` is a small MCP server that fills that gap. Two tools — `propose_hardware(idea)` and `assess_hackability(device)` — backed by 50 hand-vetted entries and a closed-set tag vocabulary. It uses MCP `sampling/createMessage` to delegate reasoning to the host LLM, so there's no Anthropic SDK bundled and no second API key to manage.

The design choice I'm proudest of: it doesn't try to be a marketplace. eBay is already a marketplace. `ebay-mcp` already exposes it. `hackshop-mcp` is just the knowledge layer that tells the host "for that idea, surface these devices." Two MCP servers, one workflow at the host.

GitHub: github.com/USERNAME/hackshop-mcp

Feedback welcome — particularly from people who've shipped MCP servers and want to argue about the sampling-delegation pattern.

---

## Title-only options (in case you want a third route)

- "Show HN: An MCP server that proposes hackable hardware for your projects"
- "Show HN: hackshop-mcp — turn vague project ideas into hardware candidates"
- "Show HN: Compose your AI agent with a hardware-knowledge MCP server"

## Comments to be ready for

- *"Why not just use [random web search]?"* — Web search returns articles; you wanted ranked devices that fit a specific project idea, with verifiable brick-risk and firmware links. Different shape.
- *"Why MCP and not a CLI?"* — Because you live in Claude Code/Desktop already. The agent chains tools naturally. A CLI is a fallback, not the lead form.
- *"Catalog is too small."* — Yes. V1 is 50; community PRs welcome (see CONTRIBUTING.md). The moat is verification quality, not size.
- *"Why no licensing/safety review for telling people to flash random devices?"* — There's a strict refusal rule for `handheld | sbc + llm-inferred` brick-risk; bricked-but-recoverable categories get the score, others don't. See `src/safety.ts`.
- *"What's the business model?"* — None. It's MIT, the founder uses it personally, V1 is the demand experiment.
