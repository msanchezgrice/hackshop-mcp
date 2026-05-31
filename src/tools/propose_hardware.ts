import { z } from "zod";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { DeviceEntry } from "../catalog/schema.js";
import { applyBrickRiskSafety } from "../safety.js";
import { sampleJson, type SamplingDiagnostics } from "../sampling.js";
import { buildLinks, type DeviceLinks } from "../links.js";

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
  notes: string;
  links: DeviceLinks;
  ebay_query_suggestion: string;
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
- Respect explicit constraints in the idea: if the user says "e-paper preferred", prioritize devices with the "e-ink" tag. If the user says "low power", prioritize "low-power" tagged devices.
- If candidates are weak for the idea, say so in the rationale rather than padding with bad picks.
- Display HATs (Waveshare, Pimoroni Inky) require a host SBC; if you propose one, also propose a Pi Zero W (raspberry-pi-zero-2w) as the driver.`;

// Token-aliasing: user-text terms → catalog tag terms.
// Lets "e-paper" match "e-ink", "tablet" match "display", etc.
const TAG_ALIASES: Record<string, string[]> = {
  "e-paper": ["e-ink"],
  "epaper": ["e-ink"],
  "e ink": ["e-ink"],
  "eink": ["e-ink"],
  "tablet": ["display", "kiosk"],
  "smart bulb": ["bulb", "color-cycle"],
  "lamp": ["bulb"],
  "dashboard": ["kiosk", "display"],
  "calendar": ["display", "kiosk", "framed-art"],
  "art frame": ["framed-art", "ambient", "display"],
  "always-on": ["low-power"],
  "battery": ["low-power"],
  "speaker": ["audio-out"],
  "music": ["audio-out"],
  "mic": ["voice"],
  "microphone": ["voice"],
};

function expandIdeaTerms(idea: string): Set<string> {
  const lower = idea.toLowerCase();
  const tags = new Set<string>();
  for (const [phrase, mapped] of Object.entries(TAG_ALIASES)) {
    if (lower.includes(phrase)) {
      for (const t of mapped) tags.add(t);
    }
  }
  return tags;
}

function candidateContext(catalog: DeviceEntry[]): string {
  return catalog
    .map(
      (d) =>
        `- id: ${d.id} | name: ${d.name} | category: ${d.category} | tags: ${d.idea_fit_tags.join(", ")} | notes: ${d.notes}`,
    )
    .join("\n");
}

// Always pass the full catalog when small (<100 devices). The LLM is the
// real selector; pre-filtering hurts more than it helps once the catalog
// fits in context. Shortlist is only used for the degraded fallback.
export function shortlistCandidates(
  catalog: DeviceEntry[],
  idea: string,
): DeviceEntry[] {
  const lower = idea.toLowerCase();
  const aliasedTags = expandIdeaTerms(idea);
  const tagged = catalog.filter((d) => {
    return d.idea_fit_tags.some(
      (t) => lower.includes(t.replace("-", " ")) || aliasedTags.has(t),
    );
  });
  if (tagged.length === 0) return catalog;
  return tagged;
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

  // Pass the FULL catalog to sampling when small; lets the LLM weigh all
  // options. Shortlist only as the degraded-mode fallback.
  const fullCatalog = catalog.length <= 100 ? catalog : shortlistCandidates(catalog, input.idea);

  const userPrompt = [
    `Project idea: ${input.idea}`,
    input.budget_usd ? `Budget (USD): ${input.budget_usd}` : null,
    input.constraints ? `Constraints: ${input.constraints}` : null,
    "",
    "Candidate hardware:",
    candidateContext(fullCatalog),
  ]
    .filter(Boolean)
    .join("\n");

  const diagnostics: SamplingDiagnostics = {};
  const sampled = await sampleJson<SamplerPick>({
    server,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 1500,
    diagnostics,
  });

  // Degraded path: every reasoning attempt failed (host sampling + retry +
  // optional Anthropic API fallback). Use the alias-aware shortlist as the
  // best available approximation. Honest about the degradation.
  if (!sampled || !Array.isArray(sampled.picks)) {
    const shortlisted = shortlistCandidates(catalog, input.idea);
    const fallback = shortlisted.slice(0, 5).map((d) =>
      buildProposal(d, "Reasoning unavailable; matched against catalog tags only."),
    );
    // If a key WAS present but the API fallback threw (e.g. retired model id),
    // surface that specific reason instead of the misleading "no fallback was
    // configured" message — otherwise the failure is invisible (stderr only).
    const reasoning = diagnostics.apiFallbackError
      ? `Reasoning unavailable. ${diagnostics.apiFallbackError} Returning catalog matches by tag overlap.`
      : "Reasoning unavailable. The host LLM failed and no Anthropic API fallback was configured. Returning catalog matches by tag overlap. Set ANTHROPIC_API_KEY in the MCP server's env config to enable reasoning even on hosts without sampling/createMessage support.";
    return {
      proposals: fallback,
      reasoning,
      degraded: true,
      ...(diagnostics.apiFallbackError
        ? { message: diagnostics.apiFallbackError }
        : {}),
    };
  }

  const proposals: Proposal[] = [];
  for (const pick of sampled.picks.slice(0, 5)) {
    const device = catalog.find((d) => d.id === pick.id);
    if (!device) continue; // sampler hallucinated an id; drop it
    proposals.push(buildProposal(device, pick.why_this_fits));
  }

  if (proposals.length === 0) {
    return {
      proposals: [],
      reasoning: sampled.rationale ?? "No catalog match for this idea.",
      degraded: false,
      message:
        "No catalog devices fit this idea well. Consider expanding the catalog or trying a more concrete description.",
    };
  }

  return {
    proposals,
    reasoning: sampled.rationale ?? "",
    degraded: false,
  };
}

function buildProposal(device: DeviceEntry, whyThisFits: string): Proposal {
  const safety = applyBrickRiskSafety(device);
  const links = buildLinks(device);
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
    notes: device.notes,
    links,
    ebay_query_suggestion: links.ebay_search_url.includes("_nkw=")
      ? decodeURIComponent(links.ebay_search_url.split("_nkw=")[1]?.split("&")[0] ?? "")
      : device.name,
  };
}
