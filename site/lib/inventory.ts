"use client";

// LocalStorage-backed inventory of catalog device IDs the user owns.
// V0 has no auth — inventory stays on the user's device. Persistent
// across visits in the same browser, lost across browsers.

const KEY = "hackshop:inventory:v1";

export function loadInventory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string").slice(0, 100);
  } catch {
    return [];
  }
}

export function saveInventory(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids.slice(0, 100)));
    // Notify in-page listeners (the form on the homepage etc.)
    window.dispatchEvent(new CustomEvent("hackshop:inventory-changed"));
  } catch {
    // Storage full or disabled: silently no-op
  }
}

export function addToInventory(id: string): void {
  const cur = loadInventory();
  if (cur.includes(id)) return;
  saveInventory([...cur, id]);
}

export function removeFromInventory(id: string): void {
  const cur = loadInventory();
  saveInventory(cur.filter((x) => x !== id));
}

export function clearInventory(): void {
  saveInventory([]);
}
