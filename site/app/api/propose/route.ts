import { NextResponse } from "next/server";
import { proposeInput } from "@/lib/types";
import { loadCatalog } from "@/lib/catalog";
import { propose } from "@/lib/propose";
import { loadPremiumCatalog, proposePremium } from "@/lib/premium";

export const runtime = "nodejs";
// Per Vercel knowledge: default function timeout is 300s on Fluid Compute.
// This endpoint typically returns in 3-8s with Haiku. 60s ceiling is plenty.
export const maxDuration = 60;

// Naive in-process rate limit. A single Fluid Compute instance reuses memory
// across concurrent invocations, so this catches the common abuse pattern.
// For production, swap for Upstash Redis / Vercel KV via the marketplace.
const RATE_LIMIT = 5; // requests
const RATE_WINDOW_MS = 60 * 60 * 1000; // per hour
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string): { ok: true } | { ok: false; resetIn: number } {
  const now = Date.now();
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
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Server is not configured: ANTHROPIC_API_KEY missing." },
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
        error: `Rate limit hit. Try again in ${limit.resetIn}s. (5 requests/hour per IP.)`,
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

  const parsed = proposeInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const { devices } = loadCatalog();

  // Run primary (used hardware) and premium (open-source new) in parallel
  // when include_premium is set. Used hardware is the lead path either way.
  const [result, premiumProposals] = await Promise.all([
    propose(parsed.data, devices),
    parsed.data.include_premium
      ? proposePremium(parsed.data.idea, loadPremiumCatalog()).catch(() => [])
      : Promise.resolve([]),
  ]);

  if (parsed.data.include_premium) {
    result.premium_proposals = premiumProposals;
  }

  return NextResponse.json(result);
}
