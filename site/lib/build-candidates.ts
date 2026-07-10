import {
  Assembly,
  BuildCandidate,
  type AssemblyComponent,
  type SimHandle,
} from "./assembly";

const SUPPORTED_CHASSIS_IDS = [
  "irobot-create-3",
  "turtlebot-4-lite",
] as const;
type SupportedChassisId = (typeof SUPPORTED_CHASSIS_IDS)[number];

interface DeviceTemplate {
  name: string;
  role: AssemblyComponent["role"];
  sim: SimHandle;
}

const DEVICE_TEMPLATES: Record<string, DeviceTemplate> = {
  "irobot-create-3": {
    name: "iRobot Create 3",
    role: "chassis",
    sim: {
      asset_id: "irobot-create-3",
      asset_version: "1",
      dimensions_m: [0.34, 0.34, 0.09],
      fidelity: "dimensioned-proxy",
      format: "proxy",
      dof: 2,
      mass_kg: 3,
    },
  },
  "turtlebot-4-lite": {
    name: "TurtleBot 4 Lite",
    role: "chassis",
    sim: {
      asset_id: "turtlebot-4-lite",
      asset_version: "1",
      dimensions_m: [0.341, 0.339, 0.192],
      fidelity: "dimensioned-proxy",
      format: "proxy",
      dof: 2,
      mass_kg: 3.3,
    },
  },
  "raspberry-pi-5": {
    name: "Raspberry Pi 5",
    role: "compute",
    sim: {
      asset_id: "raspberry-pi-5",
      asset_version: "1",
      dimensions_m: [0.085, 0.056, 0.017],
      fidelity: "dimensioned-proxy",
      format: "proxy",
      dof: 0,
      mass_kg: 0.045,
    },
  },
  "adafruit-vl53l4cd": {
    name: "Adafruit VL53L4CD Time of Flight Distance Sensor",
    role: "sensor",
    sim: {
      asset_id: "adafruit-vl53l4cd",
      asset_version: "1",
      dimensions_m: [0.0255, 0.0177, 0.0047],
      fidelity: "dimensioned-proxy",
      format: "proxy",
      dof: 0,
      mass_kg: 0.002,
    },
  },
  "rplidar-a1m8": {
    name: "RPLIDAR A1M8 360° LiDAR",
    role: "sensor",
    sim: {
      asset_id: "rplidar-a1m8",
      asset_version: "1",
      dimensions_m: [0.0968, 0.0703, 0.055],
      fidelity: "dimensioned-proxy",
      format: "proxy",
      dof: 0,
      mass_kg: 0.17,
    },
  },
};

function isSupportedChassis(id: string): id is SupportedChassisId {
  return (SUPPORTED_CHASSIS_IDS as readonly string[]).includes(id);
}

export function simulationHandleFor(deviceId: string): SimHandle | undefined {
  const sim = DEVICE_TEMPLATES[deviceId]?.sim;
  if (!sim) return undefined;
  return {
    ...sim,
    dimensions_m: sim.dimensions_m ? [...sim.dimensions_m] : undefined,
  };
}

function componentFor(deviceId: string, ref: string): AssemblyComponent {
  const template = DEVICE_TEMPLATES[deviceId];
  if (!template) {
    throw new Error(`no supported build template for device_id: ${deviceId}`);
  }
  return {
    ref,
    device_id: deviceId,
    name: template.name,
    role: template.role,
    sim: simulationHandleFor(deviceId),
  };
}

function candidateFor(idea: string, chassisId: SupportedChassisId): BuildCandidate {
  const chassis = DEVICE_TEMPLATES[chassisId];
  const isIntegratedTurtleBot = chassisId === "turtlebot-4-lite";
  const deviceIds = isIntegratedTurtleBot
    ? [chassisId]
    : [chassisId, "raspberry-pi-5", "rplidar-a1m8"];
  const components = isIntegratedTurtleBot
    ? [componentFor(chassisId, "base")]
    : [
        componentFor(chassisId, "base"),
        componentFor("raspberry-pi-5", "compute"),
        componentFor("rplidar-a1m8", "lidar"),
      ];
  const edges = isIntegratedTurtleBot
    ? []
    : [
        {
          from: "compute",
          to: "base",
          transport: "usb" as const,
          payload: "/cmd_vel and /odom (ROS 2)",
        },
        {
          from: "base",
          to: "compute",
          transport: "power" as const,
          payload: "5 V USB-C power",
        },
        {
          from: "compute",
          to: "lidar",
          transport: "usb" as const,
          payload: "360° scan data and 5 V power",
        },
      ];
  const assembly = Assembly.parse({
    idea,
    components,
    edges,
    goal: {
      kind: "navigate",
      spec: "Drive from start to the goal marker while avoiding obstacles.",
      success_metric:
        "Within 0.3 m of the goal for at least 2 s, upright, with zero collision events.",
      criteria: {
        position_tolerance_m: 0.3,
        dwell_s: 2,
        max_collision_events: 0,
        require_upright: true,
      },
    },
    world: { template: "obstacle-course", goal_xy: [3, 0] },
  });

  return BuildCandidate.parse({
    id: `navigate-${chassisId}`,
    name: `${chassis.name} navigation build`,
    chassis_device_id: chassisId,
    device_ids: deviceIds,
    included_hardware: isIntegratedTurtleBot
      ? [
          "Raspberry Pi 4B (4 GB)",
          "OAK-D-Lite stereo camera",
          "RPLIDAR A1M8 360° LiDAR",
        ]
      : [],
    observation_model: "2d-lidar",
    purchase_tier: "premium",
    estimated_price_usd: isIntegratedTurtleBot
      ? { min: 1100, max: 1400 }
      : { min: 380, max: 540 },
    assembly,
  });
}

export function generateBuildCandidates(
  idea: string,
  preferredDeviceIds?: readonly string[],
  budgetUsd?: number,
): BuildCandidate[] {
  const chassisIds = preferredDeviceIds
    ? preferredDeviceIds.filter(isSupportedChassis)
    : [...SUPPORTED_CHASSIS_IDS];

  return [...new Set(chassisIds)]
    .map((id) => candidateFor(idea, id))
    .filter(
      (candidate) =>
        budgetUsd === undefined || candidate.estimated_price_usd.min <= budgetUsd,
    );
}

export function assemblyInputForCandidate(candidate: BuildCandidate): {
  idea: string;
  device_ids: string[];
  candidate_id: string;
} {
  return {
    idea: candidate.assembly.idea,
    device_ids: [...candidate.device_ids],
    candidate_id: candidate.id,
  };
}

export function resolveBuildCandidateSelection(
  idea: string,
  candidateId: string,
  deviceIds: readonly string[],
): BuildCandidate | undefined {
  const candidate = generateBuildCandidates(idea).find(
    (entry) => entry.id === candidateId,
  );
  if (!candidate || candidate.device_ids.length !== deviceIds.length) {
    return undefined;
  }
  return candidate.device_ids.every(
    (deviceId, index) => deviceId === deviceIds[index],
  )
    ? candidate
    : undefined;
}

export function assemblyInputForSelectedDevice(
  idea: string,
  deviceId: string,
): { idea: string; device_ids: string[] } {
  return { idea, device_ids: [deviceId] };
}

const MOBILE_IDEA =
  /\b(robot|rover|mobile|navigate|navigation|drive|driving|wheeled|patrol|delivery|moving|move|locomotion|obstacle)\b/i;

export function shouldOfferSimulationCandidates(
  idea: string,
  includePremium: boolean,
): boolean {
  return includePremium && MOBILE_IDEA.test(idea);
}
