#!/usr/bin/env tsx
// Day-0 smoke test for sampling/createMessage. Run via `npm run smoke`.
//
// This builds a one-tool MCP server that calls sampling/createMessage with
// "say hi". Install in Claude Desktop / Claude Code, restart the host, invoke
// the tool. If you get a response back, the load-bearing dependency works.
//
// Usage: add this to your MCP client config:
//
//   "hackshop-smoke": {
//     "command": "tsx",
//     "args": ["/full/path/to/hackshop-mcp/scripts/smoke.ts"]
//   }
//
// Then restart the host and call the `smoke_check` tool with no arguments.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

async function main(): Promise<void> {
  // Sampling is a client capability, not a server capability. Server just
  // calls server.createMessage and the host responds (or doesn't).
  const server = new Server(
    { name: "hackshop-smoke", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "smoke_check",
        description:
          "Calls sampling/createMessage with a trivial prompt to verify host support.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== "smoke_check") {
      throw new Error(`Unknown tool: ${req.params.name}`);
    }
    try {
      const response = await server.createMessage({
        systemPrompt: "Reply with the single word: ok",
        messages: [
          { role: "user", content: { type: "text", text: "smoke" } },
        ],
        maxTokens: 8,
      });
      const text =
        response.content.type === "text" ? response.content.text : "(non-text)";
      return {
        content: [
          {
            type: "text",
            text: `Smoke OK. Host returned: ${text}\nYour architecture is real. Build the server.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text:
              `Smoke FAILED: ${(err as Error).message}\n` +
              `This host does not support sampling/createMessage. ` +
              `hackshop-mcp requires a host that does (Claude Desktop, Claude Code). ` +
              `STOP and figure out why before scaffolding more.`,
          },
        ],
      };
    }
  });

  await server.connect(new StdioServerTransport());
  process.stderr.write("[smoke] hackshop-smoke ready. Invoke `smoke_check`.\n");
}

main().catch((e) => {
  process.stderr.write(`[smoke] Fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
