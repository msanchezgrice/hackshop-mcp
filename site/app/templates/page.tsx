import Link from "next/link";
import type { Metadata } from "next";
import {
  TEMPLATES,
  TEMPLATE_CATEGORIES,
  type Template,
} from "@/lib/templates";

export const metadata: Metadata = {
  title: "Project templates · hackshop-mcp",
  description:
    "25 verified project templates: idea + recommended hardware + viability assessment. Repurpose old phones, e-readers, Roombas, and DSLRs into useful new things.",
};

const VIABILITY_LABEL: Record<Template["viability"], string> = {
  verified: "Verified",
  iffy: "Iffy",
  experimental: "Experimental",
};

const VIABILITY_COLOR: Record<Template["viability"], string> = {
  verified: "var(--ok)",
  iffy: "var(--warn)",
  experimental: "var(--warn)",
};

function ProjectCard({ t }: { t: Template }) {
  return (
    <article
      style={{
        background: "var(--code-bg)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "18px 20px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 17 }}>{t.title}</h3>
        <span
          style={{
            color: VIABILITY_COLOR[t.viability],
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {VIABILITY_LABEL[t.viability]} · diff {t.difficulty}/5 ·{" "}
          {t.est_cost_usd.min === 0
            ? `~$${t.est_cost_usd.max} or free`
            : t.est_cost_usd.min === t.est_cost_usd.max
              ? `~$${t.est_cost_usd.min}`
              : `$${t.est_cost_usd.min}-${t.est_cost_usd.max}`}
        </span>
      </div>
      <p style={{ margin: "0 0 10px", fontSize: 15, color: "var(--fg)" }}>
        {t.blurb}
      </p>
      <p
        style={{
          margin: "0 0 14px",
          fontSize: 13,
          color: "var(--muted)",
          lineHeight: 1.5,
        }}
      >
        <strong style={{ color: "var(--fg)" }}>Why this works: </strong>
        {t.viability_note}
      </p>
      <Link
        href={`/?idea=${encodeURIComponent(t.prompt)}`}
        style={{
          display: "inline-block",
          padding: "8px 14px",
          background: "var(--accent)",
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          borderRadius: 6,
          textDecoration: "none",
        }}
      >
        Try this idea →
      </Link>
    </article>
  );
}

export default function TemplatesPage() {
  // Group by category
  const byCategory = TEMPLATES.reduce<
    Record<Template["category"], Template[]>
  >(
    (acc, t) => {
      (acc[t.category] ||= []).push(t);
      return acc;
    },
    {} as Record<Template["category"], Template[]>,
  );

  return (
    <main>
      <header>
        <h1>Project templates</h1>
        <p className="tagline">
          25 verified project templates. Each one is a real path —{" "}
          <span style={{ color: "var(--ok)" }}>verified</span> means the hack is
          documented and reproducible;{" "}
          <span style={{ color: "var(--warn)" }}>iffy</span> works with caveats
          (read the note). Click <em>Try this idea</em> to send it to the live
          agent and get hardware proposals.
        </p>
        <div className="badges">
          <Link className="badge" href="/">
            ← Home
          </Link>
          <a className="badge" href="https://github.com/msanchezgrice/hackshop-mcp">
            GitHub
          </a>
          <span className="badge">{TEMPLATES.length} templates</span>
          <span className="badge">
            {TEMPLATES.filter((t) => t.viability === "verified").length} verified
          </span>
        </div>
      </header>

      {(Object.keys(TEMPLATE_CATEGORIES) as Template["category"][]).map(
        (cat) => {
          const items = byCategory[cat];
          if (!items || items.length === 0) return null;
          return (
            <section key={cat}>
              <h2>{TEMPLATE_CATEGORIES[cat]}</h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr",
                  gap: 12,
                }}
              >
                {items.map((t) => (
                  <ProjectCard key={t.slug} t={t} />
                ))}
              </div>
            </section>
          );
        },
      )}

      <hr />

      <footer>
        <p>
          Each template is a prompt that the live agent on the homepage can
          process. The agent picks 3-5 hardware candidates from the catalog and
          ranks them with brick-risk, firmware links, and live eBay search URLs.
        </p>
        <p>
          Missing a project? <a href="https://github.com/msanchezgrice/hackshop-mcp/issues">Open an issue</a>{" "}
          and we&apos;ll add it.
        </p>
      </footer>
    </main>
  );
}
