import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────
// Assembly IR — the machine-consumable description of a proposed robot.
//
// Today a proposal is loose markdown. This promotes it to structured data so a
// downstream feasibility check (and, in V2, a physics simulator) can reason
// about it. The protocol graph already exists implicitly in the diagram prompt
// (`app/api/diagram/route.ts`) — this is that graph, made explicit.
//
// Pure schema module: no `server-only`, no Next aliases. Imported by both the
// API route (server) and the React components (types only), and unit-tested
// directly. Keep it dependency-free beyond zod.
// ─────────────────────────────────────────────────────────────────────────

export const ComponentRole = z.enum([
  "compute",
  "actuator",
  "sensor",
  "display",
  "power",
  "chassis",
  "peripheral",
]);
export type ComponentRole = z.infer<typeof ComponentRole>;

// Transports a protocol edge can carry. Lowercase tokens; "power" is modeled as
// a transport so the diagram and the power budget share one vocabulary.
export const Transport = z.enum([
  "usb",
  "i2c",
  "spi",
  "gpio",
  "uart",
  "wifi",
  "ble",
  "ros2",
  "hdmi",
  "aux",
  "power",
]);
export type Transport = z.infer<typeof Transport>;

// Resolved simulation handle. NOT populated in Phase 0 (no physics yet); the
// Asset Resolver fills this in Phase 1. Kept optional so the IR is forward-
// compatible without forcing sim data now.
export const SimHandle = z.object({
  model_uri: z.string().optional(),
  format: z.enum(["mjcf", "urdf", "proxy"]).optional(),
  dof: z.number().int().nonnegative().optional(),
  mass_kg: z.number().positive().optional(),
});
export type SimHandle = z.infer<typeof SimHandle>;

export const AssemblyComponent = z.object({
  // `ref` is a stable handle used by edges (component-local; we don't require
  // device_ids to be unique within an assembly, e.g. two identical motors).
  ref: z.string().min(1),
  device_id: z.string().min(1), // links to catalog.json / premium-catalog.json
  name: z.string().min(1),
  role: ComponentRole,
  sim: SimHandle.optional(),
});
export type AssemblyComponent = z.infer<typeof AssemblyComponent>;

export const ProtocolEdge = z.object({
  from: z.string().min(1), // component ref
  to: z.string().min(1), // component ref
  transport: Transport,
  payload: z.string().optional(), // "/cmd_vel", "frame buffer", "5V@2A"
});
export type ProtocolEdge = z.infer<typeof ProtocolEdge>;

export const AssemblyGoal = z.object({
  kind: z.enum([
    "navigate",
    "locomote",
    "manipulate",
    "sense-act",
    "display-loop",
  ]),
  spec: z.string().min(1), // "reach the goal marker without hitting obstacles"
  success_metric: z.string().min(1), // "within 0.3m of goal for >2s, zero collisions"
});
export type AssemblyGoal = z.infer<typeof AssemblyGoal>;

export const WorldSpec = z.object({
  template: z.enum([
    "empty-room",
    "obstacle-course",
    "ramp",
    "stairs",
    "outdoor-flat",
    "tabletop",
  ]),
  goal_xy: z.tuple([z.number(), z.number()]).optional(),
});
export type WorldSpec = z.infer<typeof WorldSpec>;

export const Assembly = z.object({
  idea: z.string().min(1),
  components: z.array(AssemblyComponent).min(1),
  edges: z.array(ProtocolEdge).default([]),
  goal: AssemblyGoal,
  world: WorldSpec,
});
export type Assembly = z.infer<typeof Assembly>;

// ─────────────────────────────────────────────────────────────────────────
// Build Plan — the "steps of assembly" deliverable. Text + typed data, never
// physically simulated (per the V2 scope decision).
// ─────────────────────────────────────────────────────────────────────────

export const BuildAction = z.enum([
  "solder",
  "flash",
  "glue",
  "connect",
  "crimp",
  "mount",
  "print_3d",
  "calibrate",
  "test",
]);
export type BuildAction = z.infer<typeof BuildAction>;

export const BuildStep = z.object({
  order: z.number().int().positive(),
  action: BuildAction,
  parts: z.array(z.string()).default([]), // device_ids + consumables ("jumper wires", "M2 screws")
  tools: z.array(z.string()).default([]), // "soldering iron", "USB cable", "3D printer"
  detail: z.string().min(1), // one imperative sentence
  est_minutes: z.number().int().positive(),
  // brick-risk aware. null when there's nothing to warn about. Set by the
  // safety pass (mirrors src/safety.ts) for flash steps on unverified devices.
  risk_note: z.string().nullable().default(null),
  depends_on: z.array(z.number().int()).default([]), // step orders this depends on
});
export type BuildStep = z.infer<typeof BuildStep>;

export const BuildPlan = z.object({
  steps: z.array(BuildStep).default([]),
  total_minutes: z.number().int().nonnegative().default(0),
});
export type BuildPlan = z.infer<typeof BuildPlan>;

// ─────────────────────────────────────────────────────────────────────────
// Feasibility DRC — "could this actually work?" as static rule checks.
// Honest by construction: missing data yields "unknown", never a fake "pass".
// ─────────────────────────────────────────────────────────────────────────

export type FeasibilityStatus = "pass" | "warn" | "fail" | "unknown";

// How confident we are in the inputs to a check. "derived" = inferred from
// capability/software text rather than declared spec fields → softens fails to
// warns so we never hard-fail on a heuristic.
export type FeasibilityProvenance = "spec" | "derived" | "unknown";

// Normalized, simulation-relevant capability for one device. Built by
// capabilities.ts from catalog spec fields (provenance "spec"), an override
// table for the active slice (also "spec"), or heuristics over capability text
// (provenance "derived"). Empty `interfaces` => "unknown". Lives here (pure
// module) so the feasibility engine can be unit-tested without the catalogs.
export interface DeviceCapability {
  interfaces: string[]; // Transport tokens
  interfaces_provenance: FeasibilityProvenance;
  power_draw_w?: number; // typical consumption
  power_supply_w?: number; // what a battery/PSU/host can provide
  mass_kg?: number;
  payload_kg?: number; // rated load for actuators/chassis
}

export interface FeasibilityCheck {
  id: string;
  label: string;
  status: FeasibilityStatus;
  detail: string;
  provenance: FeasibilityProvenance;
}

export type FeasibilityVerdict =
  | "feasible"
  | "feasible-with-warnings"
  | "infeasible"
  | "unknown";

export interface FeasibilityReport {
  verdict: FeasibilityVerdict;
  summary: string;
  checks: FeasibilityCheck[];
}

// ─────────────────────────────────────────────────────────────────────────
// API contract
// ─────────────────────────────────────────────────────────────────────────

export const assemblyInput = z.object({
  idea: z.string().min(3, "idea is too short").max(2000, "idea is too long"),
  device_ids: z.array(z.string().min(1)).min(1, "pick at least one device").max(12),
});
export type AssemblyInput = z.infer<typeof assemblyInput>;

export interface AssemblyResponse {
  assembly: Assembly;
  build_plan: BuildPlan;
  feasibility: FeasibilityReport;
  degraded: boolean; // true when the LLM pass failed and we used the deterministic fallback
  message?: string;
}
