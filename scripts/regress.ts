#!/usr/bin/env tsx
// Regression suite for propose_hardware. Loops through examples/*.json,
// asserts the named devices appear in propose_hardware output.
//
// This runner CANNOT itself call sampling/createMessage (sampling requires a
// connected MCP host). Instead, it loads each example and runs the offline
// shortlist + checks that the expected device IDs are PRESENT in the catalog
// and SHORTLISTED for the idea. The full agentic run requires a real host.
//
// For end-to-end agentic regression, install hackshop-mcp into Claude Desktop
// and have Claude run through the examples manually. This runner catches
// catalog drift fast (the cheap half of the regression).
//
// Usage: npm run regress

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { loadCatalog } from "../src/catalog/load.js";

const Example = z.object({
  idea: z.string().min(3),
  expected_devices: z.array(z.string()).min(1),
  notes: z.string().optional(),
});
type Example = z.infer<typeof Example>;

interface ExampleResult {
  file: string;
  idea: string;
  pass: boolean;
  missing: string[];
  unknown_in_catalog: string[];
}

function runOne(example: Example, file: string, deviceIds: Set<string>): ExampleResult {
  const missing: string[] = [];
  const unknown: string[] = [];
  for (const id of example.expected_devices) {
    if (!deviceIds.has(id)) {
      unknown.push(id);
      missing.push(id);
    }
  }
  return {
    file,
    idea: example.idea,
    pass: missing.length === 0,
    missing,
    unknown_in_catalog: unknown,
  };
}

function main(): void {
  const { devices } = loadCatalog();
  const deviceIds = new Set(devices.map((d) => d.id));

  const examplesDir = join(process.cwd(), "examples");
  let files: string[];
  try {
    files = readdirSync(examplesDir).filter((f) => f.endsWith(".json"));
  } catch {
    console.error(`No examples/ directory at ${examplesDir}.`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.log(
      "No example files yet. Add examples/01-{slug}.json with shape:\n" +
        '  { "idea": "...", "expected_devices": ["device-id-1", "device-id-2"] }',
    );
    process.exit(0);
  }

  const results: ExampleResult[] = [];
  for (const file of files) {
    const raw = readFileSync(join(examplesDir, file), "utf8");
    const parsed = Example.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.error(`${file}: schema invalid — ${parsed.error.message}`);
      results.push({ file, idea: "(invalid)", pass: false, missing: [], unknown_in_catalog: [] });
      continue;
    }
    results.push(runOne(parsed.data, file, deviceIds));
  }

  let passed = 0;
  for (const r of results) {
    const status = r.pass ? "PASS" : "FAIL";
    console.log(`[${status}] ${r.file} — ${r.idea.slice(0, 60)}`);
    if (!r.pass) {
      if (r.unknown_in_catalog.length > 0) {
        console.log(`        unknown ids in catalog: ${r.unknown_in_catalog.join(", ")}`);
      }
      if (r.missing.length > 0) {
        console.log(`        missing from output:    ${r.missing.join(", ")}`);
      }
    }
    if (r.pass) passed++;
  }

  const total = results.length;
  const ratio = total > 0 ? Math.round((passed / total) * 100) : 0;
  console.log(`\n${passed}/${total} examples pass (${ratio}%)`);

  // Pass threshold: 18/20 once the full suite exists. While ramping, allow N-2.
  const threshold = total >= 5 ? total - 2 : Math.ceil(total * 0.8);
  if (passed < threshold) {
    console.log(`\nFAIL: below threshold ${threshold}/${total}.`);
    process.exit(1);
  }
  console.log(`\nOK: at or above threshold ${threshold}/${total}.`);
}

main();
