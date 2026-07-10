import { describe, it, expect } from "vitest";
import { checkFeasibility } from "../site/lib/feasibility.js";
import { Assembly, type DeviceCapability } from "../site/lib/assembly.js";

// Build a valid Assembly (parsed, so defaults/validation apply) for a
// diff-drive navigation robot: a compute hub, a mobile base, and a sensor.
function navAssembly(opts?: {
  transportHubToBase?: string;
  dropChassis?: boolean;
}) {
  const components = [
    { ref: "c1", device_id: "pi5", name: "Pi 5", role: "compute" },
    ...(opts?.dropChassis
      ? []
      : [{ ref: "c2", device_id: "base", name: "Mobile base", role: "chassis" }]),
    { ref: "c3", device_id: "tof", name: "ToF sensor", role: "sensor" },
  ];
  const edges = [
    ...(opts?.dropChassis
      ? []
      : [
          {
            from: "c1",
            to: "c2",
            transport: opts?.transportHubToBase ?? "usb",
          },
        ]),
    { from: "c1", to: "c3", transport: "i2c" },
  ];
  return Assembly.parse({
    idea: "diff-drive nav bot",
    components,
    edges,
    goal: {
      kind: "navigate",
      spec: "reach the goal",
      success_metric: "within 0.3m, zero collisions",
    },
    world: { template: "obstacle-course", goal_xy: [3, 0] },
  });
}

const CAPS: Map<string, DeviceCapability> = new Map([
  [
    "pi5",
    {
      interfaces: ["usb", "i2c", "wifi"],
      interfaces_provenance: "spec",
      power_draw_w: 12,
    },
  ],
  [
    "base",
    {
      interfaces: ["usb", "ros2", "wifi"],
      interfaces_provenance: "spec",
      power_supply_w: 15,
      mass_kg: 3,
      payload_kg: 9,
    },
  ],
  [
    "tof",
    {
      interfaces: ["i2c"],
      interfaces_provenance: "spec",
      power_draw_w: 0.1,
      mass_kg: 0.002,
    },
  ],
]);

describe("feasibility DRC", () => {
  it("passes interfaces + structure + mass for a well-specced nav bot", () => {
    const report = checkFeasibility(navAssembly(), CAPS);
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId.interfaces.status).toBe("pass");
    expect(byId.structural.status).toBe("pass");
    expect(byId["mass-payload"].status).toBe("pass");
    expect(report.verdict).not.toBe("infeasible");
  });

  it("hard-fails on a spec-backed interface mismatch", () => {
    // Hub→base over i2c, but the base only declares usb/ros2/wifi (spec).
    const report = checkFeasibility(
      navAssembly({ transportHubToBase: "i2c" }),
      CAPS,
    );
    const iface = report.checks.find((c) => c.id === "interfaces")!;
    expect(iface.status).toBe("fail");
    expect(iface.provenance).toBe("spec");
    expect(report.verdict).toBe("infeasible");
  });

  it("only warns (never fails) on a derived interface mismatch", () => {
    const derivedCaps = new Map(CAPS);
    derivedCaps.set("base", {
      interfaces: ["usb", "ros2", "wifi"],
      interfaces_provenance: "derived", // inferred from text, not a datasheet
      power_supply_w: 15,
      mass_kg: 3,
      payload_kg: 9,
    });
    const report = checkFeasibility(
      navAssembly({ transportHubToBase: "i2c" }),
      derivedCaps,
    );
    const iface = report.checks.find((c) => c.id === "interfaces")!;
    expect(iface.status).toBe("warn");
    expect(report.verdict).toBe("feasible-with-warnings");
  });

  it("fails structurally when a navigate goal has no chassis", () => {
    const report = checkFeasibility(navAssembly({ dropChassis: true }), CAPS);
    const structural = report.checks.find((c) => c.id === "structural")!;
    expect(structural.status).toBe("fail");
    expect(report.verdict).toBe("infeasible");
  });

  it("recognizes a TurtleBot 4 Lite as an integrated navigation system", () => {
    const turtlebot = Assembly.parse({
      idea: "inspect the office",
      components: [
        {
          ref: "base",
          device_id: "turtlebot-4-lite",
          name: "TurtleBot 4 Lite",
          role: "chassis",
        },
      ],
      edges: [],
      goal: {
        kind: "navigate",
        spec: "reach the inspection point",
        success_metric: "pass the navigation acceptance criteria",
      },
      world: { template: "obstacle-course", goal_xy: [3, 0] },
    });

    const report = checkFeasibility(turtlebot, new Map());
    const structural = report.checks.find((check) => check.id === "structural")!;

    expect(structural.status).toBe("pass");
    expect(structural.detail).toContain("integrated");
    expect(report.verdict).not.toBe("infeasible");
  });

  it("fails the power budget when draw exceeds supply", () => {
    const hungry = new Map(CAPS);
    hungry.set("pi5", {
      interfaces: ["usb", "i2c", "wifi"],
      interfaces_provenance: "spec",
      power_draw_w: 50, // > base's 15 W supply
    });
    const report = checkFeasibility(navAssembly(), hungry);
    const power = report.checks.find((c) => c.id === "power")!;
    expect(power.status).toBe("fail");
    expect(report.verdict).toBe("infeasible");
  });

  it("fails mass/payload when the load exceeds the base rating", () => {
    const heavy = new Map(CAPS);
    heavy.set("tof", {
      interfaces: ["i2c"],
      interfaces_provenance: "spec",
      power_draw_w: 0.1,
      mass_kg: 20, // > base payload of 9 kg
    });
    const report = checkFeasibility(navAssembly(), heavy);
    const mp = report.checks.find((c) => c.id === "mass-payload")!;
    expect(mp.status).toBe("fail");
  });

  it("reports unknown (not a fake pass) when capability data is absent", () => {
    const report = checkFeasibility(navAssembly(), new Map());
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId.power.status).toBe("unknown");
    expect(byId["mass-payload"].status).toBe("unknown");
    expect(byId.interfaces.status).toBe("unknown");
    // Structure is intrinsic to the IR, so it still passes.
    expect(byId.structural.status).toBe("pass");
    expect(report.verdict).not.toBe("infeasible");
  });
});
