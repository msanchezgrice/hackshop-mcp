import type {
  Assembly,
  DeviceCapability,
  FeasibilityCheck,
  FeasibilityProvenance,
  FeasibilityReport,
  FeasibilityStatus,
  FeasibilityVerdict,
} from "./assembly";

// ─────────────────────────────────────────────────────────────────────────
// Feasibility DRC — static "could this actually work?" checks over an
// Assembly IR + a device_id → DeviceCapability map.
//
// Design rules:
//   • Honest by construction. Missing inputs => "unknown", never a fake pass.
//   • Provenance-aware. A mismatch backed by a declared spec field is a "fail";
//     the same mismatch inferred from capability text ("derived") is only a
//     "warn" — we never hard-fail on a heuristic.
//   • Pure & dependency-free (types only). Unit-tested without catalogs/Next.
// ─────────────────────────────────────────────────────────────────────────

const PROV_RANK: Record<FeasibilityProvenance, number> = {
  unknown: 0,
  derived: 1,
  spec: 2,
};

// Weakest (least-confident) of two provenances drives a check's reported
// confidence — one heuristic input makes the whole check heuristic.
function weakest(
  a: FeasibilityProvenance,
  b: FeasibilityProvenance,
): FeasibilityProvenance {
  return PROV_RANK[a] <= PROV_RANK[b] ? a : b;
}

const EMPTY_CAP: DeviceCapability = {
  interfaces: [],
  interfaces_provenance: "unknown",
};

export function checkFeasibility(
  assembly: Assembly,
  caps: Map<string, DeviceCapability>,
): FeasibilityReport {
  const capForRef = (ref: string): DeviceCapability => {
    const comp = assembly.components.find((c) => c.ref === ref);
    if (!comp) return EMPTY_CAP;
    return caps.get(comp.device_id) ?? EMPTY_CAP;
  };

  const checks: FeasibilityCheck[] = [
    checkInterfaces(assembly, capForRef),
    checkPower(assembly, caps),
    checkMassPayload(assembly, caps),
    checkStructural(assembly),
  ];

  return { ...rollUp(checks), checks };
}

// ── 1. Interface compatibility ─────────────────────────────────────────────
// Every non-power edge's transport must be supported by both endpoints that
// declare interfaces. Endpoints with unknown interfaces contribute "unknown",
// not a failure.
function checkInterfaces(
  assembly: Assembly,
  capForRef: (ref: string) => DeviceCapability,
): FeasibilityCheck {
  const dataEdges = assembly.edges.filter((e) => e.transport !== "power");
  if (dataEdges.length === 0) {
    return {
      id: "interfaces",
      label: "Interface compatibility",
      status: "unknown",
      detail: "No data-bearing connections were declared to check.",
      provenance: "unknown",
    };
  }

  const mismatches: string[] = [];
  let sawPass = false;
  let sawUnknown = false;
  let worst: FeasibilityStatus = "unknown";
  // Start at the most-confident; weakest() only pulls it down for edges that
  // actually have known endpoints. If no edge is known, `worst` stays "unknown"
  // and the return guard reports provenance "unknown" anyway.
  let prov: FeasibilityProvenance = "spec";
  const bump = (s: FeasibilityStatus) => {
    if (rank(s) > rank(worst)) worst = s;
  };

  for (const e of dataEdges) {
    const endpoints = [
      { ref: e.from, cap: capForRef(e.from) },
      { ref: e.to, cap: capForRef(e.to) },
    ];
    const known = endpoints.filter((p) => p.cap.interfaces.length > 0);
    if (known.length === 0) {
      sawUnknown = true;
      continue;
    }
    const offenders = known.filter(
      (p) => !p.cap.interfaces.includes(e.transport),
    );
    const edgeProv = known.reduce<FeasibilityProvenance>(
      (acc, p) => weakest(acc, p.cap.interfaces_provenance),
      "spec",
    );
    prov = weakest(prov, edgeProv);
    if (offenders.length === 0) {
      sawPass = true;
      continue;
    }
    // Mismatch: hard fail only when backed by a declared spec field.
    const status: FeasibilityStatus = edgeProv === "spec" ? "fail" : "warn";
    bump(status);
    for (const o of offenders) {
      mismatches.push(`${o.ref} lacks ${e.transport} (edge ${e.from}→${e.to})`);
    }
  }

  // If no mismatch bumped worst, settle on pass/unknown.
  if (worst === "unknown") {
    if (sawPass) worst = "pass";
  }
  const detail =
    mismatches.length > 0
      ? `Interface mismatches: ${mismatches.join("; ")}.`
      : sawPass
        ? `All ${dataEdges.length} declared connection(s) have compatible transports${
            sawUnknown ? " (some endpoints had no interface data)" : ""
          }.`
        : "No endpoints declared interface data for the connections.";

  return {
    id: "interfaces",
    label: "Interface compatibility",
    status: worst,
    detail,
    provenance: worst === "unknown" ? "unknown" : prov,
  };
}

// ── 2. Power budget ─────────────────────────────────────────────────────────
// Total draw must fit total supply. Incomplete draw data softens a pass to a
// warning (we can't certify a budget we can't fully see).
function checkPower(
  assembly: Assembly,
  caps: Map<string, DeviceCapability>,
): FeasibilityCheck {
  let supply = 0;
  let supplyCount = 0;
  let draw = 0;
  let drawCount = 0;
  let missingDraw = 0;

  for (const c of assembly.components) {
    const cap = caps.get(c.device_id) ?? EMPTY_CAP;
    if (typeof cap.power_supply_w === "number") {
      supply += cap.power_supply_w;
      supplyCount += 1;
    }
    if (typeof cap.power_draw_w === "number") {
      draw += cap.power_draw_w;
      drawCount += 1;
    } else if (c.role === "compute" || c.role === "actuator") {
      // Active loads with no datasheet draw — budget is incomplete.
      missingDraw += 1;
    }
  }

  if (supplyCount === 0 || drawCount === 0) {
    return {
      id: "power",
      label: "Power budget",
      status: "unknown",
      detail:
        supplyCount === 0
          ? "No component declares a power supply, so the budget can't be evaluated."
          : "No component declares power draw, so the budget can't be evaluated.",
      provenance: "unknown",
    };
  }

  let status: FeasibilityStatus;
  if (draw > supply) status = "fail";
  else if (draw > 0.8 * supply) status = "warn"; // within 20% headroom = tight
  else status = "pass";

  // Incomplete draw data can only make us less sure, never more: a clean pass
  // with unaccounted loads becomes a warning.
  let provenance: FeasibilityProvenance = "spec";
  if (missingDraw > 0 && status === "pass") {
    status = "warn";
    provenance = "derived";
  }

  const detail =
    `Draw ≈ ${round(draw)} W across ${drawCount} component(s) vs supply ≈ ${round(
      supply,
    )} W` +
    (missingDraw > 0
      ? `; ${missingDraw} active component(s) lack draw data.`
      : `.`);

  return { id: "power", label: "Power budget", status, detail, provenance };
}

// ── 3. Mass vs payload ──────────────────────────────────────────────────────
// For mobile goals, the base's rated payload must cover everything it carries.
function checkMassPayload(
  assembly: Assembly,
  caps: Map<string, DeviceCapability>,
): FeasibilityCheck {
  const kind = assembly.goal.kind;
  const mobile = kind === "navigate" || kind === "locomote";
  if (!mobile) {
    return {
      id: "mass-payload",
      label: "Mass vs payload",
      status: "unknown",
      detail: `Goal "${kind}" does not impose a mobile payload constraint.`,
      provenance: "unknown",
    };
  }

  // Pick the load-bearing base = chassis with the largest declared payload.
  let base: { ref: string; payload: number } | null = null;
  for (const c of assembly.components) {
    if (c.role !== "chassis") continue;
    const p = caps.get(c.device_id)?.payload_kg;
    if (typeof p === "number" && (base === null || p > base.payload)) {
      base = { ref: c.ref, payload: p };
    }
  }
  if (!base) {
    return {
      id: "mass-payload",
      label: "Mass vs payload",
      status: "unknown",
      detail: "No chassis declares a rated payload, so load can't be checked.",
      provenance: "unknown",
    };
  }

  let carried = 0;
  let massKnown = 0;
  for (const c of assembly.components) {
    if (c.ref === base.ref) continue;
    const m = caps.get(c.device_id)?.mass_kg;
    if (typeof m === "number") {
      carried += m;
      massKnown += 1;
    }
  }
  if (massKnown === 0) {
    return {
      id: "mass-payload",
      label: "Mass vs payload",
      status: "unknown",
      detail: `Base "${base.ref}" carries ${base.payload} kg, but no carried component declares mass.`,
      provenance: "unknown",
    };
  }

  let status: FeasibilityStatus;
  if (carried > base.payload) status = "fail";
  else if (carried > 0.9 * base.payload) status = "warn";
  else status = "pass";

  return {
    id: "mass-payload",
    label: "Mass vs payload",
    status,
    detail: `Carrying ≈ ${round(carried)} kg on a ${base.payload} kg-rated base (${massKnown} component mass(es) counted).`,
    provenance: "spec",
  };
}

// ── 4. Structural completeness ───────────────────────────────────────────────
// Does the declared component set contain the roles the goal needs? This is a
// deterministic check over our own role assignment, so it's "spec".
function checkStructural(assembly: Assembly): FeasibilityCheck {
  const roles = new Set<string>(assembly.components.map((c) => c.role));
  const integratedProducts: string[] = [];
  for (const component of assembly.components) {
    if (component.device_id === "turtlebot-4-lite") {
      // Clearpath ships the Lite as one integrated product with its Create 3
      // chassis, Raspberry Pi 4 compute, OAK-D camera, and RPLIDAR already
      // installed. Do not invent duplicate BOM rows just to satisfy role DRC.
      roles.add("compute");
      roles.add("sensor");
      integratedProducts.push(component.name);
    }
  }
  const need: Record<Assembly["goal"]["kind"], string[]> = {
    navigate: ["compute", "chassis"],
    locomote: ["compute", "chassis"],
    manipulate: ["compute", "actuator"],
    "sense-act": ["compute", "sensor"],
    "display-loop": ["compute", "display"],
  };
  const required = need[assembly.goal.kind];
  const missing = required.filter((r) => !roles.has(r));

  if (missing.length > 0) {
    return {
      id: "structural",
      label: "Structural completeness",
      status: "fail",
      detail: `Goal "${assembly.goal.kind}" needs ${required.join(
        " + ",
      )}; missing ${missing.join(", ")}.`,
      provenance: "spec",
    };
  }
  return {
    id: "structural",
    label: "Structural completeness",
    status: "pass",
    detail: `All roles required for "${assembly.goal.kind}" are present (${required.join(
      " + ",
    )})${
      integratedProducts.length > 0
        ? `; integrated by ${integratedProducts.join(", ")}`
        : ""
    }.`,
    provenance: "spec",
  };
}

// ── Verdict roll-up ──────────────────────────────────────────────────────────
function rank(s: FeasibilityStatus): number {
  switch (s) {
    case "fail":
      return 3;
    case "warn":
      return 2;
    case "pass":
      return 1;
    case "unknown":
      return 0;
  }
}

function rollUp(checks: FeasibilityCheck[]): {
  verdict: FeasibilityVerdict;
  summary: string;
} {
  const n = (s: FeasibilityStatus) =>
    checks.filter((c) => c.status === s).length;
  const fail = n("fail");
  const warn = n("warn");
  const pass = n("pass");
  const unknown = n("unknown");

  let verdict: FeasibilityVerdict;
  let lead: string;
  if (fail > 0) {
    verdict = "infeasible";
    lead = "Infeasible as specified";
  } else if (warn > 0) {
    verdict = "feasible-with-warnings";
    lead = "Feasible with warnings";
  } else if (pass > 0) {
    // Passes with some unverified checks still count as feasible — the counts
    // make the uncertainty explicit.
    verdict = unknown > 0 ? "feasible-with-warnings" : "feasible";
    lead = unknown > 0 ? "Likely feasible (some checks unverified)" : "Feasible";
  } else {
    verdict = "unknown";
    lead = "Not enough data to assess feasibility";
  }

  const summary = `${lead}: ${pass} pass, ${warn} warn, ${fail} fail, ${unknown} unknown.`;
  return { verdict, summary };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
