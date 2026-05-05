import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Catalog, type DeviceEntry } from "./types";

let cached: { devices: DeviceEntry[]; tags: Set<string> } | null = null;

function parseTags(markdown: string): Set<string> {
  const tags = new Set<string>();
  const re = /^-\s+`([a-z0-9-]+)`/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    if (match[1]) tags.add(match[1]);
  }
  return tags;
}

export function loadCatalog(): { devices: DeviceEntry[]; tags: Set<string> } {
  if (cached) return cached;

  // Site bundles its own catalog.json + tags.md (synced from repo root via
  // `npm run sync-data`). Vercel functions only have access to files inside
  // the deployed project, so we can't read from ../catalog.json.
  const root = process.cwd();
  const rawCatalog = readFileSync(join(root, "catalog.json"), "utf8");
  const rawTags = readFileSync(join(root, "tags.md"), "utf8");

  const parsed = Catalog.safeParse(JSON.parse(rawCatalog));
  if (!parsed.success) {
    throw new Error(`catalog.json invalid: ${parsed.error.message}`);
  }

  const tags = parseTags(rawTags);
  if (tags.size === 0) {
    throw new Error("tags.md produced zero tags");
  }

  // Tag-drift check matches the parent server's boot validation.
  for (const device of parsed.data) {
    for (const tag of device.idea_fit_tags) {
      if (!tags.has(tag)) {
        throw new Error(
          `Catalog tag drift: device "${device.id}" uses unknown tag "${tag}"`,
        );
      }
    }
  }

  cached = { devices: parsed.data, tags };
  return cached;
}
