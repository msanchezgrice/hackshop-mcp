import { NextResponse } from "next/server";
import { z } from "zod";
import OpenAI from "openai";
import { loadCatalog } from "@/lib/catalog";

export const runtime = "nodejs";
// gpt-image-2 with the 4-zone schematic prompt can take 20-90s for complex
// prompts. Vercel Fluid Compute default ceiling is 300s on all plans — use it.
export const maxDuration = 300;

const diagramInput = z.object({
  idea: z.string().min(3).max(2000),
  device_ids: z.array(z.string()).max(8).optional(),
});

// Per-process cache. Same idea+devices -> same image. Lost on cold start
// (acceptable; restarts are rare and image gen is the cheapest part of the
// flow when amortized across a CDN-cached <img> request).
const cache = new Map<string, { png_b64: string; generated_at: number }>();
const CACHE_MS = 24 * 60 * 60 * 1000;

// High-fidelity technical schematic prompt. Tested on gpt-image-2; produces
// architecture diagram + BOM + setup steps in one canvas with readable text.
function buildPrompt(idea: string, deviceNames: string[]): string {
  const titleHint = idea.slice(0, 80);
  const components =
    deviceNames.length > 0
      ? deviceNames.join(", ")
      : "(let the model pick reasonable components for the project)";

  return [
    `Create a high-fidelity technical schematic for a DIY maker project. Style: clean flat-design technical drawing inspired by modern Figma whiteboards and architecture diagrams. NO photo-realism, NO gradients, NO drop shadows.`,
    "",
    `BACKGROUND: solid dark navy (#0a0a0a). LINE ART: white (#f5f5f5) and accent orange (#f97316) only. Thin crisp lines (1-2px). All text must be sharp and legible.`,
    "",
    `LAYOUT — divide the 1024×1024 canvas into four zones:`,
    "",
    `1. TOP STRIP (top 8%): project title in clean white sans-serif, centered.`,
    `   Title text: "${titleHint}"`,
    "",
    `2. MAIN AREA (middle 60%): the architecture diagram.`,
    `   - Each hardware component drawn as a rounded rectangle with the device name inside it.`,
    `   - Arrows between components showing DATA FLOW direction (input → processing → output).`,
    `   - Each arrow labeled with the protocol/transport: "USB", "I²C", "GPIO", "Wi-Fi", "BLE", "SPI", "HDMI", "3.5mm aux", etc — pick what fits.`,
    `   - Each component box has a one-line annotation underneath in smaller text describing its role (e.g. "Pi Zero W — fetches calendar over Wi-Fi, refreshes display once/hour").`,
    `   - Use simple geometric icons inside each box (rectangle for SBC, circle for sensor, monitor-shape for display) — no photorealistic device renders.`,
    "",
    `3. BOTTOM-LEFT QUADRANT (bottom 32%, left half): "BILL OF MATERIALS" header in orange uppercase. Below it, a bulleted list of every part needed with quantities, one per line. Format: "• <part name> ×<qty>". Include cables and adapters, not just the main devices.`,
    "",
    `4. BOTTOM-RIGHT QUADRANT (bottom 32%, right half): "SETUP STEPS" header in orange uppercase. Below it, 4-5 numbered steps, each one short imperative sentence. Format: "1. <verb + object>". Examples: "1. Flash Pi OS Lite to SD card", "2. Wire HAT via GPIO ribbon", "3. Run install.sh".`,
    "",
    `PROJECT IDEA: "${idea}"`,
    "",
    `COMPONENTS TO USE (use these exact names in the diagram): ${components}`,
    "",
    `IMPORTANT:`,
    `- Every label must be readable at full resolution.`,
    `- Maintain whitespace; don't crowd.`,
    `- The diagram should TEACH a tinkerer how the build fits together at a glance.`,
    `- Do NOT add legal disclaimers, watermarks, or signatures.`,
  ].join("\n");
}

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

  const prompt = buildPrompt(parsed.data.idea, named);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let png_b64: string;
  try {
    const result = await client.images.generate({
      // .trim() guards against env values pushed via `echo "..." | vercel env add`
      // which can capture the trailing newline.
      model: (process.env.HACKSHOP_IMAGE_MODEL ?? "gpt-image-2").trim(),
      prompt,
      size: "1024x1024",
      n: 1,
      // medium quality cuts generation time ~2-3x vs auto/high. Diagrams
      // are line art with text — they don't need photoreal fidelity.
      quality: "medium",
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
