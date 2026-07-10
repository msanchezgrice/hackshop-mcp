import { describe, expect, it } from "vitest";

import {
  chassisLocalToViewer,
  parseTrajectory,
  sampleTrajectory,
  trajectoryDuration,
  trajectoryMarkers,
  worldObjectToViewerTransform,
} from "../site/lib/trajectory.js";

const workerTrajectory = {
  fps: 2,
  meta: {
    goal_xy: [2, 1],
    goal_radius: 0.3,
    start_xy: [0, 0],
    template: "obstacle-course",
  },
  poses: [
    { t: 0, x: 0, y: 0, yaw: 3.1 },
    { t: 1, x: 1, y: 0.5, yaw: -3.1, collided: true },
    { t: 2, x: 2, y: 1, yaw: -2.9, failure: "stuck" },
  ],
  qpos: [[0], [1], [2]],
  events: [
    {
      t: 1.5,
      kind: "collision",
      label: "Bumped the crate",
      position_m: [1.5, 0.75, 0],
    },
  ],
};

describe("parseTrajectory", () => {
  it("accepts the worker trajectory contract and preserves optional event data", () => {
    const trajectory = parseTrajectory(workerTrajectory);

    expect(trajectory.fps).toBe(2);
    expect(trajectory.poses).toHaveLength(3);
    expect(trajectory.meta.goal_xy).toEqual([2, 1]);
    expect(trajectory.events?.[0]).toMatchObject({
      kind: "collision",
      label: "Bumped the crate",
      position_m: [1.5, 0.75, 0],
    });
  });

  it("rejects non-finite pose values and non-increasing timestamps", () => {
    expect(() =>
      parseTrajectory({
        ...workerTrajectory,
        poses: [
          { t: 0, x: 0, y: 0, yaw: 0 },
          { t: 0, x: Number.POSITIVE_INFINITY, y: 1, yaw: 0 },
        ],
      }),
    ).toThrow(/trajectory/i);

    expect(() =>
      parseTrajectory({
        ...workerTrajectory,
        poses: [
          { t: 1, x: 0, y: 0, yaw: 0 },
          { t: 0.5, x: 1, y: 1, yaw: 0 },
        ],
      }),
    ).toThrow(/time/i);
  });

  it("rejects empty trajectories and invalid frame rates", () => {
    expect(() =>
      parseTrajectory({ fps: 0, meta: {}, poses: [] }),
    ).toThrow(/fps|frame rate/i);
    expect(() =>
      parseTrajectory({ fps: 30, meta: {}, poses: [] }),
    ).toThrow(/pose/i);
  });

  it("accepts optional dimensioned world geometry while preserving legacy trajectories", () => {
    const worldObjects = [
      {
        name: "north-wall",
        shape: "wall",
        position_m: [0, 2.9, 0.25],
        dimensions_m: [6, 0.12, 0.5],
        color: "#526173",
      },
      {
        name: "loading-ramp",
        shape: "ramp",
        position_m: [0, 0, 0.12],
        dimensions_m: [1.2, 0.8, 0.24],
        rotation_deg: [0, -12, 0],
      },
      {
        name: "pillar-a",
        shape: "cylinder",
        position_m: [1, -0.5, 0.3],
        dimensions_m: [0.4, 0.4, 0.6],
      },
    ];

    const parsed = parseTrajectory({
      ...workerTrajectory,
      meta: { ...workerTrajectory.meta, world_objects: worldObjects },
    });

    expect(parsed.meta.world_objects).toEqual(worldObjects);
    expect(parseTrajectory(workerTrajectory).meta.world_objects).toBeUndefined();
  });

  it("rejects malformed world geometry before it reaches Three.js", () => {
    expect(() =>
      parseTrajectory({
        ...workerTrajectory,
        meta: {
          ...workerTrajectory.meta,
          world_objects: [
            {
              name: "bad-wall",
              shape: "wall",
              position_m: [0, 1],
              dimensions_m: [1, 0.1, 0.5],
            },
          ],
        },
      }),
    ).toThrow(/world_objects.*position_m/i);

    expect(() =>
      parseTrajectory({
        ...workerTrajectory,
        meta: {
          ...workerTrajectory.meta,
          world_objects: [
            {
              name: "flat-ramp",
              shape: "ramp",
              position_m: [0, 0, 0],
              dimensions_m: [1, 0.8, 0],
            },
          ],
        },
      }),
    ).toThrow(/world_objects.*dimensions_m/i);
  });
});

describe("sampleTrajectory", () => {
  const trajectory = parseTrajectory(workerTrajectory);

  it("linearly interpolates position and takes the shortest path across the yaw seam", () => {
    const pose = sampleTrajectory(trajectory, 0.5);

    expect(pose.x).toBeCloseTo(0.5);
    expect(pose.y).toBeCloseTo(0.25);
    expect(Math.abs(pose.yaw)).toBeCloseTo(Math.PI, 1);
  });

  it("clamps samples before the first and after the last pose", () => {
    expect(sampleTrajectory(trajectory, -10)).toEqual(trajectory.poses[0]);
    expect(sampleTrajectory(trajectory, 99)).toEqual(trajectory.poses[2]);
    expect(trajectoryDuration(trajectory)).toBe(2);
  });
});

describe("trajectoryMarkers", () => {
  it("combines explicit events with collision and failure data embedded in poses", () => {
    const markers = trajectoryMarkers(parseTrajectory(workerTrajectory));

    expect(markers.map((marker) => marker.kind)).toEqual([
      "collision",
      "collision",
      "stuck",
    ]);
    expect(markers[0]).toMatchObject({ t: 1, position_m: [1, 0.5, 0] });
    expect(markers[1]).toMatchObject({
      t: 1.5,
      label: "Bumped the crate",
    });
    expect(markers[2]).toMatchObject({ t: 2, position_m: [2, 1, 0] });
  });

  it("prefers a precise runtime event over the nearby sampled pose marker", () => {
    const trajectory = parseTrajectory({
      ...workerTrajectory,
      poses: [
        { t: 0, x: 0, y: 0, yaw: 0, collided: false },
        { t: 1, x: 1, y: 0.5, yaw: 0, collided: true },
        { t: 2, x: 1.5, y: 0.5, yaw: 0, collided: false },
      ],
      events: [
        {
          t: 1.01,
          kind: "collision",
          label: "Collision with wall_n",
          position_m: [1.01, 0.5, 0],
        },
      ],
    });

    expect(trajectoryMarkers(trajectory)).toEqual([
      {
        t: 1.01,
        kind: "collision",
        label: "Collision with wall_n",
        position_m: [1.01, 0.5, 0],
      },
    ]);
  });
});

describe("chassisLocalToViewer", () => {
  it("raises chassis-local z from the chassis center and flips MuJoCo lateral y", () => {
    expect(chassisLocalToViewer([0.1, 0.2, 0.03], 0.08)).toEqual([
      0.1,
      0.11,
      -0.2,
    ]);
  });
});

describe("worldObjectToViewerTransform", () => {
  it("maps world-frame position and MuJoCo Euler axes into the Three.js frame", () => {
    const transform = worldObjectToViewerTransform({
      name: "ramp",
      shape: "ramp",
      position_m: [1, 2, 0.3],
      dimensions_m: [1.2, 0.8, 0.2],
      rotation_deg: [10, -12, 90],
    });

    expect(transform.position).toEqual([1, 0.3, -2]);
    expect(transform.rotation_rad[0]).toBeCloseTo(Math.PI / 18);
    expect(transform.rotation_rad[1]).toBeCloseTo(Math.PI / 2);
    expect(transform.rotation_rad[2]).toBeCloseTo(Math.PI / 15);
  });
});
