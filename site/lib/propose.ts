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

Return JSON only (no surrounding fence), with this shape:
{
  "picks": [
    { "id": "<device id>", "why_this_fits": "<one tight sentence, mentions user's idea>" }
  ],
  "rationale_md": "<MARKDOWN — short, bullet-list, see rules below>",
  "next_steps_md": "<MARKDOWN — bulleted concrete actions>",
  "software_guide_md": "<MARKDOWN — operational architecture, see rules below>"
}

FORMATTING — rationale_md and next_steps_md:
- Use markdown. Encouraged: bullet lists ('- '), bold (**word**), inline code (\`token\`), short headers ('## Heading').
- rationale_md: lead with **one bold one-liner** summarizing the recommended path. Then a 3-5 bullet list of reasons / tradeoffs / constraints. Keep under 8 lines.
- next_steps_md: 3-5 bulleted concrete actions, each starting with a verb ("Order...", "Flash...", "Wire..."), each one short sentence.

FORMATTING — software_guide_md (NEW, operational architecture):
- This is the deeper "how does the system actually work" section, ~12-20 lines.
- Use this exact structure with these four headers, in order:
  ## Interface
  How does the user actually interact with this? (web UI on port 8080? REST API? Native mobile app? SSH terminal? Bluetooth pairing via a phone app? ROS topic publish? Voice command via Home Assistant?). Name the specific port / endpoint / app where applicable. 2-4 lines.
  ## Deploy
  Where does the software run, how is it powered, what does it depend on? (e.g. "Pi Zero W boots from microSD running Raspberry Pi OS Lite, draws ~1.5W from a 5V/2A USB power supply, requires only Wi-Fi for outbound HTTPS to Google Calendar; LAN-only otherwise"). Mention firmware / OS specifically. 2-4 lines.
  ## Maintain
  What breaks, how often, what to expect. Cover firmware update cadence, common failure modes, what's recoverable. (e.g. "Firmware updates rare; main breakage is the Wi-Fi credential expiry — re-flash the SD card in 5 min if it fails"). 2-4 lines.
  ## Always-on?
  Is this device always running, event-triggered, or manually launched? Battery vs mains, wake/sleep behavior, idle power draw, expected uptime between restarts. (e.g. "Always-on, plugged in 24/7. Pi Zero idle draw ~0.4W; e-paper refreshes once an hour via cron"). 1-3 lines.

GENERAL FORMATTING:
- Reference real project names (MagInkCal, Luma3DS, openmiko, Rebble, KOReader, Tronbyt, ESPHome, Home Assistant, Frigate, ntfy.sh, Mosquitto, etc.). The frontend renders these so users can recognize.
- Inline-code (\`backticks\`) for commands, ports, file paths, config keys.
- Do NOT invent URLs you're unsure about; project names alone are enough.

GENERAL:
- Pick 3-5 devices, never more than 5.
- Only pick from the candidate list. Do not invent devices.
- "why_this_fits" must mention the user's idea explicitly.
- Respect constraints: "e-paper preferred" -> prioritize e-ink tag; "low power" -> prioritize low-power tag.
- Display HATs (Waveshare, Pimoroni Inky) need a host SBC; pair with raspberry-pi-zero-2w.
- If candidates are weak, say so in rationale_md rather than padding.`;

interface SamplerPick {
  picks: Array<{ id: string; why_this_fits: string }>;
  rationale_md: string;
  next_steps_md: string;
  software_guide_md?: string;
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

  // Backward-compatible plain-text reasoning derived from the markdown so any
  // legacy consumer that reads `reasoning` still works. The new fields
  // rationale_md / next_steps_md carry the structured output.
  const stripMd = (md: string): string =>
    md
      .replace(/^#+\s+/gm, "")
      .replace(/\*\*/g, "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^[-*]\s+/gm, "• ")
      .trim();

  const rationale_md = sampled.rationale_md ?? "";
  const next_steps_md = sampled.next_steps_md ?? "";
  const software_guide_md = sampled.software_guide_md ?? "";
  const reasoning = stripMd(rationale_md) || "No catalog match for this idea.";

  if (proposals.length === 0) {
    return {
      proposals: [],
      reasoning,
      rationale_md,
      next_steps_md,
      software_guide_md,
      degraded: false,
      message:
        "No catalog devices fit this idea well. Try a more concrete description, or open a catalog PR.",
    };
  }

  return {
    proposals,
    reasoning,
    rationale_md,
    next_steps_md,
    software_guide_md,
    degraded: false,
  };
}
