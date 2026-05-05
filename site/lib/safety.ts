import {
  UNRECOVERABLE_BRICK_CATEGORIES,
  type DeviceEntry,
} from "./types";

export interface BrickRiskOutput {
  brick_risk: number | null;
  brick_risk_label: string;
  brick_risk_disclaimer: string | null;
}

// Mirror of src/safety.ts in the parent npm package. P0 — same rule, same
// tests-as-release-gate philosophy. Kept verbatim so the live demo behaves
// identically to the published MCP server.
export function applyBrickRiskSafety(device: DeviceEntry): BrickRiskOutput {
  const isLlmInferred = device.brick_provenance === "llm-inferred";
  const isUnrecoverable = UNRECOVERABLE_BRICK_CATEGORIES.has(device.category);

  if (isLlmInferred && isUnrecoverable) {
    return {
      brick_risk: null,
      brick_risk_label: "brick-risk unknown — research before flashing",
      brick_risk_disclaimer: null,
    };
  }

  if (isLlmInferred) {
    return {
      brick_risk: device.brick_risk,
      brick_risk_label: `${device.brick_risk}/5 (LLM-inferred, unverified)`,
      brick_risk_disclaimer:
        "Brick risk for this device is LLM-inferred and unverified. Confirm with the linked community before flashing.",
    };
  }

  return {
    brick_risk: device.brick_risk,
    brick_risk_label: `${device.brick_risk}/5 (${device.brick_provenance})`,
    brick_risk_disclaimer: null,
  };
}
