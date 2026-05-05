import { z } from "zod";

export const Category = z.enum([
  "display",
  "speaker",
  "input",
  "sensor",
  "bulb",
  "sbc",
  "handheld",
  "mini-pc",
  "wearable",
  "router",
  "other",
]);

export const Provenance = z.enum([
  "founder-verified",
  "community-reported",
  "llm-inferred",
]);

export const CommunitySize = z.enum(["tiny", "small", "active", "thriving"]);

export const DeviceEntry = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: Category,
  idea_fit_tags: z.array(z.string().min(1)).min(1).max(8),
  hack_difficulty: z.number().int().min(1).max(5),
  brick_risk: z.number().int().min(1).max(5),
  brick_provenance: Provenance,
  last_verified: z.string(),
  firmware_links: z.array(z.string().url()).default([]),
  community_size_bucket: CommunitySize,
  notes: z.string().max(500),
  est_used_price_usd_min: z.number().int().nonnegative().optional(),
  est_used_price_usd_max: z.number().int().nonnegative().optional(),
  // Best-effort hotlink to a manufacturer / Wikipedia / GitHub product image.
  // UI shows a neutral placeholder when missing. Optional because many older
  // entries don't have a stable canonical URL.
  image_url: z.string().url().optional(),
  // Realistic time to a working build for a tinkerer (first time). Includes
  // assembly + firmware flash + software config. Conservative.
  est_setup_hours_min: z.number().nonnegative().optional(),
  est_setup_hours_max: z.number().nonnegative().optional(),
});

export type DeviceEntry = z.infer<typeof DeviceEntry>;
export type Category = z.infer<typeof Category>;
export type Provenance = z.infer<typeof Provenance>;

export const Catalog = z.array(DeviceEntry);
export type Catalog = z.infer<typeof Catalog>;

export const UNRECOVERABLE_BRICK_CATEGORIES: ReadonlySet<Category> = new Set([
  "handheld",
  "sbc",
]);

export const proposeInput = z.object({
  idea: z.string().min(3, "idea is too short").max(2000, "idea is too long"),
  budget_usd: z.number().positive().max(100000).optional(),
  constraints: z.string().max(500).optional(),
  include_premium: z.boolean().optional(),
  // Filter: only propose devices with open-source firmware/software
  // (any github/gitlab/codeberg link in firmware_links).
  open_source_only: z.boolean().optional(),
  // Inventory: device IDs the user already owns. When set, the agent
  // ranks ideas they can build with what they have first.
  inventory_ids: z.array(z.string()).max(50).optional(),
});

export type ProposeInput = z.infer<typeof proposeInput>;

export interface DeviceLinks {
  ebay_search_url: string;
  hackaday_search_url: string;
  reddit_search_url: string;
  google_search_url: string;
}

export interface EbayLive {
  count: number;
  min_price_usd: number | null;
  currency: string | null;
  sample_url: string | null;
}

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
  ebay_live?: EbayLive | null;
  est_price_label?: string;
  est_setup_label?: string; // e.g. "1-2 hr setup" or "~4 hr setup"
  image_url?: string;
  is_open_source: boolean; // derived from firmware_links: any github/gitlab repo counts
}

import type { PremiumProposal } from "./premium-types";

export type { PremiumProposal };

export interface ProposeResponse {
  proposals: Proposal[];
  reasoning: string;
  degraded: boolean;
  message?: string;
  premium_proposals?: PremiumProposal[]; // present only when include_premium was true
}
