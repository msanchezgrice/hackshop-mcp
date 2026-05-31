import { z } from "zod";
import type { DeviceEntry } from "../catalog/schema.js";
import { applyBrickRiskSafety } from "../safety.js";
import { buildLinks, type DeviceLinks } from "../links.js";

export const assessHackabilityInput = z.object({
  device_name: z.string().min(1).max(200),
});

export type AssessInput = z.infer<typeof assessHackabilityInput>;

export interface AssessOutput {
  found: boolean;
  device?: {
    id: string;
    name: string;
    category: string;
    hackable: boolean;
    hack_difficulty: number;
    brick_risk: number | null;
    brick_risk_label: string;
    brick_risk_disclaimer: string | null;
    firmware_links: string[];
    community_size: string;
    last_verified: string;
    notes: string;
    links: DeviceLinks;
  };
  message?: string;
}

// Simple normalization for fuzzy lookup: lowercase, strip non-alnum.
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function assessHackability(
  input: AssessInput,
  catalog: DeviceEntry[],
): AssessOutput {
  const target = norm(input.device_name);

  // Exact match by id, then by normalized name.
  let match: DeviceEntry | undefined = catalog.find((d) => d.id === input.device_name);
  if (!match) match = catalog.find((d) => norm(d.name) === target);

  // Substring match: only the catalog-name-contains-query direction (e.g.
  // "psp" -> "Sony PSP-1000"). The reverse direction (query contains a catalog
  // name) over-matched short names. We collect ALL substring candidates and
  // pick the MOST SPECIFIC one (closest normalized-length to the query) instead
  // of returning the first array match, which was order-dependent.
  if (!match && target.length > 0) {
    const candidates = catalog.filter((d) => norm(d.name).includes(target));
    if (candidates.length === 1) {
      match = candidates[0];
    } else if (candidates.length > 1) {
      // Most-specific = smallest name (tightest fit around the query). Ties
      // resolve deterministically by name then id so results are stable.
      const sorted = [...candidates].sort((a, b) => {
        const la = norm(a.name).length;
        const lb = norm(b.name).length;
        if (la !== lb) return la - lb;
        if (a.name !== b.name) return a.name.localeCompare(b.name);
        return a.id.localeCompare(b.id);
      });
      match = sorted[0];
    }
  }

  if (!match) {
    return {
      found: false,
      message: `"${input.device_name}" is not in the catalog. Cannot assess hackability without verification. Try a more specific name, or check the firmware links section of similar devices.`,
    };
  }

  const safety = applyBrickRiskSafety(match);
  const links = buildLinks(match);

  // Derive hackability from a real signal rather than hardcoding true: a device
  // is "hackable" if it has firmware/community resources OR its difficulty is
  // moderate-or-lower (<=4 of 5). Presence in the catalog alone isn't proof.
  const hackable = match.firmware_links.length > 0 || match.hack_difficulty <= 4;

  return {
    found: true,
    device: {
      id: match.id,
      name: match.name,
      category: match.category,
      hackable,
      hack_difficulty: match.hack_difficulty,
      brick_risk: safety.brick_risk,
      brick_risk_label: safety.brick_risk_label,
      brick_risk_disclaimer: safety.brick_risk_disclaimer,
      firmware_links: match.firmware_links,
      community_size: match.community_size_bucket,
      last_verified: match.last_verified,
      notes: match.notes,
      links,
    },
  };
}
