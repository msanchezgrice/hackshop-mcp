"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import type { ProposeResponse } from "@/lib/types";
import { loadInventory } from "@/lib/inventory";

const EXAMPLES = [
  "Always-on family calendar in the kitchen, light colors, no animation, e-paper preferred",
  "Wall-mounted digital art frame, sub-$300, supports custom firmware",
  "Ambient bedroom meditation peripheral, no screen, breathing-rhythm light",
  "Kid coding station for an 8-year-old, lockable to one app",
  "Status display for my server rack, low power, low refresh",
];

function DemoFormInner() {
  const searchParams = useSearchParams();
  const [idea, setIdea] = useState("");
  const [budget, setBudget] = useState("");
  const [constraints, setConstraints] = useState("");
  const [includePremium, setIncludePremium] = useState(false);
  const [openSourceOnly, setOpenSourceOnly] = useState(false);
  const [useInventory, setUseInventory] = useState(false);
  const [inventoryCount, setInventoryCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProposeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [howtoFor, setHowtoFor] = useState<string | null>(null);
  const [howtoMd, setHowtoMd] = useState<string | null>(null);
  const [howtoLoading, setHowtoLoading] = useState(false);
  const [diagramB64, setDiagramB64] = useState<string | null>(null);
  const [diagramLoading, setDiagramLoading] = useState(false);
  const [diagramError, setDiagramError] = useState<string | null>(null);

  // Track inventory size; refresh when other tabs/pages change it.
  useEffect(() => {
    const refresh = () => setInventoryCount(loadInventory().length);
    refresh();
    window.addEventListener("hackshop:inventory-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("hackshop:inventory-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  // Prefill from ?idea=... when arriving from /templates.
  useEffect(() => {
    const fromUrl = searchParams.get("idea");
    if (fromUrl && !idea) {
      setIdea(fromUrl);
      // Scroll to the form so the user sees what's about to happen.
      setTimeout(() => {
        document.getElementById("idea")?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!idea.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const body: Record<string, unknown> = { idea: idea.trim() };
      const b = parseFloat(budget);
      if (!Number.isNaN(b) && b > 0) body.budget_usd = b;
      if (constraints.trim()) body.constraints = constraints.trim();
      if (includePremium) body.include_premium = true;
      if (openSourceOnly) body.open_source_only = true;
      if (useInventory) {
        const inv = loadInventory();
        if (inv.length > 0) body.inventory_ids = inv;
      }

      const res = await fetch("/api/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Server returned ${res.status}`);
      } else {
        setResult(data as ProposeResponse);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form className="demo-form" onSubmit={submit}>
        <label htmlFor="idea">Project idea</label>
        <textarea
          id="idea"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="e.g. Always-on family calendar in the kitchen, e-paper preferred."
          maxLength={2000}
          required
        />
        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="example-btn"
              onClick={() => setIdea(ex)}
            >
              {ex.split(",")[0]}
            </button>
          ))}
        </div>

        <div className="row">
          <div>
            <label htmlFor="budget">Budget USD (optional)</label>
            <input
              id="budget"
              type="number"
              min="0"
              step="any"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="200"
            />
          </div>
          <div>
            <label htmlFor="constraints">Constraints (optional)</label>
            <input
              id="constraints"
              type="text"
              value={constraints}
              onChange={(e) => setConstraints(e.target.value)}
              placeholder="must fit in a 6x4 inch frame"
              maxLength={500}
            />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={useInventory}
              onChange={(e) => setUseInventory(e.target.checked)}
              disabled={inventoryCount === 0}
              style={{ width: "auto", margin: 0 }}
            />
            <span style={{ fontSize: 14, color: inventoryCount === 0 ? "var(--muted)" : "var(--fg)" }}>
              <strong>Use what I already own</strong> ({inventoryCount} items in inventory){" "}
              {inventoryCount === 0 ? (
                <a href="/inventory" style={{ marginLeft: 4 }}>
                  add some →
                </a>
              ) : (
                <a href="/inventory" style={{ marginLeft: 4, fontSize: 12 }}>
                  (edit)
                </a>
              )}
            </span>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={openSourceOnly}
              onChange={(e) => setOpenSourceOnly(e.target.checked)}
              style={{ width: "auto", margin: 0 }}
            />
            <span style={{ fontSize: 14, color: "var(--fg)" }}>
              <strong>Open-source firmware only</strong> — filter to devices with a public GitHub/GitLab repo
            </span>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={includePremium}
              onChange={(e) => setIncludePremium(e.target.checked)}
              style={{ width: "auto", margin: 0 }}
            />
            <span style={{ fontSize: 14, color: "var(--fg)" }}>
              Also show <strong>premium open-source hardware</strong> (Reachy Mini, Crazyflie, M5Stack, etc.) — buy new
            </span>
          </label>
        </div>

        <button type="submit" disabled={loading || !idea.trim()}>
          {loading ? (
            <>
              <span className="spinner" />
              Thinking…
            </>
          ) : (
            "Propose hardware"
          )}
        </button>
        <p className="hint">
          Live API call. 5 requests / hour / IP. Costs ≈ $0.002 per call (Haiku).
        </p>
      </form>

      <div className="results">
        {error && <div className="error">{error}</div>}

        {result && (
          <>
            {result.degraded && (
              <div className="degraded">
                Degraded response: {result.reasoning}
              </div>
            )}

            {!result.degraded && (result.rationale_md || result.reasoning) && (
              <div className="reasoning">
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Why these
                </div>
                {result.rationale_md ? (
                  <div className="md">
                    <ReactMarkdown>{result.rationale_md}</ReactMarkdown>
                  </div>
                ) : (
                  <div>{result.reasoning}</div>
                )}
              </div>
            )}

            {!result.degraded && result.next_steps_md && (
              <div className="reasoning" style={{ borderLeftColor: "var(--ok)" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Next steps
                </div>
                <div className="md">
                  <ReactMarkdown>{result.next_steps_md}</ReactMarkdown>
                </div>
              </div>
            )}

            {!result.degraded && result.proposals.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                {!diagramB64 && !diagramLoading && (
                  <button
                    type="button"
                    onClick={async () => {
                      setDiagramLoading(true);
                      setDiagramError(null);
                      try {
                        const res = await fetch("/api/diagram", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            idea: idea.trim(),
                            device_ids: result.proposals.map((p) => p.id),
                          }),
                        });
                        const data = await res.json();
                        if (!res.ok) {
                          setDiagramError(
                            data.configured === false
                              ? "Diagram generation isn't enabled on this deployment yet (needs OPENAI_API_KEY)."
                              : data.error ?? `Server returned ${res.status}`,
                          );
                        } else if (data.image_b64) {
                          setDiagramB64(data.image_b64);
                        }
                      } catch (e) {
                        setDiagramError((e as Error).message);
                      } finally {
                        setDiagramLoading(false);
                      }
                    }}
                    style={{
                      fontSize: 13,
                      padding: "8px 14px",
                      borderRadius: 6,
                      background: "var(--code-bg)",
                      color: "var(--fg)",
                      border: "1px solid var(--accent)",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Generate architecture diagram →
                  </button>
                )}
                {diagramLoading && (
                  <div className="reasoning" style={{ borderLeftColor: "var(--accent)" }}>
                    <span className="spinner" /> Generating diagram via gpt-image-1 (~10-30s)…
                  </div>
                )}
                {diagramError && <div className="error">{diagramError}</div>}
                {diagramB64 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      Architecture sketch (AI-generated)
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`data:image/png;base64,${diagramB64}`}
                      alt="Generated architecture diagram"
                      style={{
                        maxWidth: "100%",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {result.message && (
              <div className="degraded">{result.message}</div>
            )}

            {result.proposals.map((p) => (
              <article key={p.id} className="proposal">
                <div style={{ marginBottom: 12 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/img?slug=${p.id}`}
                    alt={p.name}
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                    style={{
                      maxHeight: 160,
                      maxWidth: "100%",
                      borderRadius: 6,
                      background: "var(--code-bg-2)",
                    }}
                    loading="lazy"
                  />
                </div>
                <div className="proposal-head">
                  <h3>{p.name}</h3>
                  <div className="proposal-meta">
                    <span className="pill">{p.category}</span>
                    {p.est_price_label && (
                      <span className="pill ok">{p.est_price_label} used</span>
                    )}
                    {p.est_setup_label && (
                      <span className="pill">{p.est_setup_label}</span>
                    )}
                    {p.is_open_source && (
                      <span className="pill ok">open-source</span>
                    )}
                    <span className="pill">hack {p.hack_difficulty}/5</span>
                    <span
                      className={`pill ${
                        p.brick_risk === null
                          ? "warn"
                          : p.brick_risk >= 4
                            ? "warn"
                            : "ok"
                      }`}
                    >
                      brick {p.brick_risk_label}
                    </span>
                    <span className="pill">{p.community_size} community</span>
                  </div>
                </div>
                <p className="proposal-why">{p.why_this_fits}</p>
                {p.brick_risk_disclaimer && (
                  <div className="proposal-disclaimer">
                    {p.brick_risk_disclaimer}
                  </div>
                )}
                <p className="proposal-notes">{p.notes}</p>
                <div className="proposal-links">
                  <a
                    className="ebay"
                    href={p.ebay_live?.sample_url ?? p.links.ebay_search_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {p.ebay_live
                      ? p.ebay_live.count > 0
                        ? `eBay (${p.ebay_live.count} listing${p.ebay_live.count === 1 ? "" : "s"}${
                            p.ebay_live.min_price_usd !== null
                              ? `, from $${Math.round(p.ebay_live.min_price_usd)}`
                              : ""
                          }) →`
                        : "eBay (no current listings)"
                      : "eBay listings →"}
                  </a>
                  <a href={p.links.hackaday_search_url} target="_blank" rel="noreferrer">
                    Hackaday
                  </a>
                  <a href={p.links.reddit_search_url} target="_blank" rel="noreferrer">
                    Reddit
                  </a>
                  <a href={p.links.google_search_url} target="_blank" rel="noreferrer">
                    Web
                  </a>
                  {p.firmware_links.map((url, i) => (
                    <a key={i} className="firmware" href={url} target="_blank" rel="noreferrer">
                      Firmware: {new URL(url).hostname.replace("www.", "")}
                    </a>
                  ))}
                  <button
                    type="button"
                    onClick={async () => {
                      setHowtoFor(p.id);
                      setHowtoMd(null);
                      setHowtoLoading(true);
                      try {
                        const res = await fetch("/api/howto", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            device_id: p.id,
                            idea: idea.trim() || undefined,
                          }),
                        });
                        const data = await res.json();
                        setHowtoMd(data.markdown ?? data.error ?? "(no response)");
                      } catch (e) {
                        setHowtoMd(`(error fetching guide: ${(e as Error).message})`);
                      } finally {
                        setHowtoLoading(false);
                      }
                    }}
                    style={{
                      fontSize: 12,
                      padding: "4px 10px",
                      borderRadius: 4,
                      background: "var(--accent)",
                      color: "#fff",
                      border: 0,
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Get how-to →
                  </button>
                </div>
                {howtoFor === p.id && (
                  <div
                    style={{
                      marginTop: 14,
                      padding: 14,
                      background: "var(--code-bg-2)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 14,
                      lineHeight: 1.55,
                    }}
                  >
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
                      AI-generated guide. Verify against the linked communities before flashing.
                    </div>
                    {howtoLoading ? (
                      <div>
                        <span className="spinner" /> Generating walkthrough…
                      </div>
                    ) : (
                      <pre style={{
                        background: "transparent",
                        border: 0,
                        padding: 0,
                        whiteSpace: "pre-wrap",
                        fontFamily: "inherit",
                        margin: 0,
                      }}>{howtoMd}</pre>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setHowtoFor(null);
                        setHowtoMd(null);
                      }}
                      style={{
                        marginTop: 10,
                        background: "transparent",
                        color: "var(--muted)",
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        padding: "4px 10px",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      Close
                    </button>
                  </div>
                )}
              </article>
            ))}

            {result.premium_proposals && result.premium_proposals.length > 0 && (
              <>
                <h3
                  style={{
                    margin: "32px 0 12px",
                    fontSize: 18,
                    color: "var(--accent)",
                  }}
                >
                  Premium open-source hardware (buy new)
                </h3>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--muted)",
                    marginTop: 0,
                    marginBottom: 14,
                  }}
                >
                  These are open-source NEW products from Pollen Robotics,
                  Bitcraze, Adafruit, Pimoroni, Pine64, etc. Premium price; full
                  capability sets out of the box.
                </p>
                {result.premium_proposals.map((p) => (
                  <article key={p.id} className="proposal">
                    <div style={{ marginBottom: 12 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/img?slug=${p.id}`}
                        alt={p.name}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                        style={{
                          maxHeight: 160,
                          maxWidth: "100%",
                          borderRadius: 6,
                          background: "var(--code-bg-2)",
                        }}
                        loading="lazy"
                      />
                    </div>
                    <div className="proposal-head">
                      <h3>{p.name}</h3>
                      <div className="proposal-meta">
                        <span className="pill">{p.category}</span>
                        <span className="pill ok">{p.price_range}</span>
                        {p.est_setup_label && (
                          <span className="pill">{p.est_setup_label}</span>
                        )}
                        <span className="pill">{p.manufacturer}</span>
                        {p.actuation_risk >= 3 && (
                          <span className="pill warn">
                            actuation {p.actuation_risk}/5
                          </span>
                        )}
                        {p.privacy_risk >= 3 && (
                          <span className="pill warn">
                            privacy {p.privacy_risk}/5
                            {p.risk_callouts.length > 0
                              ? ` (${p.risk_callouts.join(" + ")})`
                              : ""}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="proposal-why">{p.why_this_fits}</p>
                    <p className="proposal-notes">
                      <strong style={{ color: "var(--fg)" }}>Capabilities: </strong>
                      {p.capabilities.join(" · ")}
                    </p>
                    <p className="proposal-notes">
                      <strong style={{ color: "var(--fg)" }}>Software: </strong>
                      {p.software_stack.join(" · ")}
                    </p>
                    <p className="proposal-notes">{p.notes}</p>
                    <div className="proposal-links">
                      <a
                        className="ebay"
                        href={p.vendor_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Buy from {p.manufacturer.split(" ")[0]} →
                      </a>
                      {p.open_source_repo && (
                        <a
                          className="firmware"
                          href={p.open_source_repo}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open source repo
                        </a>
                      )}
                    </div>
                  </article>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

// Wrapped in Suspense because useSearchParams() requires a Suspense boundary
// during static rendering. Next.js 16 throws a build error otherwise.
export function DemoForm() {
  return (
    <Suspense fallback={<div className="demo-form">Loading…</div>}>
      <DemoFormInner />
    </Suspense>
  );
}
