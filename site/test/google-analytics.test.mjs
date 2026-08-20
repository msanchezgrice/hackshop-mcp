import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Google Analytics configuration", () => {
  it("keeps the canonical fallback and privacy settings", async () => {
    const source = await readFile(
      new URL("../components/GoogleAnalytics.tsx", import.meta.url),
      "utf8",
    );
    const config = await readFile(
      new URL("../lib/googleAnalytics.ts", import.meta.url),
      "utf8",
    );
    expect(config).toMatch(/G-VWF1CCVR6T/);
    expect(source).toMatch(/anonymize_ip:\s*true/);
    expect(source).toMatch(/allow_google_signals:\s*false/);
    expect(source).toMatch(/NEXT_PUBLIC_GA_MEASUREMENT_ID/);
  });
});
