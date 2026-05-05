"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ProposeResponse } from "@/lib/types";

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
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProposeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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

            {!result.degraded && result.reasoning && (
              <div className="reasoning">
                <strong>Why these:</strong> {result.reasoning}
              </div>
            )}

            {result.message && (
              <div className="degraded">{result.message}</div>
            )}

            {result.proposals.map((p) => (
              <article key={p.id} className="proposal">
                <div className="proposal-head">
                  <h3>{p.name}</h3>
                  <div className="proposal-meta">
                    <span className="pill">{p.category}</span>
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
                  <a className="ebay" href={p.links.ebay_search_url} target="_blank" rel="noreferrer">
                    eBay listings →
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
                </div>
              </article>
            ))}
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
