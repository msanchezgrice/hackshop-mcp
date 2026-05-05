import type { DeviceEntry, DeviceLinks } from "./types";

// Strip the noise that breaks eBay searches: parens, quote marks, version
// markers like (V2), (Gen 1, 2013). What's left is the searchable core name.
//
// Examples:
//   'Waveshare 7.5" e-Paper HAT (V2)'  ->  'Waveshare 7.5 e-Paper HAT'
//   'Pebble Time (smartwatch)'          ->  'Pebble Time'
//   'Apple iPad 2'                       ->  'Apple iPad 2'  (unchanged)
export function cleanForSearch(name: string): string {
  return name
    .replace(/\([^)]*\)/g, "") // remove (...) blocks
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ebayCondition(brick_risk: number | null): string {
  // Used + Refurbished is the broadest catch. Avoid hyper-specific filters.
  return brick_risk !== null && brick_risk >= 4 ? "working" : "";
}

export function buildEbayQuery(device: DeviceEntry): string {
  const base = cleanForSearch(device.name);
  const cond = ebayCondition(device.brick_risk);
  return cond ? `${base} ${cond}` : base;
}

export function buildLinks(device: DeviceEntry): DeviceLinks {
  const ebayQuery = buildEbayQuery(device);
  // eBay search params:
  //   _nkw       = search term
  //   _sop=15    = sort by distance:nearest first (filters dead listings)
  //   LH_BIN=1   = Buy It Now only (no expired auctions)
  //   LH_ItemCondition=3000|2000  = used + refurbished (broad)
  return {
    ebay_search_url: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(ebayQuery)}&_sop=15&LH_BIN=1&LH_ItemCondition=3000%7C2000`,
    hackaday_search_url: `https://hackaday.com/?s=${encodeURIComponent(cleanForSearch(device.name))}`,
    reddit_search_url: `https://www.reddit.com/search/?q=${encodeURIComponent(cleanForSearch(device.name) + " hack")}&sort=new`,
    google_search_url: `https://www.google.com/search?q=${encodeURIComponent(cleanForSearch(device.name) + " custom firmware OR hack OR mod")}`,
  };
}
