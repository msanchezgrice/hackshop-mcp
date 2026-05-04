# Contributing to hackshop-mcp

The catalog is the moat. New devices come in via PR. Tags come in via `tags.md` edits. Provenance matters.

## Adding a device

1. **Pick an id.** lowercase-kebab-case, unique. Format: `manufacturer-model-revision`. Example: `electric-objects-eo1`.
2. **Verify hackability.** Either:
   - You've personally flashed / modded this device → `brick_provenance: "founder-verified"` (only the maintainer's commits count for this).
   - You've found credible community reports (3+ unique sources, not all linking back to the same forum thread) → `brick_provenance: "community-reported"`.
   - Otherwise → `brick_provenance: "llm-inferred"`. Note: for `category: "handheld" | "sbc"`, llm-inferred brick-risk is **stripped from output** by the safety rule. The device will still appear, but with "brick-risk unknown."
3. **Write the entry** in `catalog.json`. All fields required (see `src/catalog/schema.ts`).
4. **Tags must be in `tags.md`.** Server fails to start otherwise. If you need a new tag, edit `tags.md` in the same PR.
5. **Notes capped at 500 chars.** Keep them concrete. If the same thing keeps showing up across many devices, it should become a structured field, not a notes blurb.
6. **`last_verified` is the date you confirmed the entry, in `YYYY-MM-DD` format.** Quarterly re-verification is the eventual goal.

## Adding a tag

1. Edit `tags.md`. Format: `- \`tag-name\` — short description`.
2. Tag names: lowercase-kebab-case. Singular. No emoji.
3. Try to fit into an existing section (Output / Audio / Input / etc.) before creating a new one.
4. Total tag count target: ~25. If you're pushing past 30, the vocabulary is too granular — fold tags together.

## PR template

```
## Device added
- id: ...
- category: ...
- provenance: founder-verified | community-reported | llm-inferred

## Verification (required for non-llm-inferred)
- [ ] I have flashed / modded this device personally, OR
- [ ] I have linked 3+ credible community sources

## Sources
- (url)
- (url)

## Tag changes (if any)
- New tag: ...
- Reason: ...

## Brick-risk provenance check (for handheld | sbc)
- [ ] I understand that llm-inferred provenance for handheld/sbc results in brick-risk being stripped from output (the safety rule).
```

## What not to add

- Devices that aren't hackable. The catalog is for hackable hardware only.
- Devices you can't find in any secondary market. The point is helping users acquire them.
- Devices with brand-new firmware updates that closed the hack. (These get removed quarterly.)

## Tests must pass

Before opening a PR:

```bash
npm run validate   # catalog + tags
npm test           # safety, schema, lookup
npm run regress    # regression examples
```

Boot validation will catch tag drift; the regression runner will catch catalog/prompt drift on the existing examples.

## License

By contributing, you agree your contribution is MIT-licensed.
