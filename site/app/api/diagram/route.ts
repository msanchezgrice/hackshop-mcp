import { NextResponse } from "next/server";
import { z } from "zod";
import OpenAI from "openai";
import { loadCatalog } from "@/lib/catalog";

export const runtime = "nodejs";
// Image generation can take 10-30s. Fluid Compute default 300s ceiling
// is way more than we need.
export const maxDuration = 90;

const diagramInput = z.object({
  idea: z.string().min(3).max(2000),
  device_ids: z.array(z.string()).max(8).optional(),
});

// Per-process cache. Same idea+devices -> same image. Lost on cold start
// (acceptable; restarts are rare and image gen is the cheapest part of the
// flow when amortized across a CDN-cached <img> request).
const cache = new Map<string, { png_b64: string; generated_at: number }>();
const CACHE_MS = 24 * 60 * 60 * 1000;

const SYSTEM_DIRECTION = `Create a clean, monochrome blueprint-style technical diagram on a dark navy background. White and orange line art only. Show data flow / wiring / step sequence with labeled boxes and arrows. No photo-realism, no decorative elements, no shadows. Architecture-diagram style. Include device names as text labels.`;

export async function POST(req: Request): Promise<Response> {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        error:
          "Diagram generation is not enabled on this deployment. Set OPENAI_API_KEY in Vercel env to activate.",
        configured: false,
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = diagramInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const { devices } = loadCatalog();
  const named = (parsed.data.device_ids ?? [])
    .map((id) => devices.find((d) => d.id === id)?.name)
    .filter((n): n is string => !!n);

  const cacheKey = `${parsed.data.idea}::${named.join(",")}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.generated_at < CACHE_MS) {
    return NextResponse.json({
      image_b64: hit.png_b64,
      cached: true,
    });
  }

  const prompt = [
    SYSTEM_DIRECTION,
    "",
    `Project: ${parsed.data.idea}`,
    named.length > 0
      ? `Devices to include in the diagram: ${named.join(", ")}.`
      : "Devices: pick what makes sense for the project.",
    "Show: input -> processing -> output, with the role of each device labeled.",
  ].join("\n");

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let png_b64: string;
  try {
    const result = await client.images.generate({
      model: process.env.HACKSHOP_IMAGE_MODEL ?? "gpt-image-1",
      prompt,
      size: "1024x1024",
      n: 1,
    });
    const first = result.data?.[0];
    if (!first?.b64_json) {
      return NextResponse.json(
        { error: "OpenAI returned no image data" },
        { status: 502 },
      );
    }
    png_b64 = first.b64_json;
  } catch (err) {
    return NextResponse.json(
      { error: `OpenAI image generation failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  cache.set(cacheKey, { png_b64, generated_at: Date.now() });

  return NextResponse.json({
    image_b64: png_b64,
    cached: false,
  });
}
