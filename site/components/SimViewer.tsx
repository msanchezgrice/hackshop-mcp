"use client";

import { useEffect, useRef, useState } from "react";
import type { Assembly, BuildPlan } from "@/lib/assembly";
import { IMAGE_SOURCES } from "@/lib/image-sources";
import type { SimJob, SimResult } from "@/lib/sim-client";

// Drives the physics sim: kick a job, poll until done, play the mp4 the worker
// rendered, and surface the *failure theatre* (stuck / tipped / collisions /
// heading oscillation) the user explicitly asked to see.

type Phase = "idle" | "kicking" | "running" | "done" | "error" | "unsupported";

const POLL_MS = 1500;
const MAX_POLLS = 120; // ~3 min ceiling

// The canonical WorldTemplate enum has six values (empty-room, obstacle-course,
// ramp, tabletop, stairs, outdoor-flat). Only the four below are something the
// diff-drive slice can *honestly* run today, so we only surface those — offering
// stairs/outdoor-flat here would imply a capability we don't have. obstacle-
// course is the default because that's where the stumbles/wedges/wobble show up.
const WORLDS: { value: string; label: string }[] = [
  { value: "obstacle-course", label: "Obstacle course (default)" },
  { value: "empty-room", label: "Empty room" },
  { value: "ramp", label: "Ramp" },
  { value: "tabletop", label: "Tabletop" },
];

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13 }}>
      <span style={{ color: "var(--muted)" }}>{label}: </span>
      <strong>{value}</strong>
    </div>
  );
}

function telemNum(t: Record<string, unknown> | undefined, k: string): number | null {
  const v = t?.[k];
  return typeof v === "number" ? v : null;
}

function FailureBadges({ telemetry }: { telemetry?: Record<string, unknown> }) {
  if (!telemetry) return null;
  const badges: string[] = [];
  if (telemetry.tipped) badges.push("tipped over");
  if (telemetry.stuck) {
    const xy = telemetry.stuck_xy as number[] | undefined;
    badges.push(xy ? `wedged @ (${xy[0]}, ${xy[1]})` : "got stuck");
  }
  const collisions = telemNum(telemetry, "collisions");
  if (collisions && collisions > 0) badges.push(`${collisions} collisions`);
  const osc = telemNum(telemetry, "heading_osc_deg");
  if (osc && osc > 25) badges.push(`heading wobble ±${Math.round(osc / 2)}°`);
  if (badges.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
      {badges.map((b) => (
        <span key={b} className="pill warn">
          {b}
        </span>
      ))}
    </div>
  );
}

export function SimViewer({
  assembly,
  buildPlan,
}: {
  assembly: Assembly;
  buildPlan?: BuildPlan;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimResult | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [useAgent, setUseAgent] = useState(false);
  const [world, setWorld] = useState<string>("obstacle-course");
  const [usedBase, setUsedBase] = useState(false);
  const stopRef = useRef(false);

  // The diff-drive slice needs something to drive. A mobile goal (navigate /
  // locomote) with no chassis or actuator returns "unsupported" — a dead end.
  // We offer to drop the build's electronics onto a generic mobile base so the
  // user can still watch it navigate (labelled honestly in the result).
  const goalKind = assembly.goal.kind;
  const isMobileGoal = goalKind === "navigate" || goalKind === "locomote";
  const hasMobileBase = assembly.components.some(
    (c) => c.role === "chassis" || c.role === "actuator",
  );
  const needsBase = isMobileGoal && !hasMobileBase;

  useEffect(() => {
    return () => {
      stopRef.current = true;
    };
  }, []);

  async function run(injectBase = false) {
    stopRef.current = false;
    setPhase("kicking");
    setError(null);
    setResult(null);
    setElapsed(0);
    setUsedBase(injectBase);
    const startedAt = Date.now();
    const tick = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    try {
      // Run in the chosen world. Keep the LLM-chosen goal_xy when the user hasn't
      // switched templates; if they picked a different world, drop the override so
      // that template's own default goal applies (a goal_xy from another world
      // could land out of bounds).
      // When the build has no drivable base, drop its electronics onto a generic
      // diff-drive base so a mobile goal is simulatable instead of a dead end.
      const components = injectBase
        ? [
            ...assembly.components,
            {
              ref: "sim-base",
              device_id: "generic-diff-drive",
              name: "Generic mobile base",
              role: "chassis" as const,
            },
          ]
        : assembly.components;
      const simAssembly = {
        ...assembly,
        components,
        world: {
          template: world,
          goal_xy:
            assembly.world.template === world
              ? assembly.world.goal_xy
              : undefined,
        },
      };
      // Resolve component photos (device_id -> upstream URL) so the worker can
      // bake them into the shareable summary carousel server-side.
      const media = assembly.components
        .filter((c) => IMAGE_SOURCES[c.device_id])
        .map((c) => ({ ref: c.ref, image_url: IMAGE_SOURCES[c.device_id] }));
      const kickRes = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assembly: simAssembly,
          options: { render: true, agent: useAgent, duration_s: 20 },
          build_plan: buildPlan,
          media,
        }),
      });
      const kick = (await kickRes.json()) as SimJob & { error?: string };
      if (!kickRes.ok) {
        setError(kick.error ?? `Server returned ${kickRes.status}`);
        setPhase("error");
        return;
      }
      setPhase("running");

      let polls = 0;
      // Poll loop
      // eslint-disable-next-line no-constant-condition
      while (!stopRef.current && polls < MAX_POLLS) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        polls += 1;
        const pollRes = await fetch(`/api/simulate/${kick.job_id}`, {
          cache: "no-store",
        });
        const job = (await pollRes.json()) as SimJob & { error?: string };
        if (!pollRes.ok) {
          setError(job.error ?? `Poll failed (${pollRes.status})`);
          setPhase("error");
          return;
        }
        if (job.status === "error") {
          setError(job.error ?? "Simulation worker errored.");
          setPhase("error");
          return;
        }
        if (job.status === "done" && job.result) {
          setResult(job.result);
          setPhase(job.result.supported ? "done" : "unsupported");
          return;
        }
      }
      if (!stopRef.current) {
        setError("Simulation timed out. The worker may be overloaded.");
        setPhase("error");
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    } finally {
      clearInterval(tick);
    }
  }

  const busy = phase === "kicking" || phase === "running";

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
        Physics simulation
      </div>

      {phase === "idle" && (
        <div
          className="reasoning"
          style={{ borderLeftColor: "var(--accent)", marginBottom: 12 }}
        >
          <div style={{ fontSize: 13, marginBottom: 10 }}>
            Drop this assembly into a MuJoCo world and watch it try to reach the
            goal — including the stumbles, wedges, and wobble when it can&apos;t.
            You&apos;ll get a <strong>shareable summary page</strong> (product,
            components, high-fidelity renders, wiring schematic, build plan, and
            the run video) linked from the result.
          </div>
          <label
            htmlFor="sim-world"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: 13 }}>World:</span>
            <select
              id="sim-world"
              value={world}
              onChange={(e) => setWorld(e.target.value)}
              style={{
                fontSize: 13,
                padding: "4px 8px",
                borderRadius: 6,
                background: "var(--bg)",
                color: "var(--fg)",
                border: "1px solid var(--border)",
                width: "auto",
                margin: 0,
              }}
            >
              {WORLDS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              marginBottom: 12,
            }}
          >
            <input
              type="checkbox"
              checked={useAgent}
              onChange={(e) => setUseAgent(e.target.checked)}
              style={{ width: "auto", margin: 0 }}
            />
            <span style={{ fontSize: 13 }}>
              Let the <strong>builder agent</strong> author + self-correct the
              controller (LLM; slower). Off = deterministic scripted baseline.
            </span>
          </label>
          {needsBase && (
            <div className="degraded" style={{ marginTop: 0, marginBottom: 10 }}>
              This build has no drivable base, so there&apos;s nothing to navigate
              yet. You can still preview it on a <strong>generic mobile base</strong>{" "}
              — we&apos;ll mount the electronics on a diff-drive chassis.
            </div>
          )}
          <button
            type="button"
            onClick={() => run(needsBase)}
            style={{
              fontSize: 13,
              padding: "8px 14px",
              borderRadius: 6,
              background: "var(--accent)",
              color: "#fff",
              border: 0,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {needsBase
              ? "Add a generic mobile base & simulate →"
              : "Simulate in physics world →"}
          </button>
        </div>
      )}

      {busy && (
        <div
          className="reasoning"
          style={{
            borderLeftColor: "var(--accent)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span className="spinner" />
          <span>
            {phase === "kicking"
              ? "Compiling MJCF scene…"
              : useAgent
                ? "Builder agent authoring control + running physics…"
                : "Running physics rollout + rendering…"}{" "}
            <strong>{elapsed}s</strong> elapsed
            <span style={{ color: "var(--muted)" }}>
              {" "}
              {elapsed < 10
                ? "(warming up the simulator…)"
                : "(the first run after idle can take ~60s while the simulator warms up; warm runs are 5–30s)"}
            </span>
          </span>
          <button
            type="button"
            onClick={() => {
              stopRef.current = true;
              setPhase("idle");
              setError(null);
            }}
            style={{
              marginLeft: "auto",
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: 4,
              background: "transparent",
              color: "var(--muted)",
              border: "1px solid var(--border)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {phase === "unsupported" && result && (
        <div className="degraded" style={{ marginTop: 4 }}>
          This assembly isn&apos;t simulatable yet: {result.reason}. The diff-drive
          navigation slice is what ships today; other goal kinds are honest
          &quot;not yet&quot; rather than a fake pass.
          {needsBase && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={() => run(true)}
                style={{
                  fontSize: 13,
                  padding: "7px 13px",
                  borderRadius: 6,
                  background: "var(--accent)",
                  color: "#fff",
                  border: 0,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Add a generic mobile base &amp; simulate →
              </button>
            </div>
          )}
        </div>
      )}

      {phase === "done" && result && (
        <div
          style={{
            border: `1px solid ${result.success ? "var(--ok)" : "var(--danger, #ef4444)"}`,
            borderRadius: 8,
            padding: 14,
            background: result.success
              ? "rgba(34,197,94,0.10)"
              : "rgba(239,68,68,0.08)",
          }}
        >
          <div
            style={{
              fontWeight: 700,
              color: result.success ? "var(--ok)" : "var(--fail, #ef4444)",
              marginBottom: 8,
            }}
          >
            {result.success ? "Reached the goal" : "Did not reach the goal"}
            <span
              style={{
                fontSize: 11,
                color: "var(--muted)",
                fontWeight: 400,
                marginLeft: 8,
              }}
            >
              authored by {result.authored_by}
              {result.iterations && result.iterations > 1
                ? ` · ${result.iterations} agent iters`
                : ""}
            </span>
          </div>

          {usedBase && (
            <div
              className="proposal-disclaimer"
              style={{ marginTop: 0, marginBottom: 10 }}
            >
              Previewed on a generic diff-drive base we added for this run — your
              build doesn&apos;t include a drivable base. Add a wheeled base (e.g. a
              Roomba, iRobot Create 3, or TurtleBot) to your idea to simulate the
              real chassis.
            </div>
          )}

          {result.robot && result.robot.mounted_parts.length > 0 && (
            <div
              style={{
                fontSize: 12,
                color: "var(--muted)",
                marginBottom: 10,
                lineHeight: 1.5,
              }}
            >
              Simulating the full buildout:{" "}
              <strong style={{ color: "var(--fg)" }}>
                {result.robot.device_id}
              </strong>{" "}
              base +{" "}
              {result.robot.mounted_parts.map((p, i) => (
                <span key={p.ref}>
                  {i > 0 ? ", " : ""}
                  {p.name}
                  <span style={{ opacity: 0.7 }}> ({p.mass_kg}kg)</span>
                </span>
              ))}{" "}
              · total{" "}
              <strong style={{ color: "var(--fg)" }}>
                {result.robot.total_mass_kg}kg
              </strong>
            </div>
          )}

          {result.artifacts.hero && (
            <div style={{ marginBottom: 10 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 6,
                }}
              >
                High-fidelity render
              </div>
              <img
                src={result.artifacts.hero}
                alt="High-fidelity studio render of the assembled robot"
                style={{
                  width: "100%",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "#000",
                  display: "block",
                }}
              />
            </div>
          )}

          {result.artifacts.video ? (
            <video
              src={result.artifacts.video}
              controls
              autoPlay
              loop
              muted
              playsInline
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "#000",
              }}
            />
          ) : (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              (No video rendered — telemetry only.)
            </div>
          )}

          <FailureBadges telemetry={result.telemetry} />

          {result.post_mortem && (
            <div style={{ fontSize: 14, marginTop: 10, lineHeight: 1.5 }}>
              {result.post_mortem}
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 8,
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px solid var(--border)",
            }}
          >
            <Stat
              label="Final distance"
              value={`${(telemNum(result.telemetry, "final_dist") ?? 0).toFixed(2)} m`}
            />
            <Stat
              label="Closest"
              value={`${(telemNum(result.telemetry, "min_dist") ?? 0).toFixed(2)} m`}
            />
            <Stat
              label="Collisions"
              value={telemNum(result.telemetry, "collisions") ?? 0}
            />
            {result.robot && (
              <Stat
                label="Mass"
                value={`${result.robot.total_mass_kg} kg (${result.robot.mounted_parts.length} parts mounted)`}
              />
            )}
          </div>

          {result.artifacts.summary && (
            <a
              href={result.artifacts.summary}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-block",
                marginTop: 12,
                fontSize: 13,
                padding: "7px 13px",
                borderRadius: 6,
                background: "var(--accent)",
                color: "#fff",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Open full summary ↗
            </a>
          )}

          {result.artifacts.scene && (
            <div style={{ marginTop: 10, fontSize: 12 }}>
              <a href={result.artifacts.scene} target="_blank" rel="noreferrer">
                scene.xml
              </a>
              {result.artifacts.control && (
                <>
                  {" · "}
                  <a
                    href={result.artifacts.control}
                    target="_blank"
                    rel="noreferrer"
                  >
                    control.py
                  </a>
                </>
              )}
              {result.artifacts.telemetry && (
                <>
                  {" · "}
                  <a
                    href={result.artifacts.telemetry}
                    target="_blank"
                    rel="noreferrer"
                  >
                    telemetry.json
                  </a>
                </>
              )}
              {result.artifacts.schematic && (
                <>
                  {" · "}
                  <a
                    href={result.artifacts.schematic}
                    target="_blank"
                    rel="noreferrer"
                  >
                    schematic.svg
                  </a>
                </>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => run(usedBase)}
            disabled={busy}
            style={{
              marginTop: 12,
              fontSize: 12,
              padding: "6px 12px",
              borderRadius: 4,
              background: "transparent",
              color: "var(--muted)",
              border: "1px solid var(--border)",
              cursor: "pointer",
            }}
          >
            Run again
          </button>
        </div>
      )}
    </div>
  );
}
