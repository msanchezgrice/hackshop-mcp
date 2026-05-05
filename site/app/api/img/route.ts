import { NextResponse } from "next/server";
import { IMAGE_SOURCES } from "@/lib/image-sources";

export const runtime = "nodejs";

// Vercel Fluid Compute respects this for the function timeout. Image fetches
// are quick (<2s); 30s ceiling is plenty even for cold starts.
export const maxDuration = 30;

// Image proxy. Front-end links to /api/img?slug=<device_id>; we fetch the
// upstream URL server-side (no browser referer) and stream bytes back with
// aggressive CDN caching. This works around Wikipedia/manufacturer hotlink
// blocking and gives us one stable URL pattern across the site.

const FETCH_HEADERS: HeadersInit = {
  // Many CDNs (including Wikipedia's Varnish layer) reject default fetch UA.
  "User-Agent":
    "Mozilla/5.0 hackshop-mcp/0.0.4 (+https://github.com/msanchezgrice/hackshop-mcp)",
  Accept: "image/avif,image/webp,image/png,image/jpeg,image/*",
};

// 24h shared cache + 7d stale-while-revalidate. Vercel's edge respects this;
// once an image is in the CDN, subsequent requests don't even hit our function.
const CACHE_HEADERS: HeadersInit = {
  "Cache-Control":
    "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800, immutable",
};

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");

  if (!slug) {
    return NextResponse.json({ error: "slug query param required" }, { status: 400 });
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ error: "invalid slug format" }, { status: 400 });
  }

  const sourceUrl = IMAGE_SOURCES[slug];
  if (!sourceUrl) {
    // No source mapped. UI should hide the <img> when this 404s.
    return new Response(null, { status: 404, headers: CACHE_HEADERS });
  }

  let upstream: Response;
  try {
    upstream = await fetch(sourceUrl, {
      headers: FETCH_HEADERS,
      // Follow Wikipedia's Special:FilePath redirect chain.
      redirect: "follow",
    });
  } catch (err) {
    return NextResponse.json(
      { error: `upstream fetch failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    return new Response(null, { status: upstream.status, headers: CACHE_HEADERS });
  }

  const contentType = upstream.headers.get("Content-Type") ?? "image/jpeg";
  if (!contentType.startsWith("image/")) {
    return NextResponse.json(
      { error: `upstream returned non-image content-type: ${contentType}` },
      { status: 502 },
    );
  }

  const bytes = await upstream.arrayBuffer();
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      ...CACHE_HEADERS,
    },
  });
}
