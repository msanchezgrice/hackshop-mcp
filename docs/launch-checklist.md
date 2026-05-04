# Launch Checklist

Pre-launch sanity checks. Don't ship until every box is ticked.

## Code

- [ ] `npm run validate` returns OK with ≥ 20 devices in catalog
- [ ] `npm test` passes (currently 23/23)
- [ ] `npm run build` clean, no TS errors
- [ ] `npm run regress` ≥ 5/5 examples pass
- [ ] Brick-risk safety rule has its own test file (currently 6 tests in `test/safety.test.ts`)
- [ ] Sampling probe message is clear and points to compatible hosts
- [ ] EO revival example (P0) passes against the actual server in Claude Desktop, not just the offline regression

## Docs

- [ ] README.md leads with the EO revival story
- [ ] README has a 30-second install path
- [ ] README links to demo recording
- [ ] SAMPLING.md exists with the contract spelled out
- [ ] CONTRIBUTING.md exists with the device PR template
- [ ] LICENSE file present (MIT)

## Demo

- [ ] 90-second demo recording landed (see `docs/demo-script.md`)
- [ ] Demo shows the calendar idea (Nook Touch surprise)
- [ ] Demo shows compose-with-ebay-mcp (the second tool flourish)
- [ ] Demo embedded in README
- [ ] Cover frame chosen — pick the moment of "Nook Touch" appearing on screen

## Distribution

- [ ] GitHub repo public
- [ ] GitHub Actions CI green on main
- [ ] `npm publish --dry-run` shows expected files
- [ ] `npm publish` complete, package installable via `npx hackshop-mcp`
- [ ] MCP registry entry submitted (official registry only — community indexes are V1.1)

## Launch

Pick ONE channel for V1. Other channels are V1.1 if Month-1 signal is real.

- [ ] If Hackaday: tip-line submission with `docs/hackaday-pitch-draft.md` body, demo image
- [ ] If Show HN: `docs/show-hn-draft.md` polished, posted Tuesday-Thursday morning Pacific time
- [ ] X / Bluesky thread queued for launch hour
- [ ] First comment / reply ready (the worked-example "here's what I'd build with this" follow-up)

## Post-launch (Week 1-4)

- [ ] Watch GitHub stars, npm install count, MCP registry page views daily
- [ ] Reply to every issue / comment within 24 hours
- [ ] Track which device types get requested in issues — that's V1.1 catalog priority
- [ ] At Day 30, evaluate against Month-1 stretch threshold: ≥20 installs OR ≥3 unsolicited comments OR ≥1 blog mention
- [ ] If above threshold: start V1.1 (third tool + 50 more devices). If below: keep using personally; the public-demand experiment didn't return signal — that's a real answer, not a failure.

## Don't ship if

- The demo recording is anything less than crisp (better to wait a day than ship a fuzzy demo)
- The catalog has fewer than 20 entries
- The smoke test doesn't pass on YOUR machine in YOUR Claude Desktop
- Any test in `test/safety.test.ts` is failing
- The EO revival regression doesn't pass when run interactively in Claude Desktop (catalog or prompt is broken)
