import { NextResponse } from "next/server";
import {
  kickSimulation,
  simulateInput,
  simWorkerConfigured,
} from "@/lib/sim-client";

export const runtime = "nodejs";
export const maxDuration = 60;

// Naive in-process limiter (own bucket namespace). Simulation kicks are cheap
// here (the heavy MuJoCo work happens in the worker), but cap abuse anyway.
const SKIP = process.env.SKIP_RATE_LIMIT === "true";
const RATE_LIMIT = parseInt(process.env.SIM_RATE_LIMIT_PER_HOUR ?? "60", 10);
const RATE_WINDOW_MS = 60 * 60 * 1000;
const buckets = new Map<string, { count: number; resetAt: number }>();
// Opportunistic eviction: bound the per-IP bucket map so it can't leak one
// entry per distinct IP forever. Prune expired buckets past this threshold.
const MAX_BUCKETS = 10_000;

function pruneExpiredBuckets(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [ip, b] of buckets) {
    if (b.resetAt < now) buckets.delete(ip);
  }
}

function rateLimit(ip: string): { ok: true } | { ok: false; resetIn: number } {
  if (SKIP) return { ok: true };
  const now = Date.now();
  pruneExpiredBuckets(now);
  const b = buckets.get(ip);
  if (!b || b.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { ok: true };
  }
  if (b.count >= RATE_LIMIT) {
    return { ok: false, resetIn: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count += 1;
  return { ok: true };
}

export async function POST(req: Request): Promise<Response> {
  if (!simWorkerConfigured()) {
    return NextResponse.json(
      {
        error:
          "Physics simulation isn't enabled on this deployment yet (needs SIM_WORKER_URL).",
        configured: false,
      },
      { status: 503 },
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const limit = rateLimit(ip);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: `Rate limit hit. Try again in ${limit.resetIn}s. (${RATE_LIMIT} simulations/hour per IP.)`,
      },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = simulateInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  try {
    const job = await kickSimulation(parsed.data);
    return NextResponse.json(job);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Could not reach the simulation worker: ${err.message}`
            : "Could not reach the simulation worker.",
      },
      { status: 502 },
    );
  }
}
