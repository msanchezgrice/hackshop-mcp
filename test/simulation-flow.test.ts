import { describe, expect, it } from "vitest";

import * as candidateModule from "../site/lib/build-candidates.js";
import { assemblyInput } from "../site/lib/assembly.js";
import * as simulationUi from "../site/lib/simulation-ui.js";

describe("selected simulation candidate request", () => {
  it("submits only the selected candidate BOM instead of merging alternatives", () => {
    const candidates = candidateModule.generateBuildCandidates("patrol the office");
    const selected = candidates[1]!;
    const requestBuilder = (
      candidateModule as typeof candidateModule & {
        assemblyInputForCandidate?: (
          candidate: (typeof candidates)[number],
        ) => { idea: string; device_ids: string[]; candidate_id: string };
      }
    ).assemblyInputForCandidate;

    expect(typeof requestBuilder).toBe("function");
    const request = requestBuilder!(selected);

    expect(request).toEqual({
      idea: selected.assembly.idea,
      device_ids: selected.device_ids,
      candidate_id: selected.id,
    });
    expect(request.device_ids).toContain("turtlebot-4-lite");
    expect(request.device_ids).not.toContain("irobot-create-3");
    expect(assemblyInput.parse(request).candidate_id).toBe(selected.id);
  });

  it("plans one selected recommendation without merging its alternatives", () => {
    const selectedBuilder = (
      candidateModule as typeof candidateModule & {
        assemblyInputForSelectedDevice?: (
          idea: string,
          deviceId: string,
        ) => { idea: string; device_ids: string[] };
      }
    ).assemblyInputForSelectedDevice;

    expect(typeof selectedBuilder).toBe("function");
    expect(
      selectedBuilder!("build a wall display", "electric-objects-eo1"),
    ).toEqual({
      idea: "build a wall display",
      device_ids: ["electric-objects-eo1"],
    });
  });

  it("offers the rover simulation slice only for mobile ideas", () => {
    const shouldOffer = (
      candidateModule as typeof candidateModule & {
        shouldOfferSimulationCandidates?: (
          idea: string,
          includePremium: boolean,
        ) => boolean;
      }
    ).shouldOfferSimulationCandidates;

    expect(typeof shouldOffer).toBe("function");
    expect(shouldOffer!("an autonomous office delivery rover", false)).toBe(false);
    expect(shouldOffer!("an autonomous office delivery rover", true)).toBe(true);
    expect(shouldOffer!("a wall-mounted family calendar", false)).toBe(false);
    expect(shouldOffer!("a wall-mounted family calendar", true)).toBe(false);
  });

  it("resolves a curated request back to the exact canonical candidate", () => {
    const candidates = candidateModule.generateBuildCandidates("patrol the office");
    const selected = candidates[0]!;
    const resolver = (
      candidateModule as typeof candidateModule & {
        resolveBuildCandidateSelection?: (
          idea: string,
          candidateId: string,
          deviceIds: readonly string[],
        ) => (typeof candidates)[number] | undefined;
      }
    ).resolveBuildCandidateSelection;

    expect(typeof resolver).toBe("function");
    expect(
      resolver!(selected.assembly.idea, selected.id, selected.device_ids),
    ).toEqual(selected);
    expect(
      resolver!(selected.assembly.idea, selected.id, ["raspberry-pi-5"]),
    ).toBeUndefined();
  });
});

describe("simulation result presentation", () => {
  it("labels aggregate typed scoring without claiming the robot never arrived", () => {
    expect(simulationUi.acceptanceStatusLabel(true)).toBe(
      "Passed acceptance criteria",
    );
    expect(simulationUi.acceptanceStatusLabel(false)).toBe(
      "Failed acceptance criteria",
    );
  });

  it("offers only distinct worlds and coerces approximation-only templates", () => {
    expect(
      simulationUi.SIMULATION_WORLD_OPTIONS.map((world) => world.value),
    ).toEqual([
      "obstacle-course",
      "empty-room",
      "ramp",
      "tabletop",
    ]);
    expect(simulationUi.simulationWorldFor("stairs")).toBe("obstacle-course");
    expect(simulationUi.simulationWorldFor("outdoor-flat")).toBe(
      "obstacle-course",
    );
    expect(simulationUi.simulationWorldFor("ramp")).toBe("ramp");
  });

  it("adds the perception hardware required by the generic navigation preview", () => {
    expect(
      simulationUi.SIMULATION_FALLBACK_COMPONENTS.map(
        (component) => component.device_id,
      ),
    ).toEqual(["generic-diff-drive", "rplidar-a1m8"]);
  });
});
