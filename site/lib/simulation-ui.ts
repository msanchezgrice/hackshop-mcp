import type { AssemblyComponent, WorldSpec } from "./assembly";

export const SIMULATION_FALLBACK_COMPONENTS: ReadonlyArray<AssemblyComponent> = [
  {
    ref: "sim-base",
    device_id: "generic-diff-drive",
    name: "Generic mobile base (simulation preview)",
    role: "chassis",
  },
  {
    ref: "sim-lidar",
    device_id: "rplidar-a1m8",
    name: "RPLIDAR A1M8 (simulation preview)",
    role: "sensor",
  },
];

export const SIMULATION_WORLD_OPTIONS: ReadonlyArray<{
  value: WorldSpec["template"];
  label: string;
}> = [
  { value: "obstacle-course", label: "Obstacle course (default)" },
  { value: "empty-room", label: "Empty room" },
  { value: "ramp", label: "Ramp" },
  { value: "tabletop", label: "Tabletop" },
];

export function simulationWorldFor(
  requested: WorldSpec["template"],
): WorldSpec["template"] {
  return requested === "stairs" || requested === "outdoor-flat"
    ? "obstacle-course"
    : requested;
}

export function acceptanceStatusLabel(success: boolean): string {
  return success
    ? "Passed acceptance criteria"
    : "Failed acceptance criteria";
}
