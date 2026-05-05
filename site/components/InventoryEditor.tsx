"use client";

import { useEffect, useMemo, useState } from "react";
import {
  loadInventory,
  saveInventory,
  clearInventory,
} from "@/lib/inventory";

interface DeviceLite {
  id: string;
  name: string;
  category: string;
  image_url: string | null;
}

export function InventoryEditor({ devices }: { devices: DeviceLite[] }) {
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage after mount (server render is empty)
  useEffect(() => {
    setOwned(new Set(loadInventory()));
    setHydrated(true);
  }, []);

  function toggle(id: string) {
    const next = new Set(owned);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOwned(next);
    saveInventory(Array.from(next));
  }

  function reset() {
    setOwned(new Set());
    clearInventory();
  }

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter(
      (d) => d.name.toLowerCase().includes(q) || d.category.includes(q),
    );
  }, [devices, filter]);

  const ownedDevices = devices.filter((d) => owned.has(d.id));

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <strong style={{ fontSize: 16 }}>
          {hydrated ? `${owned.size} item${owned.size === 1 ? "" : "s"} in your inventory` : "Loading…"}
        </strong>
        {owned.size > 0 && (
          <button
            type="button"
            onClick={reset}
            style={{
              background: "transparent",
              color: "var(--muted)",
              border: "1px solid var(--border)",
              padding: "6px 12px",
              borderRadius: 6,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Clear all
          </button>
        )}
      </div>

      {hydrated && ownedDevices.length > 0 && (
        <div
          style={{
            background: "var(--code-bg)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 14,
            marginBottom: 24,
          }}
        >
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            Owned:
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ownedDevices.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => toggle(d.id)}
                style={{
                  background: "var(--accent)",
                  color: "#fff",
                  border: 0,
                  borderRadius: 999,
                  padding: "4px 12px",
                  fontSize: 13,
                  cursor: "pointer",
                }}
                title="Click to remove from inventory"
              >
                {d.name} ✕
              </button>
            ))}
          </div>
        </div>
      )}

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter devices…"
        style={{
          width: "100%",
          background: "var(--code-bg-2)",
          color: "var(--fg)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "10px 12px",
          fontSize: 15,
          marginBottom: 16,
        }}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 8,
        }}
      >
        {visible.map((d) => {
          const has = owned.has(d.id);
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => toggle(d.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                background: has ? "rgba(249,115,22,0.08)" : "var(--code-bg)",
                border: `1px solid ${has ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 8,
                padding: "10px 14px",
                fontFamily: "inherit",
                fontSize: 15,
                color: "var(--fg)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  background: "var(--code-bg-2)",
                  borderRadius: 6,
                  flexShrink: 0,
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  color: "var(--muted)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/img?slug=${d.id}`}
                  alt=""
                  width={48}
                  height={48}
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    const img = e.currentTarget as HTMLImageElement;
                    img.style.display = "none";
                    const fallback = img.nextElementSibling as HTMLElement | null;
                    if (fallback) fallback.style.display = "block";
                  }}
                  style={{ objectFit: "cover", width: "100%", height: "100%" }}
                />
                <span style={{ display: "none" }}>
                  {d.category.slice(0, 3).toUpperCase()}
                </span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{d.name}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {d.category}
                </div>
              </div>
              <div
                style={{
                  fontSize: 18,
                  color: has ? "var(--accent)" : "var(--muted)",
                  fontWeight: 700,
                }}
              >
                {has ? "−" : "+"}
              </div>
            </button>
          );
        })}
        {visible.length === 0 && (
          <div style={{ color: "var(--muted)", padding: 16 }}>
            No matches. Want to suggest a device?{" "}
            <a href="https://github.com/msanchezgrice/hackshop-mcp/issues">
              Open an issue
            </a>
            .
          </div>
        )}
      </div>
    </>
  );
}
