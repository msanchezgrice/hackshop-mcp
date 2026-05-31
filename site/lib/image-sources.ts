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

  // ---------------------------------------------------------------------------
  // Coverage expansion — Wikimedia Commons Special:FilePath. Every entry below
  // was curl-verified (200 + image/* content-type) through the proxy UA on
  // 2026-05-30. Same redirect-following Special:FilePath pattern as above, just
  // on the commons.wikimedia.org host (Wikipedia Special:FilePath redirects here
  // anyway). Spaces/parens are percent-encoded so the slug regex + fetch are happy.
  // Alphabetical by device_id.
  // ---------------------------------------------------------------------------
  "amazfit-bip":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Amazfit%20Bip%20Inside.jpg?width=640",
  "amazon-echo-dot-2nd-gen-echocli":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Amazon%20Echo%20Dot%20%28virtual%20digital%20assistant%29%20with%20normal%20coffee%20mug%20as%20size%20comparison.jpg?width=640",
  "amazon-kindle-paperwhite-gen2":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Kindle%20Paperwhite%20WiFi.jpg?width=640",
  "atari-flashback":
    "https://commons.wikimedia.org/wiki/Special:FilePath/AtariFlashback.jpg?width=640",
  "bbc-microbit-v2":
    "https://commons.wikimedia.org/wiki/Special:FilePath/BBC%20micro%20bit%20v2.jpg?width=640",
  "boox-poke-3":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Onyx%20Boox%20Tab%20X%2C%2013%2C3-inch%20E-book%20reader%20%28E-reader%29%2C%20released%202023.jpg?width=640",
  "bose-soundtouch-10-api":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Sistema%20Bose%20Soundtouch%2030.jpg?width=640",
  "chromecast-1st-gen":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Chromecast%20%281st%20generation%29-0867.jpg?width=640",
  "chumby":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Chumby%20One.jpg?width=640",
  "clockworkpi-uconsole":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Black%20uConsole%20by%20ClockworkPi%20%28transparent%20background%29.png?width=640",
  "dell-wyse-5070":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Dell%20Wyse%205070%2011.jpg?width=640",
  "esp32-devkit-c":
    "https://commons.wikimedia.org/wiki/Special:FilePath/ESP32%20Espressif%20ESP-WROOM-32%20Dev%20Board.jpg?width=640",
  "fitbit-versa":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Fitbit%20versa%20showing%20the%20clock%20app.jpg?width=640",
  "flipper-zero":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Flipper%20Zero.jpg?width=640",
  "garmin-forerunner-235":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Garmin%20Forerunner%20235.jpg?width=640",
  "google-nexus-5x":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Nexus%205X%20%28White%29.jpg?width=640",
  "google-pixel-3a":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Google%20Pixel%203a%20-%202023.jpg?width=640",
  "gopro-hero4":
    "https://commons.wikimedia.org/wiki/Special:FilePath/GoPro%20Hero%204%20Black.jpg?width=640",
  "gopro-hero567":
    "https://commons.wikimedia.org/wiki/Special:FilePath/GoPro%20Hero5%20Black.jpg?width=640",
  "hp-t620-plus":
    "https://commons.wikimedia.org/wiki/Special:FilePath/HP%20t5540%20Thin%20Client%20%285144904635%29.jpg?width=640",
  "intel-nuc":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Intel%20NUC%20Mini%20PC.jpg?width=640",
  "ipad-2":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Apple%20iPad%202%20closeup.jpg?width=640",
  "kindle-paperwhite-7th-gen-koreader":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Kindle%20Paperwhite%20WiFi.jpg?width=640",
  "kobo-clara-hd":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Kobo%20Clara%20HD.jpg?width=640",
  "lenovo-thinkcentre-tiny":
    "https://commons.wikimedia.org/wiki/Special:FilePath/P5300566%20Lenovo%20ThinkCentre%20m715q%20disassembled%20case.webp?width=640",
  "lifx-a19-aiolifx":
    "https://commons.wikimedia.org/wiki/Special:FilePath/LIFX%20light%20bulbs%20with%20packaging.jpg?width=640",
  "limesdr-mini-2":
    "https://commons.wikimedia.org/wiki/Special:FilePath/LimeSDR%20case%20%2835112161395%29.jpg?width=640",
  "linksys-wrt3200acm":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Linksys%20WRT3200ACM%20%28Cropped%29.jpg?width=640",
  "logitech-harmony-hub-aioharmony":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Logitech%20Harmony%20Elite%20Remote%20Control.jpg?width=640",
  "mikrotik-hap-ac2":
    "https://commons.wikimedia.org/wiki/Special:FilePath/MikroTik%20hAP%20ac2.jpg?width=640",
  "netgear-r7800":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Netgear-Nighthawk-AC1900-WiFi-Router.jpg?width=640",
  "oculus-quest-1":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Oculus%20Quest.jpeg?width=640",
  "odroid-go":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Odroid%20Go%20Advance%20Handheld%20Console.png?width=640",
  "oneplus-5t":
    "https://commons.wikimedia.org/wiki/Special:FilePath/OnePlus%205T.jpg?width=640",
  "philips-hue-a19-diyhue":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Philips%20Hue%20hub%20and%202%20bulbs.jpg?width=640",
  "philips-hue-go":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Philips%20Hue%20hub%20and%202%20bulbs.jpg?width=640",
  "pine64-pinecil":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Pinecil%20USB%20C%20soldering%20iron.jpg?width=640",
  "pine64-pinephone":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Pinephone%20betaedition.png?width=640",
  "pine64-pinetime":
    "https://commons.wikimedia.org/wiki/Special:FilePath/PineTime%20smartwatch.jpg?width=640",
  "rabbit-r1":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Rabbit%20r1%20%28Booredatwork.com%29%2002.png?width=640",
  "raspberry-pi-5":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Raspberry%20Pi%205.jpg?width=640",
  "raspberry-pi-zero-2-w":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Raspberry%20Pi%20Zero%202%20W.jpg?width=640",
  "remarkable-1-toltec":
    "https://commons.wikimedia.org/wiki/Special:FilePath/ReMarkable%202%20tablet%20with%20Wikipedia%20article.jpg?width=640",
  "remarkable-2":
    "https://commons.wikimedia.org/wiki/Special:FilePath/ReMarkable%202%20tablet%20with%20Wikipedia%20article.jpg?width=640",
  "ricoh-theta-sc":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Ricoh%20Theta%20Z1.jpg?width=640",
  "samsung-galaxy-s9":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Samsung%20Galaxy%20S9.png?width=640",
  "sonos-play-1-soco":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Sonos%20PLAY%201%20wireless%20speaker.jpg?width=640",
  "tp-link-tl-wr841n":
    "https://commons.wikimedia.org/wiki/Special:FilePath/TP-Link%20TL-WR841N-2921.jpg?width=640",
  "valve-steam-link":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Steam%20Link.jpg?width=640",
  "wyze-cam-v2-dafang-hacks":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Wyze%20Cam%20v2.jpg?width=640",

  // Manufacturer CDNs — curl-verified 200 image/* 2026-05-30. Adafruit shop CDN
  // (970x728/<pid>-NN.jpg) is stable and serves Seeed XIAO boards too. M5Stack's
  // own shop CDN is versioned (?v=...) and resolves the correct product image.
  "adafruit-feather-esp32s3-tft":
    "https://cdn-shop.adafruit.com/970x728/5691-00.jpg",
  "adafruit-vl53l4cd":
    "https://cdn-shop.adafruit.com/970x728/5396-00.jpg",
  "seeed-xiao-esp32s3":
    "https://cdn-shop.adafruit.com/970x728/5426-00.jpg",
  "seeed-xiao-nrf52840-sense":
    "https://cdn-shop.adafruit.com/970x728/5304-00.jpg",
  "m5stack-core2":
    "https://shop.m5stack.com/cdn/shop/files/1_b5359a18-c82e-484f-8879-7d560bea0e66_1200x1200.webp?v=1683770131",
  "m5stack-cardputer":
    "https://shop.m5stack.com/cdn/shop/files/1_ff9086d2-ae2f-44b6-8153-aa879898adbb_1200x1200.webp?v=1697161445",
  "m5stack-m5stickc-plus2":
    "https://shop.m5stack.com/cdn/shop/files/1_b6aac80f-5586-4313-99d0-2b79a8cc42e6_1200x1200.webp?v=1702368112",
  "m5stickc-plus-2":
    "https://shop.m5stack.com/cdn/shop/files/1_b6aac80f-5586-4313-99d0-2b79a8cc42e6_1200x1200.webp?v=1702368112",
};

export function hasImage(slug: string): boolean {
  return slug in IMAGE_SOURCES;
}
