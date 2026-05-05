// Master map of device_id -> upstream image URL.
//
// The /api/img?slug= proxy reads this, fetches the source server-side
// (no browser referer to be blocked by anti-hotlink), and serves bytes
// with a 24h Vercel CDN cache + 7-day stale-while-revalidate.
//
// Adding a new entry: probe with curl first to confirm 200. Examples that
// work today follow these patterns:
//
//   Wikipedia (preferred — stable, survives image renames):
//     https://en.wikipedia.org/wiki/Special:FilePath/<File_Name>.jpg?width=640
//
//   Adafruit shop CDN (works for all their products):
//     https://cdn-shop.adafruit.com/970x728/<sku>.jpg
//
// What does NOT work (blocked or unstable):
//   upload.wikimedia.org/wikipedia/commons/thumb/...  (referrer-restricted)
//   shop.pimoroni.com/cdn/shop/products/...           (Shopify hashed paths rot)
//   m.media-amazon.com/images/...                     (Amazon hotlink-blocks)
//   huggingface.co/datasets/.../resolve/main/...      (auth required)

export const IMAGE_SOURCES: Record<string, string> = {
  // Used catalog (catalog.json) — verified by curl 200
  "raspberry-pi-4b":
    "https://en.wikipedia.org/wiki/Special:FilePath/Raspberry_Pi_4_Model_B_-_Side.jpg?width=640",
  "raspberry-pi-zero-2w":
    "https://en.wikipedia.org/wiki/Special:FilePath/Raspberry_Pi_Zero_2_W.jpg?width=640",
  "arduino-uno-r3":
    "https://en.wikipedia.org/wiki/Special:FilePath/Arduino_Uno_-_R3.jpg?width=640",
  "barnes-noble-nook-touch":
    "https://en.wikipedia.org/wiki/Special:FilePath/Nook_Simple_Touch.jpg?width=640",
  "nintendo-3ds":
    "https://en.wikipedia.org/wiki/Special:FilePath/Nintendo-3DS-AquaOpen.png?width=640",
  "pebble-time":
    "https://en.wikipedia.org/wiki/Special:FilePath/Pebble_Time_Steel.jpg?width=640",
  "wyze-cam-v2":
    "https://en.wikipedia.org/wiki/Special:FilePath/Wyze_Cam_v2.jpg?width=640",

  // Premium catalog (premium-catalog.json) — verified
  "pinetime":
    "https://en.wikipedia.org/wiki/Special:FilePath/PineTime_smartwatch.jpg?width=640",
  "adafruit-magtag": "https://cdn-shop.adafruit.com/970x728/4800-09.jpg",
};

export function hasImage(slug: string): boolean {
  return slug in IMAGE_SOURCES;
}
