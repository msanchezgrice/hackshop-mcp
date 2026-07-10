import { NextResponse } from "next/server";
import { assemblyInput, type AssemblyResponse } from "@/lib/assembly";
import {
  generateAssembly,
  generateDeterministicBuildPlan,
} from "@/lib/assembly-gen";
import { resolveBuildCandidateSelection } from "@/lib/build-candidates";
import { capabilityMapFor } from "@/lib/capabilities";
import { checkFeasibility } from "@/lib/feasibility";

export const runtime = "nodejs";
export const maxDuration = 60;

// Same naive in-process limiter as /api/propose. Separate bucket namespace so
// the two endpoints don't share a budget.
const SKIP = process.env.SKIP_RATE_LIMIT === "true";
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_PER_HOUR ?? "200", 10);
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
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const limit = rateLimit(ip);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: `Rate limit hit. Try again in ${limit.resetIn}s. (${RATE_LIMIT} requests/hour per IP.)`,
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

  const parsed = assemblyInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  let gen;
  try {
    if (parsed.data.candidate_id) {
      const candidate = resolveBuildCandidateSelection(
        parsed.data.idea,
        parsed.data.candidate_id,
        parsed.data.device_ids,
      );
      if (!candidate) {
        throw new Error(
          "candidate_id does not match a supported canonical build",
        );
      }
      gen = {
        assembly: candidate.assembly,
        build_plan: generateDeterministicBuildPlan(candidate.assembly),
        degraded: false,
      };
    } else {
      gen = await generateAssembly(parsed.data.idea, parsed.data.device_ids);
    }
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to generate an assembly for those devices.",
      },
      { status: 422 },
    );
  }

  // Feasibility is deterministic and always runs over the (possibly LLM-built)
  // assembly so the verdict reflects exactly what's shown.
  const deviceIds = gen.assembly.components.map((c) => c.device_id);
  const caps = capabilityMapFor(deviceIds);
  const feasibility = checkFeasibility(gen.assembly, caps);

  const response: AssemblyResponse = {
    assembly: gen.assembly,
    build_plan: gen.build_plan,
    feasibility,
    degraded: gen.degraded,
    message: gen.degraded
      ? "Generated with the deterministic fallback (LLM unavailable or invalid)."
      : undefined,
  };
  return NextResponse.json(response);
}
