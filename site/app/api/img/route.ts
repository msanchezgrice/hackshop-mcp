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

// Bound the upstream fetch so a slow/hung CDN can't pin the function until its
// maxDuration ceiling. Device thumbnails are small; 8s is generous.
const UPSTREAM_TIMEOUT_MS = 8_000;
// Reject oversized payloads (defends the function from buffering a huge file
// and from being used as a generic proxy). 10 MB is far above any device photo.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

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
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const aborted =
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError");
    return NextResponse.json(
      {
        error: aborted
          ? `upstream image fetch timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s`
          : `upstream fetch failed: ${(err as Error).message}`,
      },
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

  // Reject anything that declares itself too large before we buffer it.
  const declaredLength = Number(upstream.headers.get("Content-Length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `upstream image too large (${declaredLength} bytes > ${MAX_IMAGE_BYTES})` },
      { status: 502 },
    );
  }

  const passthroughHeaders: HeadersInit = {
    "Content-Type": contentType,
    ...CACHE_HEADERS,
  };

  // Prefer streaming the upstream body straight through (no buffering) when the
  // platform gives us a readable stream. Only fall back to buffering when the
  // upstream omitted Content-Length, so we can enforce the size cap ourselves.
  if (upstream.body && declaredLength) {
    return new Response(upstream.body, {
      status: 200,
      headers: { ...passthroughHeaders, "Content-Length": String(declaredLength) },
    });
  }

  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `upstream image too large (${bytes.byteLength} bytes > ${MAX_IMAGE_BYTES})` },
      { status: 502 },
    );
  }
  return new Response(bytes, {
    status: 200,
    headers: passthroughHeaders,
  });
}
