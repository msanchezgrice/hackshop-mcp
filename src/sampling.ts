import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import Anthropic from "@anthropic-ai/sdk";

// Wraps sampling/createMessage with retry-once + Anthropic-API fallback +
// degraded-response semantics. Returns either parsed JSON of shape T, or null
// if every path failed.
//
// Order of attempts:
//   1. server.createMessage (host-delegated sampling)  — preferred
//   2. retry server.createMessage once on transient failure
//   3. direct Anthropic API call IF process.env.ANTHROPIC_API_KEY is set — fallback
//   4. return null → caller produces a degraded response
//
// The fallback exists because not all MCP hosts implement sampling/createMessage
// today. Claude Code supports it; Claude Desktop's support has been spotty;
// Cursor / Cowork / other clients may not. Setting ANTHROPIC_API_KEY in your
// MCP client config (under "env") gives the user reasoning even on hosts
// without sampling.
export async function sampleJson<T>(opts: {
  server: Server;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}): Promise<T | null> {
  const { server, systemPrompt, userPrompt, maxTokens = 1500 } = opts;

  const tryHostSampling = async (): Promise<T | null> => {
    try {
      const response = await server.createMessage({
        systemPrompt,
        messages: [
          {
            role: "user",
            content: { type: "text", text: userPrompt },
          },
        ],
        maxTokens,
        modelPreferences: {
          intelligencePriority: 0.6,
          speedPriority: 0.4,
        },
      });
      const content = response.content;
      if (content.type !== "text") return null;
      return parseJsonLoose<T>(content.text);
    } catch {
      return null;
    }
  };

  // Attempt 1: host sampling
  const first = await tryHostSampling();
  if (first !== null) return first;

  // Attempt 2: one retry
  const second = await tryHostSampling();
  if (second !== null) return second;

  // Attempt 3: direct Anthropic API fallback (env-gated)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model: process.env.HACKSHOP_MODEL ?? "claude-sonnet-4-6",
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });
      const block = response.content[0];
      if (block && block.type === "text") {
        const parsed = parseJsonLoose<T>(block.text);
        if (parsed !== null) {
          process.stderr.write(
            "[hackshop-mcp] Sampling failed; used Anthropic API fallback (ANTHROPIC_API_KEY).\n",
          );
          return parsed;
        }
      }
    } catch (err) {
      process.stderr.write(
        `[hackshop-mcp] Anthropic fallback failed: ${(err as Error).message}\n`,
      );
    }
  }

  return null;
}

// Strip a possible markdown code fence around JSON. Tolerant of whitespace
// and explanatory prose around the fence.
function parseJsonLoose<T>(text: string): T | null {
  const trimmed = text.trim();
  // Look for fenced JSON anywhere in the string.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  let candidate = fenced ? fenced[1] : trimmed;
  if (!candidate) return null;
  // If model returned prose + JSON, try to extract the first {...} block.
  if (!candidate.trim().startsWith("{") && !candidate.trim().startsWith("[")) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      candidate = candidate.slice(start, end + 1);
    }
  }
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}

// Boot-time probe to verify the host supports sampling/createMessage. Logs
// the result to stderr; never fatal. The Anthropic API fallback (if env-set)
// makes this informational rather than load-bearing.
export async function probeSamplingSupport(server: Server): Promise<boolean> {
  try {
    const response = await server.createMessage({
      systemPrompt:
        "Respond with the single word: ok. No punctuation, no explanation.",
      messages: [
        { role: "user", content: { type: "text", text: "probe" } },
      ],
      maxTokens: 8,
    });
    return response.content.type === "text";
  } catch {
    return false;
  }
}
