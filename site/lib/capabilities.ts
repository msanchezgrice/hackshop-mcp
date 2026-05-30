import "server-only";
import { loadCatalog } from "./catalog";
import { loadPremiumCatalog } from "./premium";
import type { DeviceCapability, ComponentRole } from "./assembly";

// ─────────────────────────────────────────────────────────────────────────
// Capability index — device_id → simulation-relevant capability + metadata.
//
// Three sources, in precedence order:
//   1. Declared spec fields on the catalog entry (interfaces/power/mass/...).
//   2. SIM_CAPABILITY_OVERRIDES below — hand-verified numbers for the devices
//      in the active simulation slice. Lives here (not in the big JSON) so it's
//      reviewable in one place and free of the catalog's mixed unicode escaping.
//   3. Heuristic derivation from capability/software text (provenance "derived").
//
// Honesty rule (mirrors src/safety.ts): when we have nothing, `interfaces` is
// empty and provenance is "unknown". The feasibility DRC reports that as
// "unknown", never a fabricated pass.
// ─────────────────────────────────────────────────────────────────────────

export interface DeviceMeta {
  id: string;
  name: string;
  category: string;
  source: "catalog" | "premium";
  defaultRole: ComponentRole;
  capability: DeviceCapability;
}

interface CapabilitySeed {
  interfaces?: string[];
  power_draw_w?: number;
  power_supply_w?: number;
  mass_kg?: number;
  payload_kg?: number;
}

// Hand-verified slice data. Numbers are conservative, order-of-magnitude
// honest figures from datasheets/product pages — enough for the DRC to produce
// real pass/fail on the first vertical slices (navigate / manipulate / locomote).
const SIM_CAPABILITY_OVERRIDES: Record<string, CapabilitySeed> = {
  // ── Diff-drive navigation slice ──────────────────────────────────────
  "irobot-create-3": {
    interfaces: ["ros2", "wifi", "usb", "power"],
    power_supply_w: 15, // powers an onboard Pi over USB-C (as in TurtleBot 4)
    mass_kg: 3.0,
    payload_kg: 9.0, // Roomba i-series chassis carrying capacity
  },
  "turtlebot-4-lite": {
    interfaces: ["ros2", "wifi", "usb", "power"],
    power_supply_w: 15,
    mass_kg: 3.5,
    payload_kg: 9.0,
  },
  "raspberry-pi-5": {
    interfaces: ["usb", "hdmi", "gpio", "i2c", "spi", "uart", "wifi", "ble"],
    power_draw_w: 12, // peak under load
    mass_kg: 0.045,
  },
  "raspberry-pi-zero-2-w": {
    interfaces: ["usb", "hdmi", "gpio", "i2c", "spi", "uart", "wifi", "ble"],
    power_draw_w: 3,
    mass_kg: 0.011,
  },
  "adafruit-vl53l4cd": {
    interfaces: ["i2c"],
    power_draw_w: 0.1,
    mass_kg: 0.002,
  },
  // ── Manipulation slice (LeRobot arms) ────────────────────────────────
  "lerobot-so-arm100": {
    interfaces: ["usb", "uart"],
    power_draw_w: 30,
    mass_kg: 1.0,
    payload_kg: 0.5,
  },
  "so-arm101": {
    interfaces: ["usb", "uart"],
    power_draw_w: 35,
    mass_kg: 1.2,
    payload_kg: 0.5,
  },
  "koch-v1-1": {
    interfaces: ["usb", "uart"],
    power_draw_w: 30,
    mass_kg: 1.0,
    payload_kg: 0.4,
  },
  // ── Legged locomotion slice (deferred to Phase 3, data seeded now) ────
  "mini-pupper-2": {
    interfaces: ["ros2", "wifi", "usb"],
    power_draw_w: 25,
    mass_kg: 0.7,
    payload_kg: 0.2,
  },
  "petoi-bittle": {
    interfaces: ["ble", "usb", "uart"],
    power_draw_w: 10,
    mass_kg: 0.28,
    payload_kg: 0.1,
  },
};

// Transport tokens we recognize when scanning free text. Keyed by the canonical
// Transport value; each entry is a list of regexes that imply it.
const TRANSPORT_PATTERNS: Array<[string, RegExp[]]> = [
  ["ros2", [/\bros\s*2\b/i, /\brclpy\b/i, /\bnav2\b/i, /\bros 2\b/i]],
  ["wifi", [/wi-?fi/i, /802\.11/i, /\bwlan\b/i]],
  ["ble", [/\bble\b/i, /bluetooth/i]],
  ["usb", [/\busb\b/i, /usb-?c/i]],
  ["i2c", [/\bi2c\b/i, /i\u00b2c/i, /stemma/i, /qwiic/i, /\bgrove\b/i, /qw\/st/i]],
  ["spi", [/\bspi\b/i, /qspi/i]],
  ["uart", [/\buart\b/i, /\bserial\b/i, /dynamixel/i]],
  ["gpio", [/\bgpio\b/i, /\bpru\b/i]],
  ["hdmi", [/hdmi/i]],
  ["aux", [/\baux\b/i, /3\.5\s?mm/i, /headphone/i]],
];

function deriveInterfaces(tokens: string[]): string[] {
  const haystack = tokens.join(" \u00b7 ");
  const found = new Set<string>();
  for (const [transport, patterns] of TRANSPORT_PATTERNS) {
    if (patterns.some((re) => re.test(haystack))) found.add(transport);
  }
  return [...found];
}

// Map a catalog category to a best-guess Assembly role. The LLM generator
// refines these; this is the deterministic-fallback default.
const USED_CATEGORY_ROLE: Record<string, ComponentRole> = {
  display: "display",
  speaker: "peripheral",
  input: "peripheral",
  sensor: "sensor",
  bulb: "peripheral",
  sbc: "compute",
  handheld: "compute",
  "mini-pc": "compute",
  wearable: "peripheral",
  router: "peripheral",
  other: "peripheral",
};

const PREMIUM_CATEGORY_ROLE: Record<string, ComponentRole> = {
  robot: "chassis",
  drone: "chassis",
  sbc: "compute",
  computer: "compute",
  wearable: "peripheral",
  display: "display",
  audio: "peripheral",
  sensor: "sensor",
  tool: "peripheral",
};

// A robot named/described as an arm is an actuator end-effector, not a base.
function refineRobotRole(name: string, text: string): ComponentRole {
  const h = `${name} ${text}`.toLowerCase();
  if (/\barm\b|gripper|manipulat|servo arm|dof.*arm/.test(h)) return "actuator";
  return "chassis";
}

let cached: Map<string, DeviceMeta> | null = null;

export function loadDeviceDirectory(): Map<string, DeviceMeta> {
  if (cached) return cached;
  const dir = new Map<string, DeviceMeta>();

  const { devices } = loadCatalog();
  for (const d of devices) {
    const declared = (d as { interfaces?: string[] }).interfaces;
    const override = SIM_CAPABILITY_OVERRIDES[d.id];
    const derived = deriveInterfaces([
      ...d.idea_fit_tags,
      d.notes,
      d.category,
    ]);
    dir.set(d.id, {
      id: d.id,
      name: d.name,
      category: d.category,
      source: "catalog",
      defaultRole: USED_CATEGORY_ROLE[d.category] ?? "peripheral",
      capability: mergeCapability(d, declared, override, derived),
    });
  }

  const premium = loadPremiumCatalog();
  for (const d of premium) {
    const declared = (d as { interfaces?: string[] }).interfaces;
    const override = SIM_CAPABILITY_OVERRIDES[d.id];
    const derived = deriveInterfaces([
      ...d.capabilities,
      ...d.software_stack,
      ...d.idea_fit_tags,
      d.notes,
    ]);
    const baseRole = PREMIUM_CATEGORY_ROLE[d.category] ?? "peripheral";
    const role =
      d.category === "robot"
        ? refineRobotRole(d.name, [...d.capabilities, d.notes].join(" "))
        : baseRole;
    dir.set(d.id, {
      id: d.id,
      name: d.name,
      category: d.category,
      source: "premium",
      defaultRole: role,
      capability: mergeCapability(d, declared, override, derived),
    });
  }

  cached = dir;
  return dir;
}

function mergeCapability(
  device: Record<string, unknown>,
  declared: string[] | undefined,
  override: CapabilitySeed | undefined,
  derived: string[],
): DeviceCapability {
  // Interfaces: declared spec wins, then override (spec), then derived.
  let interfaces: string[];
  let interfaces_provenance: DeviceCapability["interfaces_provenance"];
  if (declared && declared.length > 0) {
    interfaces = declared;
    interfaces_provenance = "spec";
  } else if (override?.interfaces && override.interfaces.length > 0) {
    interfaces = override.interfaces;
    interfaces_provenance = "spec";
  } else if (derived.length > 0) {
    interfaces = derived;
    interfaces_provenance = "derived";
  } else {
    interfaces = [];
    interfaces_provenance = "unknown";
  }

  const num = (k: string): number | undefined => {
    const v = device[k];
    return typeof v === "number" ? v : undefined;
  };

  return {
    interfaces,
    interfaces_provenance,
    power_draw_w: num("power_draw_w") ?? override?.power_draw_w,
    power_supply_w: num("power_supply_w") ?? override?.power_supply_w,
    mass_kg: num("mass_kg") ?? override?.mass_kg,
    payload_kg: num("payload_kg") ?? override?.payload_kg,
  };
}

// Convenience for the feasibility pass: a device_id → DeviceCapability map for
// just the components in an assembly.
export function capabilityMapFor(
  deviceIds: string[],
): Map<string, DeviceCapability> {
  const dir = loadDeviceDirectory();
  const map = new Map<string, DeviceCapability>();
  for (const id of deviceIds) {
    const meta = dir.get(id);
    if (meta) map.set(id, meta.capability);
  }
  return map;
}
