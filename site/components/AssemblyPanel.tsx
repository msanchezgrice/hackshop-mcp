"use client";

import type {
  AssemblyResponse,
  FeasibilityCheck,
  FeasibilityProvenance,
  FeasibilityStatus,
  FeasibilityVerdict,
} from "@/lib/assembly";

// Map raw enum values to human-readable labels so we never leak tokens like
// "warn" or "derived" straight into the UI.
const STATUS_LABEL: Record<FeasibilityStatus, string> = {
  pass: "Pass",
  warn: "Warning",
  fail: "Fail",
  unknown: "Unknown",
};

const PROVENANCE_LABEL: Record<FeasibilityProvenance, string> = {
  spec: "from spec",
  derived: "inferred",
  unknown: "unverified",
};

// Presentational only — the parent fetches /api/assembly and passes the result.
// Renders the feasibility verdict (the "could this actually work?" answer) and
// the human-readable build plan (the "steps of assembly" deliverable).

const VERDICT_STYLE: Record<
  FeasibilityVerdict,
  { label: string; bg: string; fg: string; border: string }
> = {
  feasible: {
    label: "Feasible",
    bg: "rgba(34,197,94,0.12)",
    fg: "var(--ok)",
    border: "var(--ok)",
  },
  "feasible-with-warnings": {
    label: "Feasible — with warnings",
    bg: "rgba(234,179,8,0.12)",
    fg: "var(--warn, #facc15)",
    border: "var(--warn, #facc15)",
  },
  infeasible: {
    label: "Infeasible as specified",
    bg: "rgba(239,68,68,0.12)",
    fg: "var(--fail, #ef4444)",
    border: "var(--danger, #ef4444)",
  },
  unknown: {
    label: "Not enough data",
    bg: "var(--code-bg-2)",
    fg: "var(--muted)",
    border: "var(--border)",
  },
};

function statusPillClass(status: FeasibilityStatus): string {
  if (status === "pass") return "pill ok";
  if (status === "fail" || status === "warn") return "pill warn";
  return "pill";
}

function CheckRow({ check }: { check: FeasibilityCheck }) {
  return (
    <li style={{ marginBottom: 10, listStyle: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className={statusPillClass(check.status)}>
          {STATUS_LABEL[check.status]}
        </span>
        <strong style={{ fontSize: 14 }}>{check.label}</strong>
        <span
          style={{ fontSize: 11, color: "var(--muted)" }}
          title="Confidence in this check's inputs"
        >
          ({PROVENANCE_LABEL[check.provenance]})
        </span>
      </div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
        {check.detail}
      </div>
    </li>
  );
}

const ACTION_LABEL: Record<string, string> = {
  solder: "Solder",
  flash: "Flash",
  glue: "Glue",
  connect: "Connect",
  crimp: "Crimp",
  mount: "Mount",
  print_3d: "3D print",
  calibrate: "Calibrate",
  test: "Test",
};

function formatMinutes(total: number): string {
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

export function AssemblyPanel({ data }: { data: AssemblyResponse }) {
  const v = VERDICT_STYLE[data.feasibility.verdict];
  const { assembly, build_plan, feasibility } = data;

  // A mobile goal with no drivable base is the common dead end: the build can't
  // navigate and the physics sim returns "unsupported". Surface a way forward.
  const isMobileGoal =
    assembly.goal.kind === "navigate" || assembly.goal.kind === "locomote";
  const missingBase =
    isMobileGoal &&
    !assembly.components.some(
      (c) => c.role === "chassis" || c.role === "actuator",
    );

  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          fontSize: 12,
          color: "var(--muted)",
          marginBottom: 6,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        Build &amp; feasibility
      </div>

      {data.degraded && data.message && (
        <div className="degraded" style={{ marginBottom: 12 }}>
          {data.message}
        </div>
      )}

      {/* Goal + world summary */}
      <div
        className="reasoning"
        style={{ borderLeftColor: "var(--accent)", marginBottom: 12 }}
      >
        <div style={{ fontSize: 14 }}>
          <strong>Goal ({assembly.goal.kind}):</strong> {assembly.goal.spec}
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Success: {assembly.goal.success_metric}
        </div>
        {assembly.goal.criteria && (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
            Enforced scoring: within {assembly.goal.criteria.position_tolerance_m} m
            for {assembly.goal.criteria.dwell_s}s · at most{" "}
            {assembly.goal.criteria.max_collision_events} collision event
            {assembly.goal.criteria.max_collision_events === 1 ? "" : "s"}
            {assembly.goal.criteria.require_upright ? " · must remain upright" : ""}
          </div>
        )}
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          World: {assembly.world.template}
          {assembly.world.goal_xy
            ? ` · goal at (${assembly.world.goal_xy[0]}, ${assembly.world.goal_xy[1]})`
            : ""}
        </div>
      </div>

      {/* Feasibility verdict */}
      <div
        style={{
          background: v.bg,
          border: `1px solid ${v.border}`,
          borderRadius: 8,
          padding: 14,
          marginBottom: 12,
        }}
      >
        <div style={{ fontWeight: 700, color: v.fg, marginBottom: 4 }}>
          {v.label}
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
          {feasibility.summary}
        </div>
        <ul style={{ margin: 0, padding: 0 }}>
          {feasibility.checks.map((c) => (
            <CheckRow key={c.id} check={c} />
          ))}
        </ul>
        {missingBase && (
          <div
            style={{
              marginTop: 10,
              paddingTop: 10,
              borderTop: "1px solid var(--border)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: "var(--fg)" }}>How to fix:</strong> this build
            has no drivable base, so it can&apos;t navigate. Add a wheeled base to
            your idea — e.g. &quot;on an old Roomba&quot;, an iRobot Create 3, or a
            TurtleBot — and re-propose. Or use{" "}
            <em>Add a generic mobile base &amp; simulate</em> in the physics
            simulation below to preview it on a proxy chassis right now.
          </div>
        )}
      </div>

      {/* Build plan */}
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 14,
          background: "var(--code-bg-2)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 10,
          }}
        >
          <strong style={{ fontSize: 15 }}>Assembly steps</strong>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            ~{formatMinutes(build_plan.total_minutes)} total
          </span>
        </div>
        <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
          {build_plan.steps.map((s) => (
            <li
              key={s.order}
              style={{
                display: "flex",
                gap: 12,
                padding: "10px 0",
                borderTop: s.order === 1 ? "none" : "1px solid var(--border)",
              }}
            >
              <span
                style={{
                  flex: "0 0 auto",
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {s.order}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="pill">{ACTION_LABEL[s.action] ?? s.action}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    {s.est_minutes} min
                  </span>
                  {s.depends_on.length > 0 && (
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      after step{s.depends_on.length > 1 ? "s" : ""} {s.depends_on.join(", ")}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 14, marginTop: 4 }}>{s.detail}</div>
                {(s.tools.length > 0 || s.parts.length > 0) && (
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                    {s.parts.length > 0 && <>Parts: {s.parts.join(", ")}. </>}
                    {s.tools.length > 0 && <>Tools: {s.tools.join(", ")}.</>}
                  </div>
                )}
                {s.risk_note && (
                  <div
                    className="proposal-disclaimer"
                    style={{ marginTop: 6 }}
                  >
                    {s.risk_note}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
