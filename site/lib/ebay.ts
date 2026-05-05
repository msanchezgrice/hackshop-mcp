import "server-only";

// Optional eBay Browse API integration. Activates only when both
// EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are set in env. Without them,
// proposals fall back to URL-only mode (no live listing data).
//
// Provisioning credentials:
//   1. Create an eBay Developer account at developer.ebay.com
//   2. Create an app, get App ID (Client ID) + Cert ID (Client Secret)
//   3. Sandbox -> Production keyset migration takes 1-2 days
//   4. Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in Vercel env

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

async function getEbayToken(): Promise<string | null> {
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) return null;

  // Cache token within instance memory; eBay tokens last 7,200 seconds (2h).
  // Refresh 60s before expiry to avoid mid-request expiration.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const auth = Buffer.from(`${id}:${secret}`).toString("base64");
  try {
    const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[ebay] OAuth token request failed: ${res.status} ${body}`);
      return null;
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return cachedToken.token;
  } catch (err) {
    console.error(`[ebay] OAuth fetch error: ${(err as Error).message}`);
    return null;
  }
}

export interface EbayLiveData {
  count: number;
  min_price_usd: number | null;
  currency: string | null;
  sample_url: string | null;
}

export function isEbayConfigured(): boolean {
  return Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);
}

export async function fetchEbayLiveData(query: string): Promise<EbayLiveData | null> {
  const token = await getEbayToken();
  if (!token) return null;

  // Browse API search. Filters: BuyItNow only, condition Used or Refurbished,
  // limit small (we only need totals + a sample of cheapest items).
  const url =
    "https://api.ebay.com/buy/browse/v1/item_summary/search" +
    `?q=${encodeURIComponent(query)}` +
    "&limit=10" +
    "&filter=" +
    encodeURIComponent("buyingOptions:{FIXED_PRICE},conditions:{USED|CERTIFIED_REFURBISHED|SELLER_REFURBISHED}") +
    "&sort=price";

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      total?: number;
      itemSummaries?: Array<{
        price?: { value?: string; currency?: string };
        itemWebUrl?: string;
      }>;
    };

    const total = typeof data.total === "number" ? data.total : 0;
    const items = data.itemSummaries ?? [];

    let minPrice: number | null = null;
    let currency: string | null = null;
    let sampleUrl: string | null = null;
    for (const item of items) {
      const v = parseFloat(item.price?.value ?? "");
      if (Number.isFinite(v)) {
        if (minPrice === null || v < minPrice) {
          minPrice = v;
          currency = item.price?.currency ?? null;
          sampleUrl = item.itemWebUrl ?? null;
        }
      }
    }

    return {
      count: total,
      min_price_usd: minPrice,
      currency,
      sample_url: sampleUrl,
    };
  } catch (err) {
    console.error(`[ebay] search error: ${(err as Error).message}`);
    return null;
  }
}
