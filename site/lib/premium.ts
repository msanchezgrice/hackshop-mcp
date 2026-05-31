import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import {
  PremiumCatalog,
  type PremiumDevice,
  type PremiumProposal,
} from "./premium-types";

let cached: PremiumDevice[] | null = null;

export function loadPremiumCatalog(): PremiumDevice[] {
  if (cached) return cached;
  const root = process.cwd();
  const raw = readFileSync(join(root, "premium-catalog.json"), "utf8");
  const parsed = PremiumCatalog.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`premium-catalog.json invalid: ${parsed.error.message}`);
  }
  cached = parsed.data;
  return cached;
}

const SYSTEM_PROMPT = `You are recommending PREMIUM open-source hardware products for a project idea. These are NEW products (not used eBay finds) that the user buys direct from the manufacturer. They have richer capability sets than the used hardware.

Pick 2-3 premium devices from the candidate list whose capabilities map to the project idea. Reject candidates that don't fit; better to return 1 than to pad with bad picks.

Return JSON only, no markdown, with this shape:
{
  "picks": [
    { "id": "<device id>", "why_this_fits": "<one sentence — name a specific capability that matches>" }
  ],
  "rationale": "<one paragraph>"
}

Rules:
- Pick 0-3 devices. Quality over quantity.
- Only pick from the candidate list. Don't invent.
- "why_this_fits" must mention a SPECIFIC capability or software stack item, not generic praise.
- If none fit, return picks: [] and explain why in rationale.`;

interface SamplerPick {
  picks: Array<{ id: string; why_this_fits: string }>;
  rationale: string;
}

function premiumContext(devices: PremiumDevice[]): string {
  return devices
    .map(
      (d) =>
        `- id: ${d.id} | name: ${d.name} | manufacturer: ${d.manufacturer} | category: ${d.category} | capabilities: ${d.capabilities.join(", ")} | software: ${d.software_stack.join(", ")} | price: $${d.price_usd_min}-${d.price_usd_max} | tags: ${d.idea_fit_tags.join(", ")} | notes: ${d.notes}`,
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

// Cheap heuristic: scan capabilities for camera/mic/radio/motor terms and
// surface a human-readable callout list. Lets the UI show "camera + mic" in
// red without each consumer of PremiumProposal re-implementing the scan.
function deriveRiskCallouts(device: PremiumDevice): string[] {
  const haystack = device.capabilities.join(" ").toLowerCase();
  const flags: string[] = [];
  if (/camera|cam\b/.test(haystack)) flags.push("camera");
  if (/microphone|\bmic\b|mic-array|mic array/.test(haystack)) flags.push("microphone");
  if (/motor|servo|actuator|dof|movement|wheel|propeller/.test(haystack)) flags.push("motors");
  if (/radio|transceiver|sdr|wi-fi|wifi|ble|bluetooth|zigbee/.test(haystack)) flags.push("radio");
  return flags;
}

function buildPremiumProposal(
  device: PremiumDevice,
  whyThisFits: string,
): PremiumProposal {
  const priceRange =
    device.price_usd_min === device.price_usd_max
      ? `$${device.price_usd_min}`
      : `$${device.price_usd_min}-${device.price_usd_max}`;
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
    manufacturer: device.manufacturer,
    category: device.category,
    why_this_fits: whyThisFits,
    capabilities: device.capabilities,
    software_stack: device.software_stack,
    price_range: priceRange,
    vendor_url: device.vendor_url,
    open_source_repo: device.open_source_repo ?? null,
    notes: device.notes,
    actuation_risk: device.actuation_risk,
    privacy_risk: device.privacy_risk,
    risk_callouts: deriveRiskCallouts(device),
    image_url: device.image_url,
    est_setup_label,
  };
}

export async function proposePremium(
  idea: string,
  catalog: PremiumDevice[],
): Promise<PremiumProposal[]> {
  if (catalog.length === 0) return [];

  const userPrompt = [
    `Project idea: ${idea}`,
    "",
    "Premium open-source hardware candidates:",
    premiumContext(catalog),
  ].join("\n");

  const modelId = process.env.HACKSHOP_MODEL ?? "claude-haiku-4-5-20251001";

  // Let a real model/transport failure propagate so the caller can tell a
  // genuine "no good fit" (returns []) apart from "the lookup broke" (throws)
  // and surface the right message. An empty result is an answer; an error is not.
  const result = await generateText({
    model: anthropic(modelId),
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    temperature: 0.4,
  });
  const raw = result.text;

  const sampled = parseLoose<SamplerPick>(raw);
  if (!sampled || !Array.isArray(sampled.picks)) return [];

  const proposals: PremiumProposal[] = [];
  for (const pick of sampled.picks.slice(0, 3)) {
    const device = catalog.find((d) => d.id === pick.id);
    if (!device) continue;
    proposals.push(buildPremiumProposal(device, pick.why_this_fits));
  }
  return proposals;
}
