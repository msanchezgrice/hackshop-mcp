# Demo Recording Script (90 seconds)

Goal: show the moment of "I'd never have thought of using that." Not features. Not code. Just one delight.

## Setup

- Claude Desktop with `hackshop-mcp` installed (and `ebay-mcp` for the live-prices flourish at the end).
- Screen recorder (QuickTime, OBS, or similar). Resolution 1920x1080 minimum.
- Quiet room. Voice-over optional.
- Have the EO revival photo ready as a thumbnail/cover.

## Script

### 0:00 — 0:08 — The pain (8 seconds)

Voice-over or caption: *"I had a digital art frame that bricked when the company shut down. It took me six hours of forum-diving to revive it. I wondered: why doesn't the agent already know this?"*

On screen: still photo of the bricked Electric Objects frame, then the revival.

### 0:08 — 0:25 — The setup (17 seconds)

Cut to Claude Desktop. Show that hackshop-mcp is in the MCP server list.

Type into Claude:

> *"Propose hardware for an always-on family calendar in our kitchen. Light colors, no animation, very minimalist. I don't want a regular LCD. Maybe an old e-reader or repurposed tablet — give me ideas."*

### 0:25 — 0:50 — The proposals (25 seconds)

Claude calls `propose_hardware`. Show the structured output:

- Barnes & Noble Nook Touch — *"e-ink, 2011, Android 2.1 underneath, well-documented hack via SD card"*
- Amazon Kindle Paperwhite Gen 2 — *"jailbreakable, KOReader runs custom apps, common as wall dashboards"*
- iPad 2 — *"cheap on eBay, Guided Access for kiosk mode, no jailbreak required"*

Hover on the Nook. Show the `firmware_links` and `community_size`. Make the brick-risk score visible.

Voice-over: *"I'd never have considered a Nook. The agent has the hardware knowledge I'm missing."*

### 0:50 — 1:10 — The eBay flourish (20 seconds)

Optional but worth it: show the user copying the `ebay_query_suggestion` ("Barnes Noble Nook Simple Touch used") and pasting it into Claude with `ebay-mcp` configured. Three live listings appear, ranked by price.

Voice-over: *"And it composes with `ebay-mcp` for live listings. Two MCP servers, one workflow."*

### 1:10 — 1:25 — The pitch (15 seconds)

Cut back to a clean shot. Caption on screen:

> **`hackshop-mcp` — Idea-to-hardware mapping for tinkerers**
> `npx hackshop-mcp` (or add to your MCP client config)
> github.com/USERNAME/hackshop-mcp

Voice-over: *"It's open-source. Two tools. Fifty hand-vetted devices. Built because the agent should know what's hackable, even when I don't."*

### 1:25 — 1:30 — End card (5 seconds)

GitHub URL + npm package name + your handle for tinkerers to reach you.

## Don't include

- Code walkthrough — not the demo.
- Feature list — let the proposal output do the work.
- Architecture diagram — not the demo.
- Apologies, hedges, "still in development." Show what works, ship it.

## Recording tips

- One take is fine. Two-take goal: pick the better one.
- Don't narrate the typing. Type, pause, let the result load, then react.
- The "whoa" moment is the Nook recommendation. Slow down on that.
- If Claude takes more than 6 seconds to respond, edit the dead time out.
