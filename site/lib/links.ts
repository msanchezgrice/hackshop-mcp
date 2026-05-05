import type { DeviceEntry, DeviceLinks } from "./types";

function ebayCondition(brick_risk: number | null): string {
  if (brick_risk === null) return "used";
  return brick_risk >= 4 ? "working" : "used";
}

export function buildLinks(device: DeviceEntry): DeviceLinks {
  const cond = ebayCondition(device.brick_risk);
  const ebayQuery = `${device.name} ${cond}`;
  return {
    ebay_search_url: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(ebayQuery)}&_sop=15`,
    hackaday_search_url: `https://hackaday.com/?s=${encodeURIComponent(device.name)}`,
    reddit_search_url: `https://www.reddit.com/search/?q=${encodeURIComponent(device.name + " hack")}&sort=new`,
    google_search_url: `https://www.google.com/search?q=${encodeURIComponent(device.name + " custom firmware OR hack OR mod")}`,
  };
}
