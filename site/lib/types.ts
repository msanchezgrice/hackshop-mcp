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
});

export type ProposeInput = z.infer<typeof proposeInput>;

export interface DeviceLinks {
  ebay_search_url: string;
  hackaday_search_url: string;
  reddit_search_url: string;
  google_search_url: string;
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
}

export interface ProposeResponse {
  proposals: Proposal[];
  reasoning: string;
  degraded: boolean;
  message?: string;
}
