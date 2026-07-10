import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../site/lib/catalog.js", () => ({
  loadCatalog: () => ({ devices: [], tags: new Set<string>() }),
}));
vi.mock("../site/lib/premium.js", () => ({
  loadPremiumCatalog: () => [],
}));

describe("simulation-only capability manifests", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("registers the lidar used by the Create 3 candidate", async () => {
    const { loadDeviceDirectory } = await import(
      "../site/lib/capabilities.js"
    );

    const lidar = loadDeviceDirectory().get("rplidar-a1m8");

    expect(lidar).toMatchObject({
      name: "RPLIDAR A1M8 360° LiDAR",
      defaultRole: "sensor",
      capability: {
        interfaces: expect.arrayContaining(["usb", "uart"]),
        interfaces_provenance: "spec",
        power_draw_w: 0.5,
        mass_kg: 0.17,
      },
    });
  });
});
