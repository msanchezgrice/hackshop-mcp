import "server-only";
import { z } from "zod";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import {
  Assembly,
  BuildAction,
  BuildPlan,
  ComponentRole,
  NavigationSuccessCriteria,
  Transport,
  type AssemblyComponent,
  type BuildStep,
} from "./assembly";
import { simulationHandleFor } from "./build-candidates";
import { loadDeviceDirectory, type DeviceMeta } from "./capabilities";
import { loadCatalog } from "./catalog";
import { applyBrickRiskSafety } from "./safety";
import type { DeviceEntry } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// Assembly + Build Plan generator.
//
// Turns (idea, device_ids) into a structured Assembly IR and a human-readable
// Build Plan. An LLM refines roles, wires the protocol graph, picks a goal and
// world, and drafts assembly steps — but everything is re-validated against the
// zod schemas, and any failure falls back to a deterministic generator so the
// /api/assembly route never hard-depends on the model.
// ─────────────────────────────────────────────────────────────────────────

export interface GenerateResult {
  assembly: Assembly;
  build_plan: BuildPlan;
  degraded: boolean; // true => deterministic fallback was used
}

// Transports we prefer when auto-wiring, most-specific first.
const TRANSPORT_PRIORITY: Transport[] = [
  "ros2",
  "i2c",
  "spi",
  "uart",
  "usb",
  "wifi",
  "ble",
  "gpio",
  "hdmi",
  "aux",
];

function resolveMetas(deviceIds: string[]): DeviceMeta[] {
  const dir = loadDeviceDirectory();
  const metas: DeviceMeta[] = [];
  for (const id of deviceIds) {
    const m = dir.get(id);
    if (m) metas.push(m);
  }
  return metas;
}

function refFor(i: number): string {
  return `c${i + 1}`;
}

// Brick-risk note for a flash step, reusing the published safety rule. Only
// used-catalog devices carry brick provenance; premium devices return null.
function brickNoteIndex(): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const { devices } = loadCatalog();
  const byId = new Map<string, DeviceEntry>(devices.map((d) => [d.id, d]));
  for (const [id, d] of byId) {
    const safety = applyBrickRiskSafety(d);
    out.set(id, safety.brick_risk_disclaimer ?? null);
  }
  return out;
}

function inferGoalKind(metas: DeviceMeta[]): Assembly["goal"]["kind"] {
  const roles = new Set(metas.map((m) => m.defaultRole));
  if (roles.has("chassis")) return "navigate";
  if (roles.has("actuator")) return "manipulate";
  if (roles.has("display")) return "display-loop";
  if (roles.has("sensor")) return "sense-act";
  return "display-loop";
}

const WORLD_FOR_GOAL: Record<
  Assembly["goal"]["kind"],
  { template: Assembly["world"]["template"]; goal_xy?: [number, number] }
> = {
  navigate: { template: "obstacle-course", goal_xy: [3, 0] },
  locomote: { template: "ramp", goal_xy: [2, 0] },
  manipulate: { template: "tabletop" },
  "sense-act": { template: "empty-room" },
  "display-loop": { template: "empty-room" },
};

const GOAL_SPEC: Record<
  Assembly["goal"]["kind"],
  Omit<Assembly["goal"], "kind">
> = {
  navigate: {
    spec: "Drive from start to the goal marker without hitting obstacles.",
    success_metric: "Within 0.3 m of the goal for >2 s with zero collisions.",
    criteria: {
      position_tolerance_m: 0.3,
      dwell_s: 2,
      max_collision_events: 0,
      require_upright: true,
    },
  },
  locomote: {
    spec: "Walk up the ramp and stay upright at the top.",
    success_metric: "Reaches the top zone upright (torso > 0.1 m) for >2 s.",
  },
  manipulate: {
    spec: "Pick the target object off the table and place it in the bin.",
    success_metric: "Object released inside the bin volume; no table collision.",
  },
  "sense-act": {
    spec: "React to the sensed trigger with the correct actuation.",
    success_metric: "Correct response within 500 ms of the trigger event.",
  },
  "display-loop": {
    spec: "Run the display/update loop steadily.",
    success_metric: "Refreshes on schedule with no crash over the run window.",
  },
};

function deterministicAssembly(idea: string, metas: DeviceMeta[]): Assembly {
  const components: AssemblyComponent[] = metas.map((m, i) => ({
    ref: refFor(i),
    device_id: m.id,
    name: m.name,
    role: m.defaultRole,
    sim: simulationHandleFor(m.id),
  }));

  // Hub = first compute, else first component, so we always have something to
  // wire peripherals to.
  const hubIdx = Math.max(
    0,
    components.findIndex((c) => c.role === "compute"),
  );
  const hub = components[hubIdx];

  const edges = components
    .filter((c) => c.ref !== hub.ref)
    .map((c) => {
      const hubIfaces = metas[hubIdx].capability.interfaces;
      const cIfaces = metas[components.indexOf(c)].capability.interfaces;
      const shared = TRANSPORT_PRIORITY.find(
        (t) => hubIfaces.includes(t) && cIfaces.includes(t),
      );
      return {
        from: hub.ref,
        to: c.ref,
        transport: (shared ?? "usb") as Transport,
      };
    });

  const kind = inferGoalKind(metas);
  return Assembly.parse({
    idea,
    components,
    edges,
    goal: { kind, ...GOAL_SPEC[kind] },
    world: WORLD_FOR_GOAL[kind],
  });
}

function deterministicBuildPlan(
  assembly: Assembly,
  brickNotes: Map<string, string | null>,
): BuildPlan {
  if (
    assembly.components.length === 1 &&
    assembly.components[0]?.device_id === "turtlebot-4-lite"
  ) {
    return BuildPlan.parse({
      steps: [
        {
          order: 1,
          action: "calibrate",
          parts: ["turtlebot-4-lite"],
          tools: ["level floor", "Clearpath diagnostics"],
          detail:
            "Verify the factory-integrated RPLIDAR, wheel odometry, and ROS 2 topics on a level floor.",
          est_minutes: 10,
          risk_note: null,
          depends_on: [],
        },
        {
          order: 2,
          action: "test",
          parts: ["turtlebot-4-lite"],
          tools: ["clear test area", "stopwatch"],
          detail: `Run the integrated robot against the goal: ${assembly.goal.spec}`,
          est_minutes: 15,
          risk_note: null,
          depends_on: [1],
        },
      ],
      total_minutes: 25,
    });
  }

  const steps: BuildStep[] = [];
  let order = 1;
  const push = (s: Omit<BuildStep, "order">) =>
    steps.push({ order: order++, ...s });

  // Mount every component onto the frame/base.
  push({
    action: "mount",
    parts: assembly.components.map((c) => c.device_id),
    tools: ["M2/M3 screws", "screwdriver", "standoffs"],
    detail: "Mount all components to the chassis/frame in their final positions.",
    est_minutes: 20,
    risk_note: null,
    depends_on: [],
  });
  const mountOrder = 1;

  // Connect each declared data edge.
  for (const e of assembly.edges) {
    const from = assembly.components.find((c) => c.ref === e.from);
    const to = assembly.components.find((c) => c.ref === e.to);
    push({
      action: "connect",
      parts: [from?.device_id ?? e.from, to?.device_id ?? e.to],
      tools: [
        e.transport === "power" && e.payload
          ? e.payload
          : `${e.transport.toUpperCase()} cable/harness`,
      ],
      detail: `Connect ${to?.name ?? e.to} to ${from?.name ?? e.from} over ${e.transport.toUpperCase()}${e.payload ? ` (${e.payload})` : ""}.`,
      est_minutes: 8,
      risk_note: null,
      depends_on: [mountOrder],
    });
  }

  // Flash each compute component (firmware/OS + control program).
  const connectOrders = steps
    .filter((s) => s.action === "connect")
    .map((s) => s.order);
  for (const c of assembly.components.filter((x) => x.role === "compute")) {
    push({
      action: "flash",
      parts: [c.device_id],
      tools: ["host computer", "USB cable"],
      detail: `Flash firmware/OS and load the control program onto ${c.name}.`,
      est_minutes: 25,
      risk_note: brickNotes.get(c.device_id) ?? null,
      depends_on: connectOrders.length ? connectOrders : [mountOrder],
    });
  }

  const flashOrders = steps
    .filter((s) => s.action === "flash")
    .map((s) => s.order);

  // Calibrate actuators/sensors if present.
  if (assembly.components.some((c) => c.role === "actuator" || c.role === "sensor")) {
    push({
      action: "calibrate",
      parts: assembly.components
        .filter((c) => c.role === "actuator" || c.role === "sensor")
        .map((c) => c.device_id),
      tools: ["calibration jig", "level surface"],
      detail: "Calibrate actuator zero points and sensor offsets.",
      est_minutes: 15,
      risk_note: null,
      depends_on: flashOrders.length ? flashOrders : [mountOrder],
    });
  }

  // Final bench test against the goal.
  const calibrateOrders = steps
    .filter((s) => s.action === "calibrate")
    .map((s) => s.order);
  push({
    action: "test",
    parts: assembly.components.map((c) => c.device_id),
    tools: ["bench power", "stopwatch"],
    detail: `Bench-test the assembled robot against the goal: ${assembly.goal.spec}`,
    est_minutes: 15,
    risk_note: null,
    depends_on: (calibrateOrders.length ? calibrateOrders : flashOrders) ?? [],
  });

  const total = steps.reduce((sum, s) => sum + s.est_minutes, 0);
  return BuildPlan.parse({ steps, total_minutes: total });
}

export function generateDeterministicBuildPlan(assembly: Assembly): BuildPlan {
  return deterministicBuildPlan(assembly, new Map());
}

// ── LLM pass ────────────────────────────────────────────────────────────────

// The model only refines structure; device_id/name are pinned from the catalog
// by ref so it can't invent or rename hardware.
const llmResponse = z.object({
  roles: z.array(z.object({ ref: z.string(), role: z.string() })),
  edges: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      transport: z.string(),
      payload: z.string().optional(),
    }),
  ),
  goal: z.object({
    kind: z.string(),
    spec: z.string(),
    success_metric: z.string(),
    criteria: NavigationSuccessCriteria.optional(),
  }),
  world: z.object({
    template: z.string(),
    goal_xy: z.tuple([z.number(), z.number()]).optional(),
  }),
  steps: z.array(
    z.object({
      action: z.string(),
      parts: z.array(z.string()).default([]),
      tools: z.array(z.string()).default([]),
      detail: z.string(),
      est_minutes: z.number(),
      depends_on: z.array(z.number()).default([]),
    }),
  ),
});

const SYSTEM_PROMPT = `You are the "robotic builder": you take a fixed set of hardware components and design (a) how they wire together, (b) what the robot should try to do in a physics simulation, and (c) the real-world assembly steps.

You are given components, each with a stable "ref" (c1, c2, ...), its catalog name, category, a suggested role, and known electrical interfaces. Do NOT rename components or invent new ones — only reference the refs given.

Return JSON only (no markdown) with this exact shape:
{
  "roles":  [{ "ref": "c1", "role": "compute|actuator|sensor|display|power|chassis|peripheral" }],
  "edges":  [{ "from": "c1", "to": "c2", "transport": "usb|i2c|spi|gpio|uart|wifi|ble|ros2|hdmi|aux|power", "payload": "optional, e.g. /cmd_vel" }],
  "goal":   { "kind": "navigate|locomote|manipulate|sense-act|display-loop", "spec": "one sentence", "success_metric": "measurable", "criteria": { "position_tolerance_m": 0.3, "dwell_s": 2, "max_collision_events": 0, "require_upright": true } },
  "world":  { "template": "empty-room|obstacle-course|ramp|tabletop|stairs|outdoor-flat", "goal_xy": [x, y] },
  "steps":  [{ "action": "solder|flash|glue|connect|crimp|mount|print_3d|calibrate|test", "parts": ["device_id or consumable"], "tools": ["tool"], "detail": "imperative sentence", "est_minutes": 10, "depends_on": [step numbers, 1-based] }]
}

Rules:
- Assign exactly one role per ref. A mobile base is "chassis"; a robot arm is "actuator".
- Only wire transports an endpoint actually supports when interfaces are known.
- Pick the goal kind that matches the hardware (a mobile base => navigate; an arm => manipulate; a screen => display-loop).
- For a navigate goal, always include numeric/boolean criteria. Omit criteria for other goal kinds.
- Steps must be ordered and realistic: mount/connect before flash before calibrate before test.
- Keep steps concise; 5-9 steps total.`;

function componentContext(metas: DeviceMeta[]): string {
  return metas
    .map((m, i) => {
      const cap = m.capability;
      const ifaces = cap.interfaces.length
        ? cap.interfaces.join(",")
        : "unknown";
      return `- ref: ${refFor(i)} | device_id: ${m.id} | name: ${m.name} | category: ${m.category} | suggested_role: ${m.defaultRole} | interfaces: ${ifaces}`;
    })
    .join("\n");
}

function parseLoose<T>(text: string): T | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  let candidate = fenced ? fenced[1] : trimmed;
  if (!candidate) return null;
  if (!candidate.trim().startsWith("{")) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) candidate = candidate.slice(start, end + 1);
  }
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}

// Compose a validated Assembly+BuildPlan from the LLM's loose structure. Throws
// (caught by caller) on any schema violation so we cleanly fall back.
function composeFromLlm(
  idea: string,
  metas: DeviceMeta[],
  parsed: z.infer<typeof llmResponse>,
  brickNotes: Map<string, string | null>,
): GenerateResult {
  // Coerce a loose role string to the ComponentRole enum, falling back to the
  // catalog-suggested role on any invalid token (one bad role no longer breaks
  // the whole parse).
  const roleByRef = new Map(parsed.roles.map((r) => [r.ref, r.role]));
  const components: AssemblyComponent[] = metas.map((m, i) => {
    const rawRole = roleByRef.get(refFor(i));
    const role = ComponentRole.safeParse(rawRole);
    return {
      ref: refFor(i),
      device_id: m.id,
      name: m.name,
      role: role.success ? role.data : m.defaultRole,
      sim: simulationHandleFor(m.id),
    };
  });

  const refSet = new Set(components.map((c) => c.ref));
  const metaByRef = new Map(metas.map((meta, index) => [refFor(index), meta]));
  const edgeKeys = new Set<string>();
  // Pre-filter edges: drop ones referencing unknown refs OR carrying an invalid
  // transport token. When the model picks a valid transport token that the
  // endpoints do not actually share, normalize it to the best declared shared
  // interface. This keeps protocol labels such as ROS 2 in `payload` while the
  // feasibility graph describes the real USB/Wi-Fi/I2C connection.
  const edges = parsed.edges
    .filter((e) => refSet.has(e.from) && refSet.has(e.to))
    .map((e) => {
      const requested = Transport.safeParse(e.transport);
      if (!requested.success) return null;
      const fromInterfaces = metaByRef.get(e.from)?.capability.interfaces ?? [];
      const toInterfaces = metaByRef.get(e.to)?.capability.interfaces ?? [];
      let transport = requested.data;
      if (fromInterfaces.length > 0 && toInterfaces.length > 0) {
        const requestedIsShared =
          fromInterfaces.includes(transport) && toInterfaces.includes(transport);
        if (!requestedIsShared) {
          const shared = TRANSPORT_PRIORITY.find(
            (candidate) =>
              fromInterfaces.includes(candidate) &&
              toInterfaces.includes(candidate),
          );
          if (!shared) return null;
          transport = shared;
        }
      }
      return {
        from: e.from,
        to: e.to,
        transport,
        payload: e.payload,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .filter((edge) => {
      const key = `${edge.from}\u0000${edge.to}\u0000${edge.transport}`;
      if (edgeKeys.has(key)) return false;
      edgeKeys.add(key);
      return true;
    });

  const goal =
    parsed.goal.kind === "navigate"
      ? {
          ...parsed.goal,
          criteria: parsed.goal.criteria ?? GOAL_SPEC.navigate.criteria,
        }
      : parsed.goal;

  const assembly = Assembly.parse({
    idea,
    components,
    edges,
    goal,
    world: parsed.world,
  });

  const idByRef = new Map(components.map((c) => [c.ref, c.device_id]));
  const computeIds = new Set(
    components.filter((c) => c.role === "compute").map((c) => c.device_id),
  );
  // Pre-filter steps: drop any with an invalid action token rather than letting
  // one bad step collapse the entire build plan to the deterministic fallback.
  // Re-number the survivors so `order` stays a dense 1-based sequence and
  // depends_on references remain valid.
  type ParsedStep = (typeof parsed.steps)[number];
  const validStepEntries = parsed.steps
    .map((s, originalIdx) => {
      const action = BuildAction.safeParse(s.action);
      return action.success
        ? { s, action: action.data, originalOrder: originalIdx + 1 }
        : null;
    })
    .filter(
      (e): e is { s: ParsedStep; action: BuildAction; originalOrder: number } =>
        e !== null,
    );

  // Map original 1-based order -> new dense 1-based order for depends_on remap.
  const orderRemap = new Map<number, number>();
  validStepEntries.forEach((entry, idx) => {
    orderRemap.set(entry.originalOrder, idx + 1);
  });

  const steps: BuildStep[] = validStepEntries.map((entry, idx) => ({
    order: idx + 1,
    action: entry.action,
    parts: entry.s.parts.map((p) => idByRef.get(p) ?? p),
    tools: entry.s.tools,
    detail: entry.s.detail,
    est_minutes: Math.max(1, Math.round(entry.s.est_minutes)),
    risk_note:
      entry.action === "flash"
        ? // attach the brick disclaimer for any compute device flashed here
          firstBrickNote(entry.s.parts, idByRef, computeIds, brickNotes)
        : null,
    depends_on: entry.s.depends_on
      .map((d) => orderRemap.get(d))
      .filter((d): d is number => d !== undefined && d >= 1),
  }));

  const build_plan = BuildPlan.parse({
    steps,
    total_minutes: steps.reduce((sum, s) => sum + s.est_minutes, 0),
  });

  return { assembly, build_plan, degraded: false };
}

function firstBrickNote(
  parts: string[],
  idByRef: Map<string, string>,
  computeIds: Set<string>,
  brickNotes: Map<string, string | null>,
): string | null {
  for (const p of parts) {
    const id = idByRef.get(p) ?? p;
    if (computeIds.has(id)) {
      const note = brickNotes.get(id);
      if (note) return note;
    }
  }
  return null;
}

type AssemblyTextGenerator = (request: {
  model: ReturnType<typeof anthropic>;
  system: string;
  prompt: string;
  temperature: number;
}) => Promise<{ text: string }>;

export interface GenerateAssemblyOptions {
  generateText?: AssemblyTextGenerator;
}

export async function generateAssembly(
  idea: string,
  deviceIds: string[],
  options?: GenerateAssemblyOptions,
): Promise<GenerateResult> {
  const metas = resolveMetas(deviceIds);
  if (metas.length === 0) {
    throw new Error("none of the provided device_ids were found in the catalog");
  }
  const brickNotes = brickNoteIndex();

  const fallback = (): GenerateResult => {
    const assembly = deterministicAssembly(idea, metas);
    return {
      assembly,
      build_plan: deterministicBuildPlan(assembly, brickNotes),
      degraded: true,
    };
  };

  const modelId = process.env.HACKSHOP_MODEL ?? "claude-haiku-4-5-20251001";
  const userPrompt = [
    `Project idea: ${idea}`,
    "",
    "Fixed components (do not rename or add):",
    componentContext(metas),
  ].join("\n");

  let raw: string;
  try {
    const textGenerator: AssemblyTextGenerator =
      options?.generateText ?? (async (request) => generateText(request));
    const result = await textGenerator({
      model: anthropic(modelId),
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0.3,
    });
    raw = result.text;
  } catch {
    return fallback();
  }

  const loose = parseLoose<unknown>(raw);
  const parsed = llmResponse.safeParse(loose);
  if (!parsed.success) return fallback();

  try {
    return composeFromLlm(idea, metas, parsed.data, brickNotes);
  } catch {
    return fallback();
  }
}
