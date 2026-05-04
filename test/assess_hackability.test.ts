import { describe, it, expect } from "vitest";
import { assessHackability } from "../src/tools/assess_hackability.js";
import type { DeviceEntry } from "../src/catalog/schema.js";

const fixture: DeviceEntry[] = [
  {
    id: "tidbyt-gen1",
    name: "Tidbyt (Gen 1)",
    category: "display",
    idea_fit_tags: ["display"],
    hack_difficulty: 2,
    brick_risk: 2,
    brick_provenance: "community-reported",
    last_verified: "2026-05-04",
    firmware_links: ["https://github.com/tronbyt/server"],
    community_size_bucket: "active",
    notes: "test",
  },
  {
    id: "psp-1000",
    name: "Sony PSP-1000",
    category: "handheld",
    idea_fit_tags: ["retrogaming"],
    hack_difficulty: 2,
    brick_risk: 4,
    brick_provenance: "llm-inferred",
    last_verified: "2026-05-04",
    firmware_links: [],
    community_size_bucket: "thriving",
    notes: "test",
  },
];

describe("assess_hackability", () => {
  it("finds device by exact id", () => {
    const out = assessHackability({ device_name: "tidbyt-gen1" }, fixture);
    expect(out.found).toBe(true);
    expect(out.device?.id).toBe("tidbyt-gen1");
  });

  it("finds device by exact name (with normalization)", () => {
    const out = assessHackability({ device_name: "Tidbyt Gen 1" }, fixture);
    expect(out.found).toBe(true);
    expect(out.device?.id).toBe("tidbyt-gen1");
  });

  it("finds device by substring", () => {
    const out = assessHackability({ device_name: "PSP" }, fixture);
    expect(out.found).toBe(true);
    expect(out.device?.id).toBe("psp-1000");
  });

  it("returns not-found for unknown device with helpful message", () => {
    const out = assessHackability({ device_name: "Nintendo Wii U" }, fixture);
    expect(out.found).toBe(false);
    expect(out.message).toContain("not in the catalog");
  });

  it("applies brick-risk safety rule on output (handheld + llm-inferred)", () => {
    const out = assessHackability({ device_name: "psp-1000" }, fixture);
    expect(out.found).toBe(true);
    expect(out.device?.brick_risk).toBeNull();
    expect(out.device?.brick_risk_label).toContain("unknown");
  });

  it("preserves brick-risk score for verified non-handheld device", () => {
    const out = assessHackability({ device_name: "tidbyt-gen1" }, fixture);
    expect(out.device?.brick_risk).toBe(2);
    expect(out.device?.brick_risk_disclaimer).toBeNull();
  });
});
