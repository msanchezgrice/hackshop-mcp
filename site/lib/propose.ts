import "server-only";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type {
  DeviceEntry,
  Proposal,
  ProposeInput,
  ProposeResponse,
} from "./types";
import { applyBrickRiskSafety } from "./safety";
import { buildLinks, buildEbayQuery } from "./links";
import { fetchEbayLiveData, isEbayConfigured } from "./ebay";

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
- Respect explicit constraints: "e-paper preferred" -> prioritize e-ink tagged devices. "low power" -> prioritize low-power tagged.
- Display HATs (Waveshare, Pimoroni Inky) need a host SBC; pair them with raspberry-pi-zero-2w when proposing.
- If candidates are weak for the idea, say so in the rationale rather than padding.`;

interface SamplerPick {
  picks: Array<{ id: string; why_this_fits: string }>;
  rationale: string;
}

function candidateContext(catalog: DeviceEntry[]): string {
  return catalog
    .map(
      (d) =>
        `- id: ${d.id} | name: ${d.name} | category: ${d.category} | tags: ${d.idea_fit_tags.join(", ")} | notes: ${d.notes}`,
    )
    .join("\n");
}

function parseLoose<T>(text: string): T | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  let candidate = fenced ? fenced[1] : trimmed;
  if (!candidate) return null;
  if (!candidate.trim().startsWith("{") && !candidate.trim().startsWith("[")) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) candidate = candidate.slice(start, end + 1);
  }
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}

function isOpenSourceFromLinks(links: string[]): boolean {
  // Heuristic: any github/gitlab/codeberg repo in firmware_links counts.
  // Manufacturer doc pages alone do not. Used for the "open-source only"
  // filter on the homepage.
  return links.some((u) =>
    /\b(github\.com|gitlab\.com|codeberg\.org|sourceforge\.net)\b/.test(u),
  );
}

function buildProposal(device: DeviceEntry, whyThisFits: string): Proposal {
  const safety = applyBrickRiskSafety(device);
  const links = buildLinks(device);
  const mn = device.est_used_price_usd_min;
  const mx = device.est_used_price_usd_max;
  let est_price_label: string | undefined;
  if (typeof mn === "number" && typeof mx === "number") {
    est_price_label = mn === mx ? `~$${mn}` : `$${mn}-${mx}`;
  }
  const sMn = device.est_setup_hours_min;
  const sMx = device.est_setup_hours_max;
  let est_setup_label: string | undefined;
  if (typeof sMn === "number" && typeof sMx === "number") {
    est_setup_label =
      sMn === sMx ? `~${sMn}h setup` : `${sMn}-${sMx}h setup`;
  }
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
    est_price_label,
    est_setup_label,
    image_url: device.image_url,
    is_open_source: isOpenSourceFromLinks(device.firmware_links),
  };
}

export async function propose(
  input: ProposeInput,
  catalog: DeviceEntry[],
): Promise<ProposeResponse> {
  if (catalog.length === 0) {
    return {
      proposals: [],
      reasoning: "Catalog is empty.",
      degraded: true,
    };
  }

  // Open-source filter: keep only entries with a GitHub-class repo in
  // firmware_links. Cheap derived check, applied before the LLM sees them.
  const filtered = input.open_source_only
    ? catalog.filter((d) =>
        d.firmware_links.some((u) =>
          /\b(github\.com|gitlab\.com|codeberg\.org|sourceforge\.net)\b/.test(u),
        ),
      )
    : catalog;

  const inventoryDevices = input.inventory_ids
    ? catalog.filter((d) => input.inventory_ids!.includes(d.id))
    : [];

  const userPrompt = [
    `Project idea: ${input.idea}`,
    input.budget_usd ? `Budget (USD): ${input.budget_usd}` : null,
    input.constraints ? `Constraints: ${input.constraints}` : null,
    inventoryDevices.length > 0
      ? `\nUser already owns: ${inventoryDevices.map((d) => d.name).join(", ")}. Prioritize ideas they can build with what they have. If the project genuinely benefits from something they don't own, propose it but flag it as something they'd need to add.`
      : null,
    "",
    "Candidate hardware:",
    candidateContext(filtered),
  ]
    .filter(Boolean)
    .join("\n");

  const modelId = process.env.HACKSHOP_MODEL ?? "claude-haiku-4-5-20251001";

  let raw: string;
  try {
    const result = await generateText({
      model: anthropic(modelId),
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0.5,
    });
    raw = result.text;
  } catch (err) {
    return {
      proposals: [],
      reasoning: `Anthropic API call failed: ${(err as Error).message}`,
      degraded: true,
    };
  }

  const sampled = parseLoose<SamplerPick>(raw);
  if (!sampled || !Array.isArray(sampled.picks)) {
    return {
      proposals: [],
      reasoning:
        "Model returned an unparseable response. Try refining the idea description.",
      degraded: true,
    };
  }

  const proposals: Proposal[] = [];
  for (const pick of sampled.picks.slice(0, 5)) {
    const device = catalog.find((d) => d.id === pick.id);
    if (!device) continue;
    proposals.push(buildProposal(device, pick.why_this_fits));
  }

  // Live eBay enrichment when credentials are set. Parallel fetches (~200-500ms
  // each but they run together). Fail-soft: any error leaves ebay_live=null and
  // the URL fallback still works.
  if (isEbayConfigured() && proposals.length > 0) {
    const liveData = await Promise.all(
      proposals.map((p) => {
        const device = catalog.find((d) => d.id === p.id);
        if (!device) return Promise.resolve(null);
        return fetchEbayLiveData(buildEbayQuery(device));
      }),
    );
    for (let i = 0; i < proposals.length; i++) {
      const proposal = proposals[i];
      if (proposal) proposal.ebay_live = liveData[i] ?? null;
    }
    // Drop proposals with zero live listings — they make the demo look broken.
    // Keep at least 2 proposals though, so a slow eBay day doesn't return empty.
    const withListings = proposals.filter(
      (p) => !p.ebay_live || p.ebay_live.count > 0,
    );
    if (withListings.length >= 2) {
      proposals.length = 0;
      proposals.push(...withListings);
    }
  }

  if (proposals.length === 0) {
    return {
      proposals: [],
      reasoning: sampled.rationale ?? "No catalog match for this idea.",
      degraded: false,
      message:
        "No catalog devices fit this idea well. Try a more concrete description, or open a catalog PR.",
    };
  }

  return {
    proposals,
    reasoning: sampled.rationale ?? "",
    degraded: false,
  };
}
