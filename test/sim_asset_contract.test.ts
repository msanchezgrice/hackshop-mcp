import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { generateBuildCandidates } from "../site/lib/build-candidates.js";

interface RegistryEntry {
  asset_version?: string;
  dimensions_m?: [number, number, number];
  mass_kg?: number;
}

interface WorkerRegistry {
  devices: Record<string, RegistryEntry>;
  components?: Record<string, RegistryEntry>;
}

describe("site and worker simulation asset contract", () => {
  it("resolves every generated candidate asset with matching physical properties", () => {
    const registry = JSON.parse(
      readFileSync(
        new URL(
          "../sim-worker/hackshop_sim/assets/registry.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as WorkerRegistry;

    for (const candidate of generateBuildCandidates("patrol the office")) {
      for (const component of candidate.assembly.components) {
        const assetId = component.sim?.asset_id;
        expect(assetId, `${component.device_id} must declare an asset_id`).toBeTruthy();

        const workerAsset =
          registry.devices[assetId!] ?? registry.components?.[assetId!];
        expect(workerAsset, `${assetId} must exist in the worker registry`).toBeDefined();
        expect(
          component.sim?.asset_version,
          `${assetId} must pin an asset version`,
        ).toBeTruthy();
        expect(workerAsset?.asset_version).toBe(component.sim?.asset_version);
        expect(workerAsset?.dimensions_m).toEqual(component.sim?.dimensions_m);
        expect(workerAsset?.mass_kg).toBe(component.sim?.mass_kg);
      }
    }
  });
});
