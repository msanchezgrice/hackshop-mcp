#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadCatalog } from "./catalog/load.js";
import { probeSamplingSupport } from "./sampling.js";
import {
  proposeHardware,
  proposeHardwareInput,
} from "./tools/propose_hardware.js";
import {
  assessHackability,
  assessHackabilityInput,
} from "./tools/assess_hackability.js";

const NAME = "hackshop-mcp";
const VERSION = "0.0.2";

async function main(): Promise<void> {
  // Boot validation. Refuses to start on bad catalog/tags.
  const { devices, tags } = loadCatalog();
  process.stderr.write(
    `[hackshop-mcp] Catalog loaded: ${devices.length} devices, ${tags.size} tags.\n`,
  );

  // Note: sampling is a CLIENT capability, not a server one. We don't declare
  // it here; we just call server.createMessage(...) and the host either
  // supports it or doesn't. probeSamplingSupport() handles the check.
  const server = new Server(
    { name: NAME, version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "propose_hardware",
        description:
          "Given a project idea (vague is fine), return 3-5 hardware proposals with 'why this fits', hack difficulty, brick risk (with safety rule applied), firmware links, community size, and a suggested eBay search query string. Compose with ebay-mcp at the host level for live listings.",
        inputSchema: {
          type: "object",
          properties: {
            idea: {
              type: "string",
              description:
                "Project idea, free-form. Vague is OK; the agent will use creativity.",
            },
            budget_usd: {
              type: "number",
              description: "Optional budget in USD. Affects eBay query suggestions.",
            },
            constraints: {
              type: "string",
              description:
                "Optional constraints (e.g., 'must be wall-mountable', 'low power').",
            },
          },
          required: ["idea"],
        },
      },
      {
        name: "assess_hackability",
        description:
          "Given a device name, return: hackable y/n, hack difficulty, brick risk (with safety rule applied), firmware links, community size, last verified date, and notes. Looks up by id, exact name, or substring.",
        inputSchema: {
          type: "object",
          properties: {
            device_name: {
              type: "string",
              description: "Device name or id.",
            },
          },
          required: ["device_name"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "propose_hardware") {
      const input = proposeHardwareInput.parse(args);
      const out = await proposeHardware(input, devices, server);
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
      };
    }

    if (name === "assess_hackability") {
      const input = assessHackabilityInput.parse(args);
      const out = assessHackability(input, devices);
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Probe sampling support after connect. Logs to stderr; never fatal.
  // Some hosts (Claude Desktop, Claude Code) support sampling/createMessage;
  // some clients don't. If unsupported, propose_hardware degrades gracefully.
  void probeSamplingSupport(server).then((ok) => {
    if (!ok) {
      process.stderr.write(
        "[hackshop-mcp] Warning: this MCP host does not appear to support " +
          "sampling/createMessage. The propose_hardware tool will return " +
          "degraded responses (raw catalog matches without reasoning). " +
          "Hosts known to support sampling: Claude Desktop, Claude Code.\n",
      );
    } else {
      process.stderr.write("[hackshop-mcp] Sampling probe OK.\n");
    }
  });

  process.stderr.write(`[hackshop-mcp] ${NAME} v${VERSION} ready.\n`);
}

main().catch((err) => {
  process.stderr.write(`[hackshop-mcp] Fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
