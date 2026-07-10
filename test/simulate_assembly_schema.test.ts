import { describe, expect, it } from "vitest";

import { simulateAssemblyInput } from "../src/tools/simulate_assembly.js";

describe("simulateAssemblyInput physical simulation contract", () => {
  it("preserves dimensioned asset metadata and typed success criteria", () => {
    const parsed = simulateAssemblyInput.parse({
      assembly: {
        idea: "an office delivery rover",
        components: [
          {
            ref: "base",
            device_id: "turtlebot-4-lite",
            name: "TurtleBot 4 Lite",
            role: "chassis",
            sim: {
              asset_id: "turtlebot-4-lite",
              asset_version: "1",
              format: "proxy",
              mass_kg: 3.5,
              dimensions_m: [0.34, 0.34, 0.35],
              fidelity: "dimensioned-proxy",
            },
          },
        ],
        edges: [],
        goal: {
          kind: "navigate",
          spec: "Reach the delivery point without hitting shelving.",
          success_metric: "within 0.25m for 1s with zero collisions",
          criteria: {
            position_tolerance_m: 0.25,
            dwell_s: 1,
            max_collision_events: 0,
            require_upright: true,
          },
        },
        world: { template: "obstacle-course" },
      },
    });

    expect(parsed.assembly.components[0]?.sim).toEqual({
      asset_id: "turtlebot-4-lite",
      asset_version: "1",
      format: "proxy",
      mass_kg: 3.5,
      dimensions_m: [0.34, 0.34, 0.35],
      fidelity: "dimensioned-proxy",
    });
    expect(parsed.assembly.goal.criteria).toEqual({
      position_tolerance_m: 0.25,
      dwell_s: 1,
      max_collision_events: 0,
      require_upright: true,
    });
  });
});
