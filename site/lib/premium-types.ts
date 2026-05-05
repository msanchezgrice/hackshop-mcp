import { z } from "zod";

// PremiumDevice is a NEW open-source hardware product the user buys direct
// (not a used-on-eBay device). Different shape from DeviceEntry because:
//   - No brick_risk concept (open-source by design, recoverable)
//   - Capabilities array (sensors, motors, screens, mics) — semantic search
//   - software_stack (SDKs, frameworks, integrations)
//   - vendor_url (where you buy new) + open_source_repo (the design files)
//   - Price RANGE because kits/lite/full versions exist at multiple tiers
//
// These show up in propose results ONLY when the user opts in via the
// `include_premium` flag. Default behavior (used hardware) is unchanged.

export const PremiumCategory = z.enum([
  "robot",
  "drone",
  "sbc",
  "wearable",
  "display",
  "audio",
  "sensor",
  "tool",
  "computer",
]);

export const PremiumDevice = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  manufacturer: z.string().min(1),
  category: PremiumCategory,
  capabilities: z.array(z.string().min(1)).min(1),
  software_stack: z.array(z.string().min(1)).min(1),
  price_usd_min: z.number().int().positive(),
  price_usd_max: z.number().int().positive(),
  vendor_url: z.string().url(),
  open_source_repo: z.string().url().optional(),
  idea_fit_tags: z.array(z.string().min(1)).min(1).max(8),
  notes: z.string().max(500),
});

export type PremiumDevice = z.infer<typeof PremiumDevice>;
export type PremiumCategory = z.infer<typeof PremiumCategory>;

export const PremiumCatalog = z.array(PremiumDevice);
export type PremiumCatalog = z.infer<typeof PremiumCatalog>;

export interface PremiumProposal {
  id: string;
  name: string;
  manufacturer: string;
  category: string;
  why_this_fits: string;
  capabilities: string[];
  software_stack: string[];
  price_range: string;
  vendor_url: string;
  open_source_repo: string | null;
  notes: string;
}
