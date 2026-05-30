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
  // Premium-only risk axes. brick_risk is replaced by these because open-source
  // hardware is rarely "bricked" in the consumer-electronics sense — but it
  // CAN move (motors), see/hear (cameras/mics), or transmit (radios).
  // Both 1-5: 1 = harmless, 5 = real concern, requires user awareness.
  actuation_risk: z.number().int().min(1).max(5),
  privacy_risk: z.number().int().min(1).max(5),
  image_url: z.string().url().optional(),
  est_setup_hours_min: z.number().nonnegative().optional(),
  est_setup_hours_max: z.number().nonnegative().optional(),
  // ── Simulation/feasibility capability fields (V2). All optional. See
  // DeviceEntry for semantics. When `interfaces` is absent the capability
  // index derives transports heuristically from capabilities/software_stack.
  interfaces: z.array(z.string().min(1)).optional(),
  power_draw_w: z.number().nonnegative().optional(),
  power_supply_w: z.number().nonnegative().optional(),
  mass_kg: z.number().positive().optional(),
  payload_kg: z.number().nonnegative().optional(),
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
  actuation_risk: number;
  privacy_risk: number;
  risk_callouts: string[];
  image_url?: string;
  est_setup_label?: string; // "1-2 hr setup"
}
