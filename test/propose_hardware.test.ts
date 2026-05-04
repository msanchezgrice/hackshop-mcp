import { describe, it, expect, vi } from "vitest";
import {
  proposeHardware,
  proposeHardwareInput,
} from "../src/tools/propose_hardware.js";
import type { DeviceEntry } from "../src/catalog/schema.js";

// Minimal mock Server. Only stub what propose_hardware actually calls
// (createMessage). Cast to the tool's expected type at the call site.
function makeMockServer(opts: {
  reply?: string;
  throwOn?: number; // 1 = throw on first call, 2 = throw on both
}): { server: any; calls: number } {
  let calls = 0;
  const server = {
    createMessage: vi.fn(async () => {
      calls++;
      if (opts.throwOn === 1 && calls === 1) throw new Error("rate limited");
      if (opts.throwOn === 2) throw new Error("permanently down");
      return {
        model: "test-model",
        role: "assistant",
        content: { type: "text", text: opts.reply ?? "" },
        stopReason: "endTurn",
      };
    }),
  };
  return { server, get calls() { return calls; } };
}

const fixture: DeviceEntry[] = [
  {
    id: "tidbyt-gen1",
    name: "Tidbyt (Gen 1)",
    category: "display",
    idea_fit_tags: ["display", "ambient", "framed-art"],
    hack_difficulty: 2,
    brick_risk: 2,
    brick_provenance: "community-reported",
    last_verified: "2026-05-04",
    firmware_links: ["https://github.com/tronbyt/server"],
    community_size_bucket: "active",
    notes: "ESP32 LED matrix",
  },
  {
    id: "psp-1000",
    name: "Sony PSP-1000",
    category: "handheld",
    idea_fit_tags: ["retrogaming", "handheld"],
    hack_difficulty: 2,
    brick_risk: 4,
    brick_provenance: "llm-inferred",
    last_verified: "2026-05-04",
    firmware_links: [],
    community_size_bucket: "thriving",
    notes: "Modding scene huge",
  },
  {
    id: "rpi-4b",
    name: "Raspberry Pi 4B",
    category: "sbc",
    idea_fit_tags: ["sbc", "low-power"],
    hack_difficulty: 1,
    brick_risk: 1,
    brick_provenance: "founder-verified",
    last_verified: "2026-05-04",
    firmware_links: [],
    community_size_bucket: "thriving",
    notes: "Default tinkerer choice",
  },
];

describe("propose_hardware input validation", () => {
  it("rejects too-short ideas", () => {
    expect(() => proposeHardwareInput.parse({ idea: "x" })).toThrow();
  });

  it("rejects too-long ideas", () => {
    const long = "x".repeat(2001);
    expect(() => proposeHardwareInput.parse({ idea: long })).toThrow();
  });

  it("accepts a valid idea with optional fields", () => {
    expect(
      proposeHardwareInput.parse({
        idea: "wall-mounted calendar",
        budget_usd: 200,
        constraints: "must be e-paper",
      }),
    ).toBeTruthy();
  });
});

describe("propose_hardware happy path", () => {
  it("returns picks resolved against the catalog", async () => {
    const sampler = makeMockServer({
      reply: JSON.stringify({
        picks: [
          { id: "tidbyt-gen1", why_this_fits: "ambient display fits the kitchen wall idea" },
          { id: "rpi-4b", why_this_fits: "you might want SBC compute behind the display" },
        ],
        rationale: "ambient display + cheap SBC = good baseline.",
      }),
    });

    const out = await proposeHardware(
      { idea: "wall-mounted family calendar" },
      fixture,
      sampler.server as any,
    );

    expect(out.degraded).toBe(false);
    expect(out.proposals).toHaveLength(2);
    expect(out.proposals[0]?.id).toBe("tidbyt-gen1");
    expect(out.proposals[0]?.why_this_fits).toContain("ambient");
    expect(out.proposals[0]?.ebay_query_suggestion).toContain("Tidbyt");
  });

  it("strips picks whose ids aren't in the catalog (defense against sampler hallucination)", async () => {
    const sampler = makeMockServer({
      reply: JSON.stringify({
        picks: [
          { id: "fake-device-id", why_this_fits: "made up" },
          { id: "tidbyt-gen1", why_this_fits: "real" },
        ],
        rationale: "x",
      }),
    });

    const out = await proposeHardware(
      { idea: "wall-mounted family calendar" },
      fixture,
      sampler.server as any,
    );

    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0]?.id).toBe("tidbyt-gen1");
  });

  it("handles markdown-fenced JSON from the sampler", async () => {
    const sampler = makeMockServer({
      reply:
        "```json\n" +
        JSON.stringify({ picks: [{ id: "rpi-4b", why_this_fits: "fits" }], rationale: "x" }) +
        "\n```",
    });

    const out = await proposeHardware(
      { idea: "default tinkerer project" },
      fixture,
      sampler.server as any,
    );

    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0]?.id).toBe("rpi-4b");
  });
});

describe("propose_hardware safety rule integration", () => {
  it("strips brick_risk for handheld + llm-inferred (PSP)", async () => {
    const sampler = makeMockServer({
      reply: JSON.stringify({
        picks: [{ id: "psp-1000", why_this_fits: "modding fits the retro game idea" }],
        rationale: "retrogaming",
      }),
    });

    const out = await proposeHardware(
      { idea: "retro handheld emulator project" },
      fixture,
      sampler.server as any,
    );

    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0]?.brick_risk).toBeNull();
    expect(out.proposals[0]?.brick_risk_label).toContain("unknown");
  });

  it("preserves brick_risk for community-reported display", async () => {
    const sampler = makeMockServer({
      reply: JSON.stringify({
        picks: [{ id: "tidbyt-gen1", why_this_fits: "fits" }],
        rationale: "x",
      }),
    });

    const out = await proposeHardware(
      { idea: "ambient art display" },
      fixture,
      sampler.server as any,
    );

    expect(out.proposals[0]?.brick_risk).toBe(2);
    expect(out.proposals[0]?.brick_risk_disclaimer).toBeNull();
  });
});

describe("propose_hardware degraded paths", () => {
  it("degrades gracefully when sampling fails twice", async () => {
    const sampler = makeMockServer({ throwOn: 2 });

    const out = await proposeHardware(
      { idea: "doesn't matter, sampler is dead" },
      fixture,
      sampler.server as any,
    );

    expect(out.degraded).toBe(true);
    expect(out.proposals.length).toBeGreaterThan(0);
    expect(out.proposals[0]?.why_this_fits).toContain("Reasoning unavailable");
    expect(out.reasoning).toContain("Reasoning unavailable");
  });

  it("retries once on transient failure", async () => {
    const sampler = makeMockServer({
      throwOn: 1,
      reply: JSON.stringify({
        picks: [{ id: "rpi-4b", why_this_fits: "fits after retry" }],
        rationale: "x",
      }),
    });

    const out = await proposeHardware(
      { idea: "retry case" },
      fixture,
      sampler.server as any,
    );

    expect(out.degraded).toBe(false);
    expect(sampler.server.createMessage).toHaveBeenCalledTimes(2);
    expect(out.proposals[0]?.id).toBe("rpi-4b");
  });

  it("degrades when sampler returns malformed JSON", async () => {
    const sampler = makeMockServer({ reply: "this is not JSON at all" });

    const out = await proposeHardware(
      { idea: "malformed test" },
      fixture,
      sampler.server as any,
    );

    expect(out.degraded).toBe(true);
  });

  it("returns a clear message on empty catalog", async () => {
    const sampler = makeMockServer({ reply: "{}" });

    const out = await proposeHardware(
      { idea: "anything" },
      [],
      sampler.server as any,
    );

    expect(out.proposals).toHaveLength(0);
    expect(out.reasoning).toContain("Catalog is empty");
  });
});
