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
// Optional out-channel so callers can surface WHY sampling degraded in a
// user-visible message (not just stderr). Populated only on the failure paths.
export interface SamplingDiagnostics {
  // Set when an ANTHROPIC_API_KEY was present but the direct-API fallback threw
  // (e.g. retired model id, auth error). Caller should include this hint in its
  // degraded response so the failure is visible, not silent.
  apiFallbackError?: string;
}

export async function sampleJson<T>(opts: {
  server: Server;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  diagnostics?: SamplingDiagnostics;
}): Promise<T | null> {
  const { server, systemPrompt, userPrompt, maxTokens = 1500, diagnostics } = opts;

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

  // Attempt 3: direct Anthropic API fallback (env-gated). Default model id kept
  // current ('claude-sonnet-4-6'); override via HACKSHOP_MODEL. If this throws
  // WHILE a key was present (e.g. the default model was retired), we record the
  // error in `diagnostics` so the caller can make the failure user-visible
  // instead of degrading silently to stderr only.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    const fallbackModel = process.env.HACKSHOP_MODEL ?? "claude-sonnet-4-6";
    try {
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model: fallbackModel,
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
      // Key present, call succeeded, but content was unusable — note it.
      if (diagnostics) {
        diagnostics.apiFallbackError = `Anthropic API fallback (model "${fallbackModel}") returned no usable JSON.`;
      }
    } catch (err) {
      const msg = (err as Error).message;
      process.stderr.write(
        `[hackshop-mcp] Anthropic fallback failed: ${msg}\n`,
      );
      if (diagnostics) {
        diagnostics.apiFallbackError = `Anthropic API fallback failed (model "${fallbackModel}"): ${msg}. If the model id was retired, set HACKSHOP_MODEL to a current model.`;
      }
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
