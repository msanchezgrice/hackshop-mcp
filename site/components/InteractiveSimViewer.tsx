"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { SimResult } from "@/lib/sim-client";
import {
  chassisLocalToViewer,
  parseTrajectory,
  sampleTrajectory,
  trajectoryDuration,
  trajectoryMarkers,
  type Trajectory,
  worldObjectToViewerTransform,
} from "@/lib/trajectory";

type SimRobot = NonNullable<SimResult["robot"]>;
type Dimensions = [number, number, number];
type LoadState = "loading" | "ready" | "error";

export interface InteractiveSimViewerProps {
  trajectoryUrl: string;
  robot?: SimResult["robot"];
  autoPlay?: boolean;
  height?: number;
}

const ROLE_VISUALS: Record<
  string,
  { dimensions: Dimensions; color: string; shape: string }
> = {
  compute: { dimensions: [0.1, 0.08, 0.035], color: "#202631", shape: "box" },
  sensor: { dimensions: [0.065, 0.065, 0.05], color: "#22c7d6", shape: "cylinder" },
  power: { dimensions: [0.12, 0.09, 0.045], color: "#36b96b", shape: "box" },
  display: { dimensions: [0.025, 0.13, 0.1], color: "#eef2f6", shape: "box" },
  actuator: { dimensions: [0.065, 0.065, 0.055], color: "#e8a83e", shape: "cylinder" },
  peripheral: { dimensions: [0.07, 0.06, 0.04], color: "#a982e2", shape: "box" },
};

function safeDimensions(
  dimensions: Dimensions | undefined,
  fallback: Dimensions,
): Dimensions {
  if (
    dimensions?.length === 3 &&
    dimensions.every((value) => Number.isFinite(value) && value > 0)
  ) {
    return dimensions;
  }
  return fallback;
}

function baseVisual(robot: SimRobot | undefined): {
  dimensions: Dimensions;
  shape: string;
  color: string;
} {
  const id = robot?.device_id.toLowerCase() ?? "";
  let fallback: { dimensions: Dimensions; shape: string; color: string };
  if (id.includes("create") || id.includes("roomba")) {
    fallback = { dimensions: [0.34, 0.34, 0.105], shape: "cylinder", color: "#3b4652" };
  } else if (id.includes("turtlebot")) {
    fallback = { dimensions: [0.31, 0.31, 0.19], shape: "cylinder", color: "#25384d" };
  } else {
    fallback = { dimensions: [0.46, 0.34, 0.14], shape: "box", color: "#3b8eea" };
  }
  return {
    dimensions: safeDimensions(robot?.dimensions_m, fallback.dimensions),
    shape: robot?.shape || fallback.shape,
    color: robot?.color || fallback.color,
  };
}

function makeMaterial(color: string, metalness = 0.18): THREE.MeshStandardMaterial {
  const parsed = new THREE.Color();
  try {
    parsed.set(color);
  } catch {
    parsed.set("#6b7280");
  }
  return new THREE.MeshStandardMaterial({
    color: parsed,
    roughness: 0.48,
    metalness,
  });
}

function makePrimitive(
  shape: string,
  dimensions: Dimensions,
  color: string,
): THREE.Mesh {
  const [length, width, height] = dimensions;
  const normalized = shape.toLowerCase();
  let geometry: THREE.BufferGeometry;

  if (["cylinder", "disc", "disk", "puck", "round"].includes(normalized)) {
    geometry = new THREE.CylinderGeometry(
      Math.max(length, width) / 2,
      Math.max(length, width) / 2,
      height,
      40,
    );
  } else if (["sphere", "ball", "ellipsoid"].includes(normalized)) {
    geometry = new THREE.SphereGeometry(0.5, 32, 20);
    geometry.scale(length, height, width);
  } else if (normalized === "capsule") {
    const radius = Math.min(width, height) / 2;
    geometry = new THREE.CapsuleGeometry(
      radius,
      Math.max(0.001, length - radius * 2),
      8,
      16,
    );
    geometry.rotateZ(Math.PI / 2);
  } else {
    geometry = new THREE.BoxGeometry(length, height, width);
  }

  const mesh = new THREE.Mesh(geometry, makeMaterial(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildRobot(robot: SimRobot | undefined): THREE.Group {
  const group = new THREE.Group();
  group.name = robot?.device_id ?? "generic-diff-drive";

  const base = baseVisual(robot);
  const wheelRadius = Math.max(
    0.035,
    Math.min(base.dimensions[0], base.dimensions[1]) * 0.16,
  );
  const wheelThickness = Math.max(0.025, base.dimensions[1] * 0.105);
  const chassisCenter = Math.max(base.dimensions[2] / 2, wheelRadius * 0.95);

  const chassis = makePrimitive(base.shape, base.dimensions, base.color);
  chassis.name = `${group.name}-base`;
  chassis.position.y = chassisCenter;
  group.add(chassis);

  const wheelGeometry = new THREE.CylinderGeometry(
    wheelRadius,
    wheelRadius,
    wheelThickness,
    28,
  );
  wheelGeometry.rotateX(Math.PI / 2);
  for (const side of [-1, 1]) {
    const wheel = new THREE.Mesh(wheelGeometry.clone(), makeMaterial("#16191f", 0.05));
    wheel.name = side < 0 ? "right-wheel" : "left-wheel";
    wheel.position.set(
      -base.dimensions[0] * 0.08,
      wheelRadius,
      side * (base.dimensions[1] / 2 + wheelThickness * 0.32),
    );
    wheel.castShadow = true;
    group.add(wheel);
  }
  wheelGeometry.dispose();

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(Math.max(0.018, base.dimensions[1] * 0.08), 0.06, 4),
    makeMaterial("#f8d748"),
  );
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(base.dimensions[0] / 2 + 0.025, chassisCenter, 0);
  nose.name = "heading-marker";
  group.add(nose);

  const parts = robot?.mounted_parts ?? [];
  parts.forEach((part, index) => {
    const roleVisual = ROLE_VISUALS[part.role] ?? ROLE_VISUALS.peripheral!;
    const dimensions = safeDimensions(part.dimensions_m, roleVisual.dimensions);
    const mesh = makePrimitive(
      part.shape || roleVisual.shape,
      dimensions,
      part.color || roleVisual.color,
    );
    const fallbackX =
      parts.length <= 1
        ? 0
        : base.dimensions[0] * 0.34 -
          (index / (parts.length - 1)) * base.dimensions[0] * 0.68;
    const [x, y, z] = part.position_m
      ? chassisLocalToViewer(part.position_m, chassisCenter)
      : [
          fallbackX,
          chassisCenter + base.dimensions[2] / 2 + dimensions[2] / 2,
          0,
        ];
    mesh.position.set(x, y, z);
    mesh.name = part.name;
    mesh.userData = { ref: part.ref, role: part.role, mass_kg: part.mass_kg };
    group.add(mesh);
  });

  return group;
}

function markerColor(kind: string): string {
  const normalized = kind.toLowerCase();
  if (normalized.includes("success") || normalized.includes("reached")) return "#34d77b";
  if (normalized.includes("collision") || normalized.includes("tip")) return "#f05252";
  return "#f5a524";
}

function disposeScene(scene: THREE.Scene): void {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    materials.forEach((material) => material.dispose());
  });
}

export function InteractiveSimViewer({
  trajectoryUrl,
  robot,
  autoPlay = true,
  height = 440,
}: InteractiveSimViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const robotGroupRef = useRef<THREE.Group | null>(null);
  const currentTimeRef = useRef(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [trajectory, setTrajectory] = useState<Trajectory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);

  const duration = trajectory ? trajectoryDuration(trajectory) : 0;
  const startTime = trajectory?.poses[0]?.t ?? 0;
  const markers = useMemo(
    () => (trajectory ? trajectoryMarkers(trajectory) : []),
    [trajectory],
  );

  const applyPose = useCallback(
    (time: number) => {
      if (!trajectory || !robotGroupRef.current) return;
      const pose = sampleTrajectory(trajectory, time);
      robotGroupRef.current.position.set(pose.x, 0, -pose.y);
      robotGroupRef.current.rotation.y = -pose.yaw;
    },
    [trajectory],
  );

  const seek = useCallback(
    (time: number) => {
      const bounded = Math.min(duration, Math.max(startTime, time));
      currentTimeRef.current = bounded;
      setCurrentTime(bounded);
      applyPose(bounded);
    },
    [applyPose, duration, startTime],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoadState("loading");
    setTrajectory(null);
    setError(null);
    setRenderError(null);
    setPlaying(false);

    async function loadTrajectory() {
      try {
        const response = await fetch(trajectoryUrl, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Trajectory request failed (${response.status})`);
        }
        const parsed = parseTrajectory(await response.json());
        if (controller.signal.aborted) return;
        const firstTime = parsed.poses[0]!.t;
        currentTimeRef.current = firstTime;
        setCurrentTime(firstTime);
        setTrajectory(parsed);
        setPlaying(autoPlay);
        setLoadState("ready");
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof Error ? caught.message : "Could not load trajectory",
        );
        setLoadState("error");
      }
    }

    void loadTrajectory();
    return () => controller.abort();
  }, [autoPlay, trajectoryUrl]);

  useEffect(() => {
    if (loadState !== "ready" || !trajectory || !canvasRef.current) return;

    const canvas = canvasRef.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch (caught) {
      setRenderError(
        caught instanceof Error
          ? caught.message
          : "This browser could not start WebGL",
      );
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0c111a");
    scene.fog = new THREE.Fog("#0c111a", 14, 34);

    const xs = trajectory.poses.map((pose) => pose.x);
    const ys = trajectory.poses.map((pose) => pose.y);
    for (const object of trajectory.meta.world_objects ?? []) {
      const radius = Math.hypot(
        object.dimensions_m[0],
        object.dimensions_m[1],
      ) / 2;
      xs.push(object.position_m[0] - radius, object.position_m[0] + radius);
      ys.push(object.position_m[1] - radius, object.position_m[1] + radius);
    }
    if (trajectory.meta.goal_xy) {
      xs.push(trajectory.meta.goal_xy[0]);
      ys.push(trajectory.meta.goal_xy[1]);
    }
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const span = Math.max(2.5, maxX - minX, maxY - minY);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
    camera.position.set(
      centerX + span * 0.82,
      Math.max(2.1, span * 0.82),
      -centerY + span * 0.82,
    );

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const controls = new OrbitControls(camera, canvas);
    controls.target.set(centerX, 0.1, -centerY);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.55;
    controls.maxDistance = Math.max(12, span * 5);
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.update();

    scene.add(new THREE.HemisphereLight("#c9dcff", "#243146", 1.7));
    const key = new THREE.DirectionalLight("#ffffff", 3.4);
    key.position.set(centerX + 4, 7, -centerY + 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);

    const floorSize = Math.max(12, Math.ceil(span * 2.4));
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(floorSize, floorSize),
      new THREE.MeshStandardMaterial({ color: "#151e2b", roughness: 0.93 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(centerX, -0.012, -centerY);
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(floorSize, Math.max(12, floorSize * 2), "#3d526b", "#27364a");
    grid.position.set(centerX, 0, -centerY);
    scene.add(grid);

    for (const object of trajectory.meta.world_objects ?? []) {
      const normalizedShape = object.shape.toLowerCase();
      const fallbackColor = normalizedShape.includes("wall")
        ? "#536275"
        : normalizedShape.includes("ramp")
          ? "#a86f3f"
          : "#d45b55";
      const mesh = makePrimitive(
        normalizedShape.includes("cylinder") ? "cylinder" : "box",
        object.dimensions_m,
        object.color || fallbackColor,
      );
      const transform = worldObjectToViewerTransform(object);
      mesh.position.set(...transform.position);
      mesh.rotation.set(...transform.rotation_rad, "XYZ");
      mesh.name = object.name;
      mesh.userData = { shape: object.shape, worldObject: true };
      scene.add(mesh);
    }

    const pathGeometry = new THREE.BufferGeometry().setFromPoints(
      trajectory.poses.map(
        (pose) => new THREE.Vector3(pose.x, 0.025, -pose.y),
      ),
    );
    const path = new THREE.Line(
      pathGeometry,
      new THREE.LineBasicMaterial({ color: "#63b3ff", transparent: true, opacity: 0.72 }),
    );
    path.name = "trajectory-path";
    scene.add(path);

    if (trajectory.meta.goal_xy) {
      const radius = Math.max(0.08, trajectory.meta.goal_radius ?? 0.25);
      const goal = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.72, radius, 48),
        new THREE.MeshBasicMaterial({
          color: "#32d679",
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
        }),
      );
      goal.rotation.x = -Math.PI / 2;
      goal.position.set(
        trajectory.meta.goal_xy[0],
        0.032,
        -trajectory.meta.goal_xy[1],
      );
      goal.name = "goal";
      scene.add(goal);
    }

    markers.forEach((marker, index) => {
      if (!marker.position_m) return;
      const color = markerColor(marker.kind);
      const markerGroup = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.1, 0.018, 8, 28),
        new THREE.MeshBasicMaterial({ color }),
      );
      ring.rotation.x = Math.PI / 2;
      const pin = new THREE.Mesh(
        new THREE.ConeGeometry(0.045, 0.13, 16),
        new THREE.MeshBasicMaterial({ color }),
      );
      pin.position.y = 0.1;
      markerGroup.add(ring, pin);
      markerGroup.position.set(
        marker.position_m[0],
        0.045,
        -marker.position_m[1],
      );
      markerGroup.name = `event-${index}-${marker.kind}`;
      scene.add(markerGroup);
    });

    const robotGroup = buildRobot(robot);
    robotGroupRef.current = robotGroup;
    scene.add(robotGroup);
    const initialPose = sampleTrajectory(trajectory, currentTimeRef.current);
    robotGroup.position.set(initialPose.x, 0, -initialPose.y);
    robotGroup.rotation.y = -initialPose.yaw;

    const resize = () => {
      const width = Math.max(1, canvas.clientWidth);
      const canvasHeight = Math.max(1, canvas.clientHeight);
      camera.aspect = width / canvasHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(width, canvasHeight, false);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    let renderFrame = 0;
    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      renderFrame = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(renderFrame);
      resizeObserver.disconnect();
      controls.dispose();
      robotGroupRef.current = null;
      disposeScene(scene);
      renderer.dispose();
    };
  }, [loadState, markers, robot, trajectory]);

  useEffect(() => {
    applyPose(currentTime);
  }, [applyPose, currentTime]);

  useEffect(() => {
    if (!playing || !trajectory) return;
    let animationFrame = 0;
    let previous = performance.now();
    let lastUiUpdate = previous;

    const advance = (now: number) => {
      const elapsed = Math.min(0.25, (now - previous) / 1000);
      previous = now;
      const next = Math.min(duration, currentTimeRef.current + elapsed * speed);
      currentTimeRef.current = next;
      applyPose(next);
      if (now - lastUiUpdate >= 32 || next >= duration) {
        lastUiUpdate = now;
        setCurrentTime(next);
      }
      if (next >= duration) {
        setPlaying(false);
        return;
      }
      animationFrame = requestAnimationFrame(advance);
    };

    animationFrame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(animationFrame);
  }, [applyPose, duration, playing, speed, trajectory]);

  if (loadState === "loading") {
    return (
      <div
        aria-live="polite"
        style={{
          height,
          display: "grid",
          placeItems: "center",
          border: "1px solid var(--border)",
          borderRadius: 10,
          color: "var(--muted)",
          background: "#0c111a",
        }}
      >
        <span>Loading interactive trajectory…</span>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div
        role="alert"
        style={{
          padding: 16,
          border: "1px solid var(--border)",
          borderRadius: 10,
          background: "rgba(239,68,68,0.07)",
        }}
      >
        <strong>Interactive replay unavailable.</strong>{" "}
        <span style={{ color: "var(--muted)" }}>{error}</span>
        <div style={{ marginTop: 8, fontSize: 13 }}>
          <a href={trajectoryUrl} target="_blank" rel="noreferrer">
            Open the raw trajectory JSON ↗
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        overflow: "hidden",
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "#0c111a",
      }}
    >
      <div style={{ position: "relative" }}>
        <canvas
          ref={canvasRef}
          aria-label={`Interactive 3D replay of ${robot?.device_id ?? "the simulated robot"}`}
          style={{ display: "block", width: "100%", height, touchAction: "none" }}
        />
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            right: 10,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 8,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              padding: "6px 9px",
              borderRadius: 7,
              color: "#eef6ff",
              background: "rgba(5,9,15,0.76)",
              backdropFilter: "blur(6px)",
              fontSize: 12,
            }}
          >
            <strong>{robot?.device_id ?? "Generic diff-drive"}</strong>
            {robot?.fidelity && (
              <span style={{ color: "#a8bbd0" }}> · {robot.fidelity}</span>
            )}
            <div style={{ marginTop: 2, color: "#94a8bf" }}>
              Drag to orbit · scroll or pinch to zoom
            </div>
          </div>
          <div
            style={{
              padding: "6px 9px",
              borderRadius: 7,
              color: "#c9d7e7",
              background: "rgba(5,9,15,0.76)",
              fontSize: 12,
            }}
          >
            {trajectory?.meta.template ?? "simulation"}
          </div>
        </div>

        {renderError && (
          <div
            role="alert"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              padding: 24,
              textAlign: "center",
              color: "#e7edf6",
              background: "#0c111a",
            }}
          >
            <div>
              <strong>3D rendering is not available in this browser.</strong>
              <div style={{ marginTop: 6, color: "#9fb0c4", fontSize: 13 }}>
                {renderError}. The trajectory data and event timeline are still
                available below.
              </div>
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          padding: 12,
          borderTop: "1px solid #243044",
          background: "#101722",
          color: "#e6edf6",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            onClick={() => {
              if (currentTimeRef.current >= duration) seek(startTime);
              setPlaying((value) => !value);
            }}
            style={{
              minWidth: 72,
              padding: "6px 10px",
              border: "1px solid #40516a",
              borderRadius: 6,
              background: playing ? "#24344a" : "#2478cc",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 650,
            }}
          >
            {playing ? "Pause" : currentTime >= duration ? "Replay" : "Play"}
          </button>
          <input
            aria-label="Replay time"
            type="range"
            min={startTime}
            max={duration}
            step={trajectory ? Math.max(0.001, 1 / trajectory.fps) : 0.01}
            value={currentTime}
            onChange={(event) => seek(Number(event.target.value))}
            style={{ flex: 1, minWidth: 80, accentColor: "#55aaff" }}
          />
          <span
            aria-live="off"
            style={{ minWidth: 86, textAlign: "right", fontSize: 12, color: "#afbdd0" }}
          >
            {currentTime.toFixed(1)} / {duration.toFixed(1)}s
          </span>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
            <span style={{ color: "#afbdd0" }}>Speed</span>
            <select
              aria-label="Playback speed"
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
              style={{
                width: "auto",
                margin: 0,
                padding: "4px 6px",
                border: "1px solid #40516a",
                borderRadius: 5,
                color: "#e6edf6",
                background: "#182233",
              }}
            >
              {[0.25, 0.5, 1, 2, 4].map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
            </select>
          </label>
        </div>

        {(markers.length > 0 || (robot?.mounted_parts.length ?? 0) > 0) && (
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
              marginTop: 10,
              paddingTop: 10,
              borderTop: "1px solid #243044",
              fontSize: 12,
            }}
          >
            {robot?.mounted_parts.map((part) => (
              <span
                key={part.ref}
                title={`${part.role} · ${part.mass_kg} kg`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  color: "#b8c5d6",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background:
                      part.color ||
                      (ROLE_VISUALS[part.role] ?? ROLE_VISUALS.peripheral!).color,
                  }}
                />
                {part.name}
              </span>
            ))}
            {markers.map((marker, index) => (
              <button
                key={`${marker.t}-${marker.kind}-${index}`}
                type="button"
                onClick={() => {
                  setPlaying(false);
                  seek(marker.t);
                }}
                title={`Jump to ${marker.t.toFixed(2)} seconds`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "3px 7px",
                  border: `1px solid ${markerColor(marker.kind)}88`,
                  borderRadius: 999,
                  color: "#e6edf6",
                  background: `${markerColor(marker.kind)}22`,
                  cursor: "pointer",
                  fontSize: 11,
                }}
              >
                <span aria-hidden="true" style={{ color: markerColor(marker.kind) }}>
                  ●
                </span>
                {marker.label || marker.kind} · {marker.t.toFixed(1)}s
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
