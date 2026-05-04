# Installing hackshop-mcp into Claude Desktop

This is the install path the founder will run first to dogfood the server and verify the smoke test.

## 1. Smoke test (sampling/createMessage host probe)

Before installing the real server, verify your host actually supports `sampling/createMessage`. This is the load-bearing dependency.

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (create the file if it doesn't exist):

```json
{
  "mcpServers": {
    "hackshop-smoke": {
      "command": "/Users/miguel/.local/bin/node",
      "args": [
        "/Users/miguel/.bun/bin/tsx",
        "/Users/miguel/hackshop-mcp/scripts/smoke.ts"
      ]
    }
  }
}
```

Adjust paths if your `node` or `tsx` are elsewhere. Verify with:

```bash
which node
which tsx  # or: find ~/.bun -name tsx
```

Quit Claude Desktop fully (Cmd+Q, not just close window). Reopen.

In a new conversation, type:

> Use the smoke_check tool from the hackshop-smoke server.

Expected response: *"Smoke OK. Host returned: ok. Your architecture is real. Build the server."*

If it fails: stop. Do not install the real server. The error message will tell you what's wrong (auth, capability mismatch, transport).

## 2. Install the real server

After smoke passes, replace the smoke entry with the real server:

```json
{
  "mcpServers": {
    "hackshop": {
      "command": "/Users/miguel/.local/bin/node",
      "args": ["/Users/miguel/hackshop-mcp/dist/server.js"]
    }
  }
}
```

Make sure you've built first:

```bash
cd ~/hackshop-mcp && npm run build
```

Quit Claude Desktop. Reopen.

## 3. Compose with ebay-mcp (optional but recommended)

For live listings, also install `ebay-mcp` from `YosefHayim/ebay-mcp`. Follow that repo's install instructions; it expects eBay developer credentials.

```json
{
  "mcpServers": {
    "hackshop": { ... },
    "ebay": {
      "command": "node",
      "args": ["/path/to/ebay-mcp/dist/server.js"],
      "env": {
        "EBAY_APP_ID": "your-app-id",
        "EBAY_CERT_ID": "your-cert-id"
      }
    }
  }
}
```

In Claude Desktop, both servers are available simultaneously. The agent can call `propose_hardware` from `hackshop`, then chain into `ebay-mcp`'s search tool with the suggested query string.

## 4. Dogfood

Start with three real ideas:

1. **The EO revival regression** — *"propose hardware for a wall-mountable digital art display, sub-$300, supports custom firmware"*. Expect: `electric-objects-eo1` in output.
2. **The kitchen calendar** — *"propose hardware for an always-on family calendar in the kitchen, light colors, no animation, e-paper preferred"*. Expect: Nook Touch, Kindle PW2, iPad 2.
3. **One new idea you have queued** — anything you're actually thinking about. This tells you whether the catalog or system prompt covers your real use cases.

After each, note what was missing. Issues to log:
- Devices the agent should have surfaced but didn't (catalog gap)
- Devices it surfaced incorrectly (prompt or scoring drift)
- "Why this fits" reasoning that didn't reference your idea (prompt issue)
- Brick-risk scores that look wrong (verification gap)

Each becomes a targeted fix.

## Troubleshooting

- **"sampling/createMessage method not supported"** — your Claude Desktop version may be too old. Update.
- **"Catalog failed schema validation"** at boot — run `npm run validate` to see which entry is broken.
- **Tag drift error** at boot — a catalog entry uses a tag not in `tags.md`. Add the tag to `tags.md` or fix the entry.
- **Server starts but tools don't appear** — check that the `command` path is absolute and executable. Claude Desktop logs at `~/Library/Logs/Claude/`.
