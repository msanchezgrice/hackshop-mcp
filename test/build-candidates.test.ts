import { describe, expect, it, vi } from "vitest";
import {
  AssemblyGoal,
  BuildCandidate,
  SimHandle,
} from "../site/lib/assembly.js";
import { generateBuildCandidates } from "../site/lib/build-candidates.js";

vi.mock("server-only", () => ({}));
vi.mock("../site/lib/catalog.js", () => ({
  loadCatalog: () => ({ devices: [], tags: new Set<string>() }),
}));
vi.mock("../site/lib/capabilities.js", () => ({
  loadDeviceDirectory: () =>
    new Map([
      [
        "irobot-create-3",
        {
          id: "irobot-create-3",
          name: "iRobot Create 3",
          category: "robot",
          source: "premium",
          defaultRole: "chassis",
          capability: {
            interfaces: ["wifi", "usb", "power"],
            interfaces_provenance: "spec",
            mass_kg: 3,
            payload_kg: 9,
          },
        },
      ],
      [
        "raspberry-pi-5",
        {
          id: "raspberry-pi-5",
          name: "Raspberry Pi 5",
          category: "sbc",
          source: "premium",
          defaultRole: "compute",
          capability: {
            interfaces: ["wifi", "usb", "i2c"],
            interfaces_provenance: "spec",
            mass_kg: 0.045,
          },
        },
      ],
      [
        "adafruit-vl53l4cd",
        {
          id: "adafruit-vl53l4cd",
          name: "Adafruit VL53L4CD Time of Flight Distance Sensor",
          category: "sensor",
          source: "premium",
          defaultRole: "sensor",
          capability: {
            interfaces: ["i2c"],
            interfaces_provenance: "spec",
            mass_kg: 0.002,
          },
        },
      ],
    ]),
}));

describe("build candidate generation", () => {
  it("keeps chassis alternatives as separate complete builds", () => {
    const candidates = generateBuildCandidates("map a cluttered room", [
      "irobot-create-3",
      "turtlebot-4-lite",
    ]);

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.chassis_device_id)).toEqual([
      "irobot-create-3",
      "turtlebot-4-lite",
    ]);

    for (const candidate of candidates) {
      expect(BuildCandidate.parse(candidate)).toEqual(candidate);
      expect(candidate.device_ids).toEqual(
        candidate.assembly.components.map((component) => component.device_id),
      );
      expect(
        candidate.assembly.components.filter(
          (component) => component.role === "chassis",
        ),
      ).toHaveLength(1);
    }

    expect(candidates[0].device_ids).not.toContain("turtlebot-4-lite");
    expect(candidates[1].device_ids).not.toContain("irobot-create-3");
  });

  it("matches each product BOM to the perception model it actually contains", () => {
    const candidates = generateBuildCandidates("avoid nearby obstacles");

    expect(candidates).toHaveLength(2);
    const create = candidates.find(
      (candidate) => candidate.chassis_device_id === "irobot-create-3",
    )!;
    const turtlebot = candidates.find(
      (candidate) => candidate.chassis_device_id === "turtlebot-4-lite",
    )!;

    expect(create.device_ids).toEqual([
      "irobot-create-3",
      "raspberry-pi-5",
      "rplidar-a1m8",
    ]);
    expect(create.assembly.components.map((component) => component.role)).toEqual([
      "chassis",
      "compute",
      "sensor",
    ]);
    expect(create.assembly.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "base",
          to: "compute",
          transport: "power",
        }),
        expect.objectContaining({
          from: "compute",
          to: "lidar",
          transport: "usb",
        }),
      ]),
    );

    // TurtleBot 4 Lite is already an integrated Pi + OAK-D + RPLIDAR product;
    // those parts must be described, not added to the purchasable BOM again.
    expect(turtlebot.device_ids).toEqual(["turtlebot-4-lite"]);
    expect(turtlebot.included_hardware).toEqual([
      "Raspberry Pi 4B (4 GB)",
      "OAK-D-Lite stereo camera",
      "RPLIDAR A1M8 360° LiDAR",
    ]);
    expect(turtlebot.observation_model).toBe("2d-lidar");

    for (const component of candidates.flatMap(
      (candidate) => candidate.assembly.components,
    )) {
      expect(SimHandle.parse(component.sim)).toEqual(component.sim);
      expect(component.sim?.asset_id).toBe(component.device_id);
      expect(component.sim?.dimensions_m).toHaveLength(3);
      expect(component.sim?.mass_kg).toBeGreaterThan(0);
      expect(component.sim?.fidelity).toBe("dimensioned-proxy");
    }

    expect(
      candidates.flatMap((candidate) => candidate.device_ids),
    ).not.toContain("adafruit-vl53l4cd");
  });

  it("uses the canonical TurtleBot catalog id throughout the candidate", () => {
    const [candidate] = generateBuildCandidates("navigate autonomously", [
      "turtlebot-4-lite",
    ]);

    expect(candidate.chassis_device_id).toBe("turtlebot-4-lite");
    expect(candidate.id).toContain("turtlebot-4-lite");
    expect(candidate.device_ids).toContain("turtlebot-4-lite");
    expect(candidate.device_ids).not.toContain("turtlebot4");
    expect(
      candidate.assembly.components.find(
        (component) => component.role === "chassis",
      )?.sim?.asset_id,
    ).toBe("turtlebot-4-lite");
    expect(
      candidate.assembly.components.find(
        (component) => component.role === "chassis",
      )?.sim,
    ).toMatchObject({
      dimensions_m: [0.341, 0.339, 0.192],
      mass_kg: 3.3,
    });
  });

  it("emits typed navigation criteria while accepting legacy metrics", () => {
    const [candidate] = generateBuildCandidates("reach the marker", [
      "irobot-create-3",
    ]);

    expect(candidate.assembly.goal).toMatchObject({
      kind: "navigate",
      criteria: {
        position_tolerance_m: 0.3,
        dwell_s: 2,
        max_collision_events: 0,
        require_upright: true,
      },
    });

    expect(
      AssemblyGoal.safeParse({
        kind: "navigate",
        spec: "Reach the marker.",
        success_metric: "Within 0.3 m for two seconds.",
      }).success,
    ).toBe(true);

    expect(
      AssemblyGoal.safeParse({
        kind: "navigate",
        spec: "Reach the marker.",
        success_metric: "Use an absurdly large tolerance.",
        criteria: {
          position_tolerance_m: 100,
          dwell_s: 0,
          max_collision_events: 0,
          require_upright: true,
        },
      }).success,
    ).toBe(false);
  });

  it("filters unsupported preferred devices instead of merging them", () => {
    expect(
      generateBuildCandidates("show sensor readings", [
        "raspberry-pi-5",
        "adafruit-vl53l4cd",
      ]),
    ).toEqual([]);
  });

  it("labels premium costs and filters concepts that cannot fit the request budget", () => {
    const all = generateBuildCandidates("deliver packages");
    expect(all.map((candidate) => candidate.estimated_price_usd)).toEqual([
      { min: 380, max: 540 },
      { min: 1100, max: 1400 },
    ]);
    expect(all.every((candidate) => candidate.purchase_tier === "premium")).toBe(
      true,
    );

    expect(
      generateBuildCandidates("deliver packages", undefined, 600).map(
        (candidate) => candidate.chassis_device_id,
      ),
    ).toEqual(["irobot-create-3"]);
    expect(generateBuildCandidates("deliver packages", undefined, 300)).toEqual(
      [],
    );
  });
});

describe("assembly generator candidate contract", () => {
  it("hydrates typed criteria and assets on the deterministic fallback", async () => {
    const { generateAssembly } = await import("../site/lib/assembly-gen.js");

    const result = await generateAssembly("patrol the office", [
      "irobot-create-3",
      "raspberry-pi-5",
      "adafruit-vl53l4cd",
    ], {
      generateText: async () => {
        throw new Error("model unavailable");
      },
    });

    expect(result.degraded).toBe(true);
    expect(result.assembly.goal.criteria).toEqual({
      position_tolerance_m: 0.3,
      dwell_s: 2,
      max_collision_events: 0,
      require_upright: true,
    });
    expect(
      result.assembly.components.map((component) => component.sim?.asset_id),
    ).toEqual([
      "irobot-create-3",
      "raspberry-pi-5",
      "adafruit-vl53l4cd",
    ]);
  });

  it("preserves model-authored typed criteria and hydrates assets on the LLM path", async () => {
    const text = JSON.stringify({
        roles: [
          { ref: "c1", role: "chassis" },
          { ref: "c2", role: "compute" },
          { ref: "c3", role: "sensor" },
        ],
        edges: [
          { from: "c2", to: "c1", transport: "wifi" },
          { from: "c2", to: "c3", transport: "i2c" },
        ],
        goal: {
          kind: "navigate",
          spec: "Reach the inspection marker.",
          success_metric: "Within 0.2 m for 3 s with at most one collision.",
          criteria: {
            position_tolerance_m: 0.2,
            dwell_s: 3,
            max_collision_events: 1,
            require_upright: true,
          },
        },
        world: { template: "obstacle-course", goal_xy: [3, 0] },
        steps: [
          {
            action: "mount",
            parts: ["c1", "c2", "c3"],
            tools: ["screwdriver"],
            detail: "Mount the controller and sensor to the base.",
            est_minutes: 20,
            depends_on: [],
          },
          {
            action: "test",
            parts: ["c1", "c2", "c3"],
            tools: ["stopwatch"],
            detail: "Run the navigation acceptance test.",
            est_minutes: 10,
            depends_on: [1],
          },
        ],
    });
    const { generateAssembly } = await import("../site/lib/assembly-gen.js");

    const result = await generateAssembly("inspect each aisle", [
      "irobot-create-3",
      "raspberry-pi-5",
      "adafruit-vl53l4cd",
    ], {
      generateText: async () => ({ text }),
    });

    expect(result.degraded).toBe(false);
    expect(result.assembly.goal.criteria).toEqual({
      position_tolerance_m: 0.2,
      dwell_s: 3,
      max_collision_events: 1,
      require_upright: true,
    });
    expect(result.assembly.components.every((component) => component.sim)).toBe(
      true,
    );
  });

  it("normalizes model-authored edges to a transport both endpoints support", async () => {
    const text = JSON.stringify({
      roles: [
        { ref: "c1", role: "chassis" },
        { ref: "c2", role: "compute" },
        { ref: "c3", role: "sensor" },
      ],
      edges: [
        // ROS 2 is the payload/protocol here, not a physical interface exposed
        // by the mocked Pi metadata. The generator must pick a real shared link.
        { from: "c2", to: "c1", transport: "ros2", payload: "/cmd_vel" },
        // Normalization must not leave a duplicate when the model also emits
        // the underlying physical link explicitly.
        { from: "c2", to: "c1", transport: "usb" },
        { from: "c2", to: "c3", transport: "i2c" },
      ],
      goal: {
        kind: "navigate",
        spec: "Reach the inspection marker.",
        success_metric: "Within 0.3 m for 2 s with zero collisions.",
        criteria: {
          position_tolerance_m: 0.3,
          dwell_s: 2,
          max_collision_events: 0,
          require_upright: true,
        },
      },
      world: { template: "obstacle-course", goal_xy: [3, 0] },
      steps: [
        {
          action: "mount",
          parts: ["c1", "c2", "c3"],
          tools: ["screwdriver"],
          detail: "Mount the controller and sensor to the base.",
          est_minutes: 20,
          depends_on: [],
        },
        {
          action: "test",
          parts: ["c1", "c2", "c3"],
          tools: ["stopwatch"],
          detail: "Run the navigation acceptance test.",
          est_minutes: 10,
          depends_on: [1],
        },
      ],
    });
    const { generateAssembly } = await import("../site/lib/assembly-gen.js");

    const result = await generateAssembly(
      "inspect each aisle",
      ["irobot-create-3", "raspberry-pi-5", "adafruit-vl53l4cd"],
      { generateText: async () => ({ text }) },
    );

    expect(result.degraded).toBe(false);
    expect(result.assembly.edges).toEqual([
      { from: "c2", to: "c1", transport: "usb", payload: "/cmd_vel" },
      { from: "c2", to: "c3", transport: "i2c" },
    ]);
  });

  it("exports a deterministic plan for an already-selected candidate", async () => {
    const { generateDeterministicBuildPlan } = await import(
      "../site/lib/assembly-gen.js"
    );
    const [candidate] = generateBuildCandidates("patrol the office", [
      "irobot-create-3",
    ]);

    const plan = generateDeterministicBuildPlan(candidate.assembly);

    expect(plan.steps[0]).toMatchObject({ action: "mount", order: 1 });
    expect(plan.steps.at(-1)?.action).toBe("test");
    expect(
      plan.steps.some((step) => step.detail.includes("5 V USB-C power")),
    ).toBe(true);
    expect(plan.total_minutes).toBe(
      plan.steps.reduce((total, step) => total + step.est_minutes, 0),
    );
  });

  it("commissions an integrated TurtleBot without telling users to remount included parts", async () => {
    const { generateDeterministicBuildPlan } = await import(
      "../site/lib/assembly-gen.js"
    );
    const [candidate] = generateBuildCandidates("patrol the office", [
      "turtlebot-4-lite",
    ]);

    const plan = generateDeterministicBuildPlan(candidate.assembly);

    expect(plan.steps.map((step) => step.action)).toEqual([
      "calibrate",
      "test",
    ]);
    expect(plan.steps[0].detail).toContain("factory-integrated");
    expect(plan.steps.flatMap((step) => step.parts)).toEqual(
      expect.arrayContaining(["turtlebot-4-lite"]),
    );
  });
});
