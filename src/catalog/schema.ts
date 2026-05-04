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
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, "id must be lowercase-kebab-case"),
  name: z.string().min(1),
  category: Category,
  idea_fit_tags: z.array(z.string().min(1)).min(1).max(8),
  hack_difficulty: z.number().int().min(1).max(5),
  brick_risk: z.number().int().min(1).max(5),
  brick_provenance: Provenance,
  last_verified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "last_verified must be ISO date YYYY-MM-DD"),
  firmware_links: z.array(z.string().url()).default([]),
  community_size_bucket: CommunitySize,
  notes: z.string().max(500, "notes capped at 500 chars to discourage dumping"),
});

export type DeviceEntry = z.infer<typeof DeviceEntry>;
export type Category = z.infer<typeof Category>;
export type Provenance = z.infer<typeof Provenance>;

export const Catalog = z.array(DeviceEntry).min(1);
export type Catalog = z.infer<typeof Catalog>;

// Categories where bricking is unrecoverable. LLM-inferred brick-risk MUST be
// stripped from output (replaced with "unknown") for these. Hard refusal rule.
export const UNRECOVERABLE_BRICK_CATEGORIES: ReadonlySet<Category> = new Set([
  "handheld",
  "sbc",
]);
