import type { KickoffWorkItem } from "@/lib/pipeline/types";
import type { ProjectTier } from "@/lib/agents";
import type { GateReportBase } from "@/lib/requirements/prd-spec-types";

export interface PhaseRequirementGateInput {
  tier: ProjectTier;
  tasks: KickoffWorkItem[];
  /** Whether the project is expected to include backend work. */
  needsBackend?: boolean;
}

/**
 * Structural gate: a full-stack project (tier M / L with `needsBackend`) MUST
 * include at least one task classified under a backend-like phase. Without it,
 * routes, data layer and services silently never get generated.
 *
 * `needsBackend` defaults to `true` for tier M and tier L — override to
 * `false` explicitly for frontend-only applications. Tier S is always
 * assumed frontend-only and is allowed to skip backend work.
 */
export function runPhaseRequirementGate(
  input: PhaseRequirementGateInput,
): GateReportBase & { missingPhases: string[] } {
  const { tier, tasks } = input;
  const needsBackend =
    input.needsBackend ?? (tier === "M" || tier === "L");

  if (!needsBackend) {
    return {
      gateId: "phase-requirement",
      passed: true,
      warnings: ["Backend work not required — skipping phase requirement gate."],
      missingIds: [],
      missingPhases: [],
    };
  }

  const hasBackend = tasks.some((t) => isBackendLikePhase(t.phase));
  if (hasBackend) {
    return {
      gateId: "phase-requirement",
      passed: true,
      warnings: [],
      missingIds: [],
      missingPhases: [],
    };
  }

  return {
    gateId: "phase-requirement",
    passed: false,
    warnings: [
      "Full-stack project has no task classified as Backend Services (or any backend-like phase). Routes, data layer and services will not be generated.",
    ],
    missingIds: [],
    missingPhases: ["Backend Services"],
  };
}

function isBackendLikePhase(phase: string | undefined): boolean {
  if (!phase) return false;
  const normalized = phase.toLowerCase();
  return (
    normalized.includes("backend") ||
    normalized.includes("api") ||
    normalized.includes("data layer") ||
    normalized.includes("auth") ||
    normalized.includes("service")
  );
}
