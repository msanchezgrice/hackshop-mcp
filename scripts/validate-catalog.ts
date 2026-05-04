#!/usr/bin/env tsx
// Validate catalog.json + tags.md without booting the full server.
// Run via `npm run validate`. Used in CI / pre-publish.

import { loadCatalog } from "../src/catalog/load.js";

try {
  const { devices, tags } = loadCatalog();
  console.log(
    `OK: ${devices.length} devices, ${tags.size} tags, all schema-valid, no tag drift.`,
  );
  process.exit(0);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
