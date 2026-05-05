// Generates real, clickable URLs for each device proposal. No API calls,
// no auth — pure URL templating. Lets users (or downstream agents like
// ebay-mcp) jump straight to live data.

import type { DeviceEntry } from "./catalog/schema.js";

export interface DeviceLinks {
  ebay_search_url: string;
  hackaday_search_url: string;
  reddit_search_url: string;
  google_search_url: string;
}

function ebayCondition(brick_risk: number | null): string {
  if (brick_risk === null) return "used";
  return brick_risk >= 4 ? "working" : "used";
}

export function buildEbayQuery(device: DeviceEntry): string {
  const cond = ebayCondition(device.brick_risk);
  return `${device.name} ${cond}`;
}

export function buildLinks(device: DeviceEntry): DeviceLinks {
  const ebayQuery = buildEbayQuery(device);
  return {
    ebay_search_url: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(ebayQuery)}&_sop=15`,
    hackaday_search_url: `https://hackaday.com/?s=${encodeURIComponent(device.name)}`,
    reddit_search_url: `https://www.reddit.com/search/?q=${encodeURIComponent(device.name + " hack")}&sort=new`,
    google_search_url: `https://www.google.com/search?q=${encodeURIComponent(device.name + " custom firmware OR hack OR mod")}`,
  };
}
