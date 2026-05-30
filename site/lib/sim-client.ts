import "server-only";

import { z } from "zod";
import { Assembly, BuildPlan } from "./assembly";

// ─────────────────────────────────────────────────────────────────────────
// Server-side client for the Python sim-worker (MuJoCo physics + render).
//
// The worker is a separate process (native deps: mujoco, ffmpeg) reachable at
// SIM_WORKER_URL. The Next API routes proxy to it: POST kicks a job, GET polls.
// Artifact URLs come back absolute (worker host, CORS-open) so the browser can
// play the mp4 directly without us streaming bytes through the edge.
// ─────────────────────────────────────────────────────────────────────────

// Per-component image reference forwarded to the worker so it can fetch the
// photo server-side and bake it into the shareable summary.
export const componentMedia = z.object({
  ref: z.string().min(1),
  image_url: z.string().url(),
});

export const simulateInput = z.object({
  assembly: Assembly,
  options: z
    .object({
      duration_s: z.number().positive().max(60).optional(),
      render: z.boolean().optional(),
      agent: z.boolean().optional(),
      agent_max_iters: z.number().int().min(1).max(6).optional(),
      seed: z.number().int().optional(),
    })
    .optional(),
  // Optional summary enrichment (worker forwards into summary.html; not simulated).
  build_plan: BuildPlan.optional(),
  media: z.array(componentMedia).default([]),
});
export type SimulateInput = z.infer<typeof simulateInput>;

export interface SimArtifacts {
  video?: string;
  poster?: string;
  hero?: string; // high-fidelity studio render
  schematic?: string; // wiring SVG
  summary?: string;
  telemetry?: string;
  trajectory?: string;
  control?: string;
  scene?: string;
}

export interface SimResult {
  status: "ok" | "unsupported";
  supported: boolean;
  reason?: string;
  success?: boolean;
  metric_value?: number;
  summary?: string;
  post_mortem?: string;
  authored_by?: string;
  iterations?: number;
  telemetry?: Record<string, unknown>;
  robot?: {
    device_id: string;
    kind: string;
    provenance: string;
    base_mass_kg: number;
    total_mass_kg: number;
    mounted_parts: {
      ref: string;
      name: string;
      role: string;
      mass_kg: number;
    }[];
    notes?: string;
  };
  world_desc?: string;
  artifacts: SimArtifacts;
  video_available?: boolean;
}

export type SimJobStatus = "queued" | "running" | "done" | "error";

export interface SimJob {
  job_id: string;
  status: SimJobStatus;
  created_at?: number;
  finished_at?: number | null;
  error?: string;
  result?: SimResult;
}

function workerBase(): string {
  return (process.env.SIM_WORKER_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
}

/** True when a worker URL is configured (prod) or we're in local dev. */
export function simWorkerConfigured(): boolean {
  return Boolean(process.env.SIM_WORKER_URL) || process.env.NODE_ENV !== "production";
}

export async function kickSimulation(
  input: SimulateInput,
  { sync = false }: { sync?: boolean } = {},
): Promise<SimJob> {
  const opts = input.options ?? {};
  const res = await fetch(`${workerBase()}/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      assembly: input.assembly,
      options: {
        mode: sync ? "sync" : "async",
        render: true,
        ...opts,
      },
      build_plan: input.build_plan,
      media: input.media ?? [],
    }),
  });
  if (!res.ok) {
    throw new Error(`sim-worker ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as SimJob;
}

export async function pollSimulation(jobId: string): Promise<SimJob> {
  const res = await fetch(`${workerBase()}/simulate/${encodeURIComponent(jobId)}`, {
    cache: "no-store",
  });
  if (res.status === 404) throw new Error("job not found");
  if (!res.ok) {
    throw new Error(`sim-worker ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as SimJob;
}
