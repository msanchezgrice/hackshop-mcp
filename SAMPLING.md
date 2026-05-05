# Sampling Contract

This server prefers MCP's `sampling/createMessage` to delegate LLM reasoning to the host. The host pays for tokens; users don't manage a second API key.

**Update (V0.0.2):** since not every MCP host implements sampling reliably (Claude Code does; Claude Desktop is spotty; many other clients don't yet), V0.0.2 adds an opt-in **direct Anthropic API fallback**. Set `ANTHROPIC_API_KEY` in the MCP server's env config and the server will use the Anthropic SDK directly when sampling fails. Without it, the server returns degraded responses (raw catalog matches with a clear note).

The fallback order is:
1. `server.createMessage` (host sampling) — preferred
2. retry `server.createMessage` once
3. direct Anthropic API call IF `ANTHROPIC_API_KEY` is set
4. degraded response (catalog matches by tag overlap, no reasoning)

## Boot probe

`src/server.ts` calls `probeSamplingSupport(server)` after connect. This sends a no-op `sampling/createMessage` and logs whether the host responded. Failure is non-fatal — `propose_hardware` will return degraded responses (raw catalog matches without reasoning).

Hosts known to support sampling:
- Claude Desktop
- Claude Code

Hosts unverified as of 2026-Q1:
- Cursor
- other clients

## propose_hardware sampling call

`propose_hardware` calls `sampleJson<SamplerPick>(...)` once per invocation. Schema:

### Inputs

System prompt is fixed (see `src/tools/propose_hardware.ts:SYSTEM_PROMPT`).

User prompt format:

```
Project idea: <idea>
Budget (USD): <budget_usd, if present>
Constraints: <constraints, if present>

Candidate hardware:
- id: <device-id> | name: <name> | category: <cat> | tags: <a, b, c> | notes: <notes>
- ...
```

### Expected output

JSON only, no markdown. Code-fence allowed (the parser strips it).

```json
{
  "picks": [
    { "id": "device-id-from-candidate-list", "why_this_fits": "one sentence" }
  ],
  "rationale": "one paragraph on the overall theme"
}
```

### Constraints on the host model

- `picks` must contain 0-5 entries.
- Each `id` MUST be in the candidate list. Hallucinated ids are dropped on the server side, not surfaced to the user.
- `why_this_fits` must reference the user's idea. The server doesn't enforce this, but the regression suite does.

### Token budget

`maxTokens: 1500` per call. With ~50 candidates × ~80 chars/line ≈ 4k token input + 1.5k output. Stay below 6k total.

### Error handling

- Sampling rejects → `sampleJson` returns `null`.
- Sampling response is non-text → `null`.
- Sampling response is text but not JSON-parseable → `null`.
- On `null`, `propose_hardware` retries once. On second `null`, returns degraded response.

The retry is in `sampleJson` itself (`src/sampling.ts`).

### What the server NEVER does

- Bundle an Anthropic / OpenAI / other-provider SDK.
- Read a user-side `ANTHROPIC_API_KEY` env var.
- Make HTTP calls to provider endpoints directly.
- Crash on sampling failure.

If a future feature seems to need a direct provider call, treat that as a redesign signal — not a quick patch.
