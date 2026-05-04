import { describe, it, expect } from "vitest";
import { applyBrickRiskSafety } from "../src/safety.js";
import type { DeviceEntry } from "../src/catalog/schema.js";

const base: DeviceEntry = {
  id: "test-device",
  name: "Test Device",
  category: "display",
  idea_fit_tags: ["display"],
  hack_difficulty: 3,
  brick_risk: 4,
  brick_provenance: "founder-verified",
  last_verified: "2026-05-04",
  firmware_links: [],
  community_size_bucket: "small",
  notes: "test",
};

describe("brick-risk safety rule (P0)", () => {
  it("founder-verified: keeps score, no disclaimer", () => {
    const out = applyBrickRiskSafety({ ...base, brick_provenance: "founder-verified" });
    expect(out.brick_risk).toBe(4);
    expect(out.brick_risk_disclaimer).toBeNull();
  });

  it("community-reported: keeps score, no disclaimer", () => {
    const out = applyBrickRiskSafety({ ...base, brick_provenance: "community-reported" });
    expect(out.brick_risk).toBe(4);
    expect(out.brick_risk_disclaimer).toBeNull();
  });

  it("llm-inferred + display: keeps score, adds disclaimer", () => {
    const out = applyBrickRiskSafety({ ...base, category: "display", brick_provenance: "llm-inferred" });
    expect(out.brick_risk).toBe(4);
    expect(out.brick_risk_disclaimer).toContain("LLM-inferred");
  });

  it("llm-inferred + handheld: STRIPS score (hard refusal)", () => {
    const out = applyBrickRiskSafety({ ...base, category: "handheld", brick_provenance: "llm-inferred" });
    expect(out.brick_risk).toBeNull();
    expect(out.brick_risk_label).toContain("unknown");
    expect(out.brick_risk_disclaimer).toBeNull();
  });

  it("llm-inferred + sbc: STRIPS score (hard refusal)", () => {
    const out = applyBrickRiskSafety({ ...base, category: "sbc", brick_provenance: "llm-inferred" });
    expect(out.brick_risk).toBeNull();
    expect(out.brick_risk_label).toContain("unknown");
  });

  it("verified + handheld: keeps score (only llm-inferred is restricted)", () => {
    const out = applyBrickRiskSafety({ ...base, category: "handheld", brick_provenance: "founder-verified" });
    expect(out.brick_risk).toBe(4);
    expect(out.brick_risk_disclaimer).toBeNull();
  });
});
