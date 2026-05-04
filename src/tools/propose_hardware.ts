import { z } from "zod";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { DeviceEntry } from "../catalog/schema.js";
import { applyBrickRiskSafety } from "../safety.js";
import { sampleJson } from "../sampling.js";

export const proposeHardwareInput = z.object({
  idea: z.string().min(3, "idea is too short").max(2000, "idea is too long"),
  budget_usd: z.number().positive().max(100000).optional(),
  constraints: z.string().max(500).optional(),
});

export type ProposeInput = z.infer<typeof proposeHardwareInput>;

export interface Proposal {
  id: string;
  name: string;
  category: string;
  why_this_fits: string;
  hack_difficulty: number;
  brick_risk: number | null;
  brick_risk_label: string;
  brick_risk_disclaimer: string | null;
  firmware_links: string[];
  community_size: string;
  ebay_query_suggestion: string;
  notes: string;
}

export interface ProposeOutput {
  proposals: Proposal[];
  reasoning: string;
  degraded: boolean;
  message?: string;
}

interface SamplerPick {
  picks: Array<{ id: string; why_this_fits: string }>;
  rationale: string;
}

const SYSTEM_PROMPT = `You are a hardware-literate AI scout for tinkerers. The user gives you a project idea (often vague). You pick 3-5 hardware items from the candidate list that creatively fit the idea. Surface options the user wouldn't have thought of. Avoid recommending the obvious choice (Raspberry Pi) unless the idea genuinely calls for it.

Return JSON only, no markdown, with this shape:
{
  "picks": [
    { "id": "<device id from candidate list>", "why_this_fits": "<one sentence, concrete>" }
  ],
  "rationale": "<one paragraph on the overall theme of your picks>"
}

Rules:
- Pick 3-5 devices. Never more than 5.
- Only pick from the candidate list provided. Do not invent devices.
- "why_this_fits" must mention the user's idea explicitly. No generic praise.
- If candidates are weak for the idea, say so in the rationale rather than padding with bad picks.`;

function buildEbayQuery(device: DeviceEntry, idea: string): string {
  // Suggest an eBay search query the user can pass to ebay-mcp at the host.
  // Avoid LLM model names; use the device's marketing name.
  const cond = device.brick_risk >= 4 ? "working" : "used";
  return `${device.name} ${cond}`;
}

function candidateContext(catalog: DeviceEntry[]): string {
  return catalog
    .map(
      (d) =>
        `- id: ${d.id} | name: ${d.name} | category: ${d.category} | tags: ${d.idea_fit_tags.join(", ")} | notes: ${d.notes}`,
    )
    .join("\n");
}

function shortlistCandidates(
  catalog: DeviceEntry[],
  idea: string,
): DeviceEntry[] {
  // Naive prefilter: if the idea text mentions any tag substring, prefer those.
  // Otherwise return the full catalog (LLM does the real picking).
  const lower = idea.toLowerCase();
  const tagged = catalog.filter((d) =>
    d.idea_fit_tags.some((t) => lower.includes(t.replace("-", " "))),
  );
  if (tagged.length >= 5) return tagged;
  return catalog;
}

export async function proposeHardware(
  input: ProposeInput,
  catalog: DeviceEntry[],
  server: Server,
): Promise<ProposeOutput> {
  if (catalog.length === 0) {
    return {
      proposals: [],
      reasoning: "Catalog is empty. Cannot propose hardware.",
      degraded: true,
    };
  }

  const candidates = shortlistCandidates(catalog, input.idea);

  const userPrompt = [
    `Project idea: ${input.idea}`,
    input.budget_usd ? `Budget (USD): ${input.budget_usd}` : null,
    input.constraints ? `Constraints: ${input.constraints}` : null,
    "",
    "Candidate hardware:",
    candidateContext(candidates),
  ]
    .filter(Boolean)
    .join("\n");

  const sampled = await sampleJson<SamplerPick>({
    server,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 1500,
  });

  // Degraded path: sampling failed twice. Return raw shortlist matches with a
  // clear "reasoning unavailable" note. No hallucination, no crash.
  if (!sampled || !Array.isArray(sampled.picks)) {
    const fallback = candidates.slice(0, 3).map((d) => buildProposal(d, input.idea, "Reasoning unavailable; raw catalog match."));
    return {
      proposals: fallback,
      reasoning: "Reasoning unavailable. The host LLM failed twice. Returning raw catalog matches; verify hackability against the linked communities.",
      degraded: true,
    };
  }

  const proposals: Proposal[] = [];
  for (const pick of sampled.picks.slice(0, 5)) {
    const device = catalog.find((d) => d.id === pick.id);
    if (!device) continue; // sampler hallucinated an id; drop it
    proposals.push(buildProposal(device, input.idea, pick.why_this_fits));
  }

  if (proposals.length === 0) {
    return {
      proposals: [],
      reasoning: sampled.rationale ?? "No catalog match for this idea.",
      degraded: false,
      message: "No catalog devices fit this idea well. Consider expanding the catalog or trying a more concrete description.",
    };
  }

  return {
    proposals,
    reasoning: sampled.rationale ?? "",
    degraded: false,
  };
}

function buildProposal(
  device: DeviceEntry,
  idea: string,
  whyThisFits: string,
): Proposal {
  const safety = applyBrickRiskSafety(device);
  return {
    id: device.id,
    name: device.name,
    category: device.category,
    why_this_fits: whyThisFits,
    hack_difficulty: device.hack_difficulty,
    brick_risk: safety.brick_risk,
    brick_risk_label: safety.brick_risk_label,
    brick_risk_disclaimer: safety.brick_risk_disclaimer,
    firmware_links: device.firmware_links,
    community_size: device.community_size_bucket,
    ebay_query_suggestion: buildEbayQuery(device, idea),
    notes: device.notes,
  };
}
