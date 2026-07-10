export interface TrajectoryPose {
  t: number;
  x: number;
  y: number;
  yaw: number;
  collided?: boolean;
  failure?: string;
}

export interface TrajectoryEvent {
  t: number;
  kind: string;
  label?: string;
  position_m?: [number, number, number];
}

export interface TrajectoryWorldObject {
  name: string;
  shape: string;
  position_m: [number, number, number];
  dimensions_m: [number, number, number];
  rotation_deg?: [number, number, number];
  color?: string;
}

export interface Trajectory {
  fps: number;
  meta: {
    goal_xy?: [number, number];
    goal_radius?: number;
    start_xy?: [number, number];
    template?: string;
    world_objects?: TrajectoryWorldObject[];
  };
  poses: TrajectoryPose[];
  qpos?: number[][];
  events?: TrajectoryEvent[];
}

/** Map MuJoCo chassis-local [forward, lateral, up] into Three.js [x, y, z]. */
export function chassisLocalToViewer(
  position: [number, number, number],
  chassisCenterHeight: number,
): [number, number, number] {
  return [
    position[0],
    chassisCenterHeight + position[2],
    -position[1],
  ];
}

/**
 * Convert a world-frame MuJoCo transform into the viewer's Y-up coordinate
 * system. MuJoCo +Y becomes Three.js -Z; MuJoCo +Z becomes Three.js +Y.
 */
export function worldObjectToViewerTransform(
  object: TrajectoryWorldObject,
): {
  position: [number, number, number];
  rotation_rad: [number, number, number];
} {
  const [xDegrees, yDegrees, zDegrees] = object.rotation_deg ?? [0, 0, 0];
  const radians = Math.PI / 180;
  return {
    position: [object.position_m[0], object.position_m[2], -object.position_m[1]],
    rotation_rad: [
      xDegrees * radians,
      zDegrees * radians,
      -yDegrees * radians,
    ],
  };
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid trajectory: ${path} must be a finite number`);
  }
  return value;
}

function optionalTuple2(
  value: unknown,
  path: string,
): [number, number] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`Invalid trajectory: ${path} must contain two numbers`);
  }
  return [
    finiteNumber(value[0], `${path}[0]`),
    finiteNumber(value[1], `${path}[1]`),
  ];
}

function optionalPosition(
  value: unknown,
  path: string,
): [number, number, number] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) {
    throw new Error(`Invalid trajectory: ${path} must contain two or three numbers`);
  }
  return [
    finiteNumber(value[0], `${path}[0]`),
    finiteNumber(value[1], `${path}[1]`),
    value.length === 3 ? finiteNumber(value[2], `${path}[2]`) : 0,
  ];
}

function tuple3(value: unknown, path: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`Invalid trajectory: ${path} must contain three numbers`);
  }
  return [
    finiteNumber(value[0], `${path}[0]`),
    finiteNumber(value[1], `${path}[1]`),
    finiteNumber(value[2], `${path}[2]`),
  ];
}

export function parseTrajectory(input: unknown): Trajectory {
  if (!isRecord(input)) {
    throw new Error("Invalid trajectory: expected an object");
  }

  const fps = finiteNumber(input.fps, "fps");
  if (fps <= 0) {
    throw new Error("Invalid trajectory: fps must be greater than zero");
  }
  if (!Array.isArray(input.poses) || input.poses.length === 0) {
    throw new Error("Invalid trajectory: at least one pose is required");
  }

  const poses = input.poses.map((rawPose, index): TrajectoryPose => {
    if (!isRecord(rawPose)) {
      throw new Error(`Invalid trajectory: poses[${index}] must be an object`);
    }
    const failure = rawPose.failure;
    if (failure !== undefined && (typeof failure !== "string" || !failure.trim())) {
      throw new Error(
        `Invalid trajectory: poses[${index}].failure must be a non-empty string`,
      );
    }
    if (rawPose.collided !== undefined && typeof rawPose.collided !== "boolean") {
      throw new Error(
        `Invalid trajectory: poses[${index}].collided must be a boolean`,
      );
    }
    return {
      t: finiteNumber(rawPose.t, `poses[${index}].t`),
      x: finiteNumber(rawPose.x, `poses[${index}].x`),
      y: finiteNumber(rawPose.y, `poses[${index}].y`),
      yaw: finiteNumber(rawPose.yaw, `poses[${index}].yaw`),
      ...(rawPose.collided === undefined
        ? {}
        : { collided: rawPose.collided }),
      ...(failure === undefined ? {} : { failure: failure.trim() }),
    };
  });

  for (let index = 1; index < poses.length; index += 1) {
    if (poses[index]!.t <= poses[index - 1]!.t) {
      throw new Error("Invalid trajectory: pose time values must be increasing");
    }
  }

  const rawMeta = input.meta ?? {};
  if (!isRecord(rawMeta)) {
    throw new Error("Invalid trajectory: meta must be an object");
  }
  const goalXY = optionalTuple2(rawMeta.goal_xy, "meta.goal_xy");
  const startXY = optionalTuple2(rawMeta.start_xy, "meta.start_xy");
  let worldObjects: TrajectoryWorldObject[] | undefined;
  if (rawMeta.world_objects !== undefined) {
    if (!Array.isArray(rawMeta.world_objects)) {
      throw new Error("Invalid trajectory: meta.world_objects must be an array");
    }
    worldObjects = rawMeta.world_objects.map((rawObject, index) => {
      const path = `meta.world_objects[${index}]`;
      if (!isRecord(rawObject)) {
        throw new Error(`Invalid trajectory: ${path} must be an object`);
      }
      if (typeof rawObject.name !== "string" || !rawObject.name.trim()) {
        throw new Error(`Invalid trajectory: ${path}.name must be a non-empty string`);
      }
      if (typeof rawObject.shape !== "string" || !rawObject.shape.trim()) {
        throw new Error(`Invalid trajectory: ${path}.shape must be a non-empty string`);
      }
      const position = tuple3(rawObject.position_m, `${path}.position_m`);
      const dimensions = tuple3(rawObject.dimensions_m, `${path}.dimensions_m`);
      if (dimensions.some((value) => value <= 0)) {
        throw new Error(
          `Invalid trajectory: ${path}.dimensions_m values must be greater than zero`,
        );
      }
      const rotation =
        rawObject.rotation_deg === undefined
          ? undefined
          : tuple3(rawObject.rotation_deg, `${path}.rotation_deg`);
      if (
        rawObject.color !== undefined &&
        (typeof rawObject.color !== "string" || !rawObject.color.trim())
      ) {
        throw new Error(`Invalid trajectory: ${path}.color must be a non-empty string`);
      }
      return {
        name: rawObject.name.trim(),
        shape: rawObject.shape.trim(),
        position_m: position,
        dimensions_m: dimensions,
        ...(rotation ? { rotation_deg: rotation } : {}),
        ...(rawObject.color === undefined
          ? {}
          : { color: rawObject.color.trim() }),
      };
    });
  }
  const meta: Trajectory["meta"] = {
    ...(goalXY ? { goal_xy: goalXY } : {}),
    ...(rawMeta.goal_radius === undefined
      ? {}
      : { goal_radius: finiteNumber(rawMeta.goal_radius, "meta.goal_radius") }),
    ...(startXY ? { start_xy: startXY } : {}),
    ...(typeof rawMeta.template === "string"
      ? { template: rawMeta.template }
      : {}),
    ...(worldObjects === undefined ? {} : { world_objects: worldObjects }),
  };

  let qpos: number[][] | undefined;
  if (input.qpos !== undefined) {
    if (!Array.isArray(input.qpos)) {
      throw new Error("Invalid trajectory: qpos must be an array");
    }
    qpos = input.qpos.map((frame, frameIndex) => {
      if (!Array.isArray(frame)) {
        throw new Error(
          `Invalid trajectory: qpos[${frameIndex}] must be an array`,
        );
      }
      return frame.map((value, valueIndex) =>
        finiteNumber(value, `qpos[${frameIndex}][${valueIndex}]`),
      );
    });
  }

  let events: TrajectoryEvent[] | undefined;
  if (input.events !== undefined) {
    if (!Array.isArray(input.events)) {
      throw new Error("Invalid trajectory: events must be an array");
    }
    events = input.events.map((rawEvent, index) => {
      if (!isRecord(rawEvent)) {
        throw new Error(`Invalid trajectory: events[${index}] must be an object`);
      }
      if (typeof rawEvent.kind !== "string" || !rawEvent.kind.trim()) {
        throw new Error(
          `Invalid trajectory: events[${index}].kind must be a non-empty string`,
        );
      }
      if (rawEvent.label !== undefined && typeof rawEvent.label !== "string") {
        throw new Error(
          `Invalid trajectory: events[${index}].label must be a string`,
        );
      }
      const position = optionalPosition(
        rawEvent.position_m,
        `events[${index}].position_m`,
      );
      return {
        t: finiteNumber(rawEvent.t, `events[${index}].t`),
        kind: rawEvent.kind.trim(),
        ...(rawEvent.label === undefined ? {} : { label: rawEvent.label }),
        ...(position === undefined ? {} : { position_m: position }),
      };
    });
  }

  return {
    fps,
    meta,
    poses,
    ...(qpos === undefined ? {} : { qpos }),
    ...(events === undefined ? {} : { events }),
  };
}

export function sampleTrajectory(
  trajectory: Trajectory,
  timeSeconds: number,
): TrajectoryPose {
  const first = trajectory.poses[0]!;
  const last = trajectory.poses[trajectory.poses.length - 1]!;
  if (timeSeconds <= first.t) return first;
  if (timeSeconds >= last.t) return last;

  let low = 0;
  let high = trajectory.poses.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (trajectory.poses[middle]!.t <= timeSeconds) low = middle;
    else high = middle;
  }

  const before = trajectory.poses[low]!;
  const after = trajectory.poses[high]!;
  const mix = (timeSeconds - before.t) / (after.t - before.t);
  const yawDelta = Math.atan2(
    Math.sin(after.yaw - before.yaw),
    Math.cos(after.yaw - before.yaw),
  );

  return {
    t: timeSeconds,
    x: before.x + (after.x - before.x) * mix,
    y: before.y + (after.y - before.y) * mix,
    yaw: before.yaw + yawDelta * mix,
  };
}

export function trajectoryDuration(trajectory: Trajectory): number {
  return trajectory.poses[trajectory.poses.length - 1]!.t;
}

export function trajectoryMarkers(trajectory: Trajectory): TrajectoryEvent[] {
  const markers: TrajectoryEvent[] = [];
  let wasColliding = false;
  const explicitEvents = (trajectory.events ?? []).map((event) => {
    const pose = sampleTrajectory(trajectory, event.t);
    return {
      ...event,
      position_m: event.position_m ?? [pose.x, pose.y, 0] as [number, number, number],
    };
  });
  // Runtime events are captured every physics step while pose flags are only
  // sampled at render cadence. Treat an event within the same frame interval
  // as the authoritative version so a single impact does not render twice.
  const sameFrameEvent = (kind: string, time: number): boolean => {
    const frameInterval = 1 / trajectory.fps;
    return explicitEvents.some(
      (event) =>
        event.kind === kind && Math.abs(event.t - time) < frameInterval * 0.99,
    );
  };

  for (const pose of trajectory.poses) {
    if (pose.collided && !wasColliding && !sameFrameEvent("collision", pose.t)) {
      markers.push({
        t: pose.t,
        kind: "collision",
        label: "Collision",
        position_m: [pose.x, pose.y, 0],
      });
    }
    if (pose.failure && !sameFrameEvent(pose.failure, pose.t)) {
      markers.push({
        t: pose.t,
        kind: pose.failure,
        label: pose.failure,
        position_m: [pose.x, pose.y, 0],
      });
    }
    wasColliding = Boolean(pose.collided);
  }

  markers.push(...explicitEvents);

  return markers.sort((a, b) => a.t - b.t);
}
