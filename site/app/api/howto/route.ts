import { NextResponse } from "next/server";
import { z } from "zod";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { loadCatalog } from "@/lib/catalog";
import { UNRECOVERABLE_BRICK_CATEGORIES } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const howtoInput = z.object({
  device_id: z.string().min(1).max(100),
  idea: z.string().min(3).max(2000).optional(),
});

// Tiny in-memory cache: per device + idea bucket. Cuts repeat-query cost by
// ~10x; lost on cold start, which is fine for V0. Bounded with LRU eviction so
// distinct (device, idea) pairs can't grow the map without limit.
const cache = new Map<string, { generated_at: number; markdown: string }>();
const CACHE_MS = 24 * 60 * 60 * 1000; // 1 day
const MAX_CACHE_ENTRIES = 200;

function cacheSet(key: string, markdown: string): void {
  cache.delete(key);
  cache.set(key, { generated_at: Date.now(), markdown });
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

const SYSTEM_PROMPT = `You are a hardware-literate guide for tinkerers. Given a device and (optionally) a project idea, write a 5-10 step walkthrough to get from "have the device" to "running the project."

Format: numbered list, each step is one paragraph (1-3 sentences). Include:
- exact commands or app names where relevant
- expected runtime per step (e.g. "~10 min")
- the most likely pitfall and how to recover from it

Constraints:
- Open with a one-line "What you need" list (the device + cables + tools).
- Close with a "What can go wrong" section listing 2-3 failure modes.
- Markdown only. No code fences around the whole document.
- Don't link to specific external URLs you're not sure about; reference doc names instead (e.g. "the official Espressif quickstart").
- If the user provides an idea, tailor the walkthrough to it. Otherwise give the generic getting-started.`;

const SAFETY_REFUSAL = `# Cannot generate guide

This device's brick risk is LLM-inferred (no founder-verified or community-verified data). For hardware classes where bricks are unrecoverable (handhelds, single-board computers), we don't generate guides on inferred data — the cost of being wrong is too high.

**What to do instead:**
- Search the linked community forums for a vetted walkthrough
- Check 3ds.hacks.guide, mobileread, XDA, or the manufacturer wiki
- Verify with at least 3 sources before flashing
`;

export async function POST(req: Request): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Server is not configured: ANTHROPIC_API_KEY missing." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = howtoInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const { devices } = loadCatalog();
  const device = devices.find((d) => d.id === parsed.data.device_id);
  if (!device) {
    return NextResponse.json(
      { error: `Device "${parsed.data.device_id}" not in catalog.` },
      { status: 404 },
    );
  }

  // Brick-risk safety: refuse to generate guides for hardware classes where
  // bricks are unrecoverable AND we don't have authoritative provenance.
  if (
    device.brick_provenance === "llm-inferred" &&
    UNRECOVERABLE_BRICK_CATEGORIES.has(device.category)
  ) {
    return NextResponse.json({
      device_id: device.id,
      device_name: device.name,
      markdown: SAFETY_REFUSAL,
      cached: false,
      refused: true,
    });
  }

  const cacheKey = `${parsed.data.device_id}::${parsed.data.idea ?? ""}`;
  const hit = cache.get(cacheKey);
  if (hit) {
    if (Date.now() - hit.generated_at < CACHE_MS) {
      // Refresh LRU position on hit.
      cache.delete(cacheKey);
      cache.set(cacheKey, hit);
      return NextResponse.json({
        device_id: device.id,
        device_name: device.name,
        markdown: hit.markdown,
        cached: true,
      });
    }
    // Stale: evict on read so it doesn't keep occupying a slot.
    cache.delete(cacheKey);
  }

  const userPrompt = [
    `Device: ${device.name} (id: ${device.id}, category: ${device.category})`,
    `Difficulty rating: ${device.hack_difficulty}/5`,
    `Brick risk: ${device.brick_risk}/5 (${device.brick_provenance})`,
    parsed.data.idea ? `\nProject idea: ${parsed.data.idea}` : null,
    `\nFirmware/community references: ${device.firmware_links.join(", ") || "(none cataloged)"}`,
    `\nNotes from catalog: ${device.notes}`,
  ]
    .filter(Boolean)
    .join("\n");

  let markdown: string;
  try {
    const result = await generateText({
      model: anthropic(
        process.env.HACKSHOP_MODEL ?? "claude-haiku-4-5-20251001",
      ),
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0.4,
    });
    markdown = result.text.trim();
  } catch (err) {
    return NextResponse.json(
      { error: `LLM call failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  cacheSet(cacheKey, markdown);

  return NextResponse.json({
    device_id: device.id,
    device_name: device.name,
    markdown,
    cached: false,
  });
}
