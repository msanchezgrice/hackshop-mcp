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

// Resolved worker base. When SIM_WORKER_URL is unset we keep a localhost
// default so a developer running the worker locally can hit it — but
// simWorkerConfigured() below still reports false in that case, so the API
// routes return an honest 503 ("not enabled") instead of attempting a kick
// that would 502 against a worker nobody started.
function workerBase(): string {
  return (process.env.SIM_WORKER_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
}

/**
 * True ONLY when SIM_WORKER_URL is set. Previously this also returned true in
 * any non-production env, which made non-prod report configured:true with no
 * worker — every kick then 502'd against the localhost default. Gating purely
 * on the env var keeps "configured" honest in all environments.
 */
export function simWorkerConfigured(): boolean {
  return Boolean(process.env.SIM_WORKER_URL);
}

// Client-side fetch timeouts. The worker can be slow (cold MuJoCo + ffmpeg) but
// an unbounded fetch leaves the API route hanging until the function ceiling.
const KICK_TIMEOUT_MS = 15_000;
const POLL_TIMEOUT_MS = 10_000;

/** True when a fetch failure is an AbortSignal.timeout() firing. */
function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

export async function kickSimulation(
  input: SimulateInput,
  { sync = false }: { sync?: boolean } = {},
): Promise<SimJob> {
  const opts = input.options ?? {};
  let res: Response;
  try {
    res = await fetch(`${workerBase()}/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(KICK_TIMEOUT_MS),
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
  } catch (err) {
    if (isAbortError(err)) {
      throw new Error(
        `sim-worker unavailable: kick timed out after ${KICK_TIMEOUT_MS / 1000}s`,
      );
    }
    throw new Error(
      `sim-worker unavailable: ${err instanceof Error ? err.message : "fetch failed"}`,
    );
  }
  if (!res.ok) {
    throw new Error(`sim-worker ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as SimJob;
}

export async function pollSimulation(jobId: string): Promise<SimJob> {
  let res: Response;
  try {
    res = await fetch(`${workerBase()}/simulate/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });
  } catch (err) {
    if (isAbortError(err)) {
      throw new Error(
        `sim-worker unavailable: poll timed out after ${POLL_TIMEOUT_MS / 1000}s`,
      );
    }
    throw new Error(
      `sim-worker unavailable: ${err instanceof Error ? err.message : "fetch failed"}`,
    );
  }
  if (res.status === 404) throw new Error("job not found");
  if (!res.ok) {
    throw new Error(`sim-worker ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as SimJob;
}
