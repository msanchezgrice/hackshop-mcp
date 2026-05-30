import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────
// simulate_assembly — hand an Assembly IR to the physics worker and get back a
// bounded, synchronous verdict: did the robot reach its goal, and the honest
// failure theatre (stuck / tipped / collisions) if it didn't.
//
// Compact mirror of site/lib/assembly.ts `Assembly` (kept loose on purpose; the
// Python worker re-validates with Pydantic). Bounded mode caps duration + render
// so this stays usable inside a single tool call.
// ─────────────────────────────────────────────────────────────────────────

const Transport = z.enum([
  "usb", "i2c", "spi", "gpio", "uart", "wifi", "ble", "ros2", "hdmi", "aux", "power",
]);

const AssemblyComponent = z.object({
  ref: z.string().min(1),
  device_id: z.string().min(1),
  name: z.string().min(1),
  role: z.enum([
    "compute", "actuator", "sensor", "display", "power", "chassis", "peripheral",
  ]),
});

const ProtocolEdge = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  transport: Transport,
  payload: z.string().optional(),
});

const Assembly = z.object({
  idea: z.string().min(1),
  components: z.array(AssemblyComponent).min(1),
  edges: z.array(ProtocolEdge).default([]),
  goal: z.object({
    kind: z.enum(["navigate", "locomote", "manipulate", "sense-act", "display-loop"]),
    spec: z.string().min(1),
    success_metric: z.string().min(1),
  }),
  world: z.object({
    template: z.enum([
      "empty-room", "obstacle-course", "ramp", "stairs", "outdoor-flat", "tabletop",
    ]),
    goal_xy: z.tuple([z.number(), z.number()]).optional(),
  }),
});

export const simulateAssemblyInput = z.object({
  assembly: Assembly,
  duration_s: z.number().positive().max(10).optional(),
});

export type SimulateAssemblyInput = z.infer<typeof simulateAssemblyInput>;

interface WorkerJob {
  job_id: string;
  status: string;
  error?: string;
  result?: {
    status: string;
    supported: boolean;
    reason?: string;
    success?: boolean;
    summary?: string;
    post_mortem?: string;
    authored_by?: string;
    metric_value?: number;
    telemetry?: Record<string, unknown>;
    world_desc?: string;
    artifacts?: Record<string, string>;
    robot?: Record<string, unknown>;
  };
}

export interface SimulateAssemblyOutput {
  status: "ok" | "unsupported" | "error" | "unavailable";
  message?: string;
  success?: boolean;
  summary?: string;
  post_mortem?: string;
  authored_by?: string;
  metric_value?: number;
  telemetry?: Record<string, unknown>;
  world_desc?: string;
  artifacts?: Record<string, string>;
  robot?: Record<string, unknown>;
}

function workerBase(): string {
  return (process.env.SIM_WORKER_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
}

export async function simulateAssembly(
  input: SimulateAssemblyInput,
): Promise<SimulateAssemblyOutput> {
  const body = {
    assembly: input.assembly,
    options: {
      mode: "sync",
      bounded: true,
      render: true,
      agent: false,
      duration_s: input.duration_s ?? 8.0,
    },
  };

  let job: WorkerJob;
  try {
    const res = await fetch(`${workerBase()}/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return {
        status: "error",
        message: `Simulation worker returned ${res.status}: ${(await res.text()).slice(0, 200)}`,
      };
    }
    job = (await res.json()) as WorkerJob;
  } catch (err) {
    return {
      status: "unavailable",
      message:
        "Could not reach the simulation worker. Set SIM_WORKER_URL and ensure the " +
        `sim-worker is running. (${err instanceof Error ? err.message : "fetch failed"})`,
    };
  }

  if (job.status === "error" || !job.result) {
    return { status: "error", message: job.error ?? "Simulation failed with no result." };
  }

  const r = job.result;
  if (!r.supported) {
    return {
      status: "unsupported",
      message: r.reason ?? "This assembly/goal isn't simulatable yet.",
      world_desc: r.world_desc,
    };
  }

  return {
    status: "ok",
    success: r.success,
    summary: r.summary,
    post_mortem: r.post_mortem,
    authored_by: r.authored_by,
    metric_value: r.metric_value,
    telemetry: r.telemetry,
    world_desc: r.world_desc,
    artifacts: r.artifacts,
    robot: r.robot,
  };
}
