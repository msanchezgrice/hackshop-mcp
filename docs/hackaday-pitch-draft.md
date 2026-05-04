# Hackaday Pitch Draft

The Hackaday pipeline is editorial — they decide which projects land. Pitch via tip-line at https://hackaday.com/submit-a-tip with a 200-word teaser, a strong demo image, and the GitHub URL. Lead time can be days to weeks. Pitch only after the demo recording is solid.

## Subject

`Project: hackshop-mcp — an MCP agent that recommends hackable hardware for your project ideas`

## Body (200 words)

A few months ago I had to revive an Electric Objects EO1 picture frame after the company shut down. It took six hours of forum-diving and Claude assistance to figure out the firmware path. Standard tinkerer experience: the hack is fun, but finding *what hardware is even hackable* for a given project is where the time goes.

`hackshop-mcp` is a small open-source MCP server that flips that. Tell your AI agent the idea — *"always-on family calendar, e-paper preferred, no LCD"* — and it returns 3-5 hand-vetted candidates with brick-risk, firmware repo links, community size, and a suggested eBay search query. For my calendar idea it surfaces a Nook Simple Touch, a jailbreakable Kindle, and an iPad 2 in Guided Access mode.

It's deliberately small: two tools, 50 hand-vetted devices, a closed-set tag vocabulary, and a safety rule that refuses to hallucinate brick-risk for hardware classes where bricks are unrecoverable (handhelds, SBCs). The server delegates LLM reasoning to the host via MCP `sampling/createMessage`, so there's no API key for users to manage.

Source + install instructions: github.com/USERNAME/hackshop-mcp

Built for myself first. Now sharing it because I can't be the only person who'd use this.

— Miguel

## Demo image

Use a still from the demo recording at the moment the Nook Touch proposal appears. Crop tight on the agent's response so the device name + brick-risk + firmware link are all visible at glance.

Backup: a clean screenshot of the EO1 frame revival as the "before/after" the project enables.

## Why Hackaday over Hackernews first

- Audience match. Hackaday readers actively repurpose old electronics; that's literally the use case.
- Higher trust signal. A Hackaday writeup is a real referral, not a 4-hour rank window.
- Trades speed for depth. If you have a polished demo and the catalog is genuinely vetted, this is worth the editorial wait.

If the demo recording isn't strong, run Show HN instead — it's more forgiving.

## What to include in the GitHub README before pitching

- README.md leads with the EO revival as the worked example. (Already done.)
- Install path is < 5 commands and works on macOS + Linux.
- Demo recording embedded at the top of the README.
- An "Original idea-to-hardware example" section with the calendar example walked through end-to-end.

If any of those are missing, fix before pitching. Hackaday writers will skim — make the lead obvious.
