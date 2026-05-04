import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Catalog, type DeviceEntry } from "./schema.js";

// Resolve repo root relative to this file: dist/catalog/load.js -> ../../
const repoRoot = (): string => {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..");
};

export interface LoadResult {
  devices: DeviceEntry[];
  tags: Set<string>;
}

// Parse tags.md and extract the closed-set tag vocabulary.
// Tags are markdown bullets like "- `tag-name` — description"
export function parseTags(markdown: string): Set<string> {
  const tags = new Set<string>();
  const re = /^-\s+`([a-z0-9-]+)`/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    if (match[1]) tags.add(match[1]);
  }
  return tags;
}

export function loadCatalog(): LoadResult {
  const root = repoRoot();
  const catalogPath = join(root, "catalog.json");
  const tagsPath = join(root, "tags.md");

  const rawCatalog = readFileSync(catalogPath, "utf8");
  const rawTags = readFileSync(tagsPath, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawCatalog);
  } catch (e) {
    throw new Error(
      `catalog.json is not valid JSON: ${(e as Error).message}\n` +
        `Path: ${catalogPath}`,
    );
  }

  const result = Catalog.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `catalog.json failed schema validation:\n${issues}\n` +
        `Path: ${catalogPath}`,
    );
  }

  const devices = result.data;
  const tags = parseTags(rawTags);

  if (tags.size === 0) {
    throw new Error(
      `tags.md produced zero tags. Check the markdown format.\nPath: ${tagsPath}`,
    );
  }

  // Validate every catalog tag is in tags.md (hard fail, no warnings).
  const violations: string[] = [];
  for (const device of devices) {
    for (const tag of device.idea_fit_tags) {
      if (!tags.has(tag)) {
        violations.push(`  - device "${device.id}" uses unknown tag "${tag}"`);
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `Tag drift detected. Catalog uses tags not declared in tags.md:\n` +
        violations.join("\n") +
        `\n\nFix: add the tag to tags.md, or correct the catalog entry.`,
    );
  }

  // Validate device id uniqueness.
  const seen = new Set<string>();
  for (const device of devices) {
    if (seen.has(device.id)) {
      throw new Error(`Duplicate device id in catalog: "${device.id}"`);
    }
    seen.add(device.id);
  }

  return { devices, tags };
}
