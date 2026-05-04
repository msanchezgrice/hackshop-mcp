import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

// Wraps sampling/createMessage with retry-once + degraded-response semantics.
// Returns either parsed JSON of shape T, or null if the host failed twice.
//
// The MCP server NEVER bundles an Anthropic/OpenAI SDK. All reasoning is
// delegated to the host's LLM via this protocol. Cost: must verify host
// support via boot probe (see scripts/smoke.ts and src/server.ts boot path).
export async function sampleJson<T>(opts: {
  server: Server;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}): Promise<T | null> {
  const { server, systemPrompt, userPrompt, maxTokens = 1024 } = opts;

  const tryOnce = async (): Promise<T | null> => {
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
          // hint to the host: prefer a fast model; reasoning is light here.
          intelligencePriority: 0.6,
          speedPriority: 0.4,
        },
      });

      const content = response.content;
      if (content.type !== "text") return null;
      const text = content.text.trim();

      // Strip a possible markdown code fence around the JSON.
      const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      const jsonText = fenced ? fenced[1] : text;
      if (!jsonText) return null;

      return JSON.parse(jsonText) as T;
    } catch {
      return null;
    }
  };

  const first = await tryOnce();
  if (first !== null) return first;

  // One retry on transient failure.
  const second = await tryOnce();
  return second;
}

// Boot-time probe to verify the host actually supports sampling/createMessage.
// Returns true if the host responded; false if it errored or returned nothing.
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
