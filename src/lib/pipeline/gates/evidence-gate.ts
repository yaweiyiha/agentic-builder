/**
 * runEvidenceGate — central enforcer for "no completion claim without evidence".
 *
 * Each pipeline stage that wants to advance must accumulate an Evidence[]
 * array and call this function before its result is propagated. The gate:
 *
 *   1. Looks up the stage's required-evidence list from EVIDENCE_POLICIES.
 *   2. For each requirement, checks whether any Evidence in the supplied
 *      array matches its predicate.
 *   3. Rejects any stage whose evidence is *only* an llm-self-check — the
 *      LLM cannot self-attest its own completion.
 *
 * Returns a `GateReportBase` so the report can flow through existing
 * gate-aware UI surfaces without extra plumbing.
 */

import type {
  Evidence,
  GateReportBase,
} from "@/lib/requirements/prd-spec-types";
import {
  EVIDENCE_POLICIES,
  type EvidenceStage,
  type EvidenceRequirement,
} from "./evidence-requirements";

export interface EvidenceGateResult extends GateReportBase {
  /** Echo of the input evidence — useful for SSE/UI consumers that want
   *  to render the same evidence list the gate evaluated. */
  evidence: Evidence[];
  /** Plain-English description of each missing requirement, in policy
   *  order. Empty when `passed=true`. */
  missingRequirements: string[];
}

export function runEvidenceGate(
  stage: EvidenceStage,
  evidence: Evidence[],
): EvidenceGateResult {
  const policy = EVIDENCE_POLICIES[stage];

  const matched = new Set<EvidenceRequirement>();
  for (const req of policy.required) {
    if (evidence.some((e) => req.matcher(e))) {
      matched.add(req);
    }
  }

  const missingRequirements = policy.required
    .filter((r) => !r.optional && !matched.has(r))
    .map((r) => r.description);

  const hasOnlyLlmSelfCheck =
    evidence.length > 0 && evidence.every((e) => e.kind === "llm-self-check");

  const warnings: string[] = [];
  if (hasOnlyLlmSelfCheck) {
    warnings.push(
      "Stage produced only `llm-self-check` evidence — at least one independent validator or command evidence is required.",
    );
  }

  const passed = missingRequirements.length === 0 && !hasOnlyLlmSelfCheck;

  return {
    gateId: `evidence-${stage}`,
    passed,
    warnings,
    missingIds: [],
    evidence,
    missingRequirements,
  };
}

/**
 * Convenience: build an Evidence record with sensible defaults. Callers
 * should still pass `passed` explicitly so the boolean is auditable.
 */
export function makeEvidence(
  partial: Omit<Evidence, "producedAt"> & { producedAt?: string },
): Evidence {
  return {
    producedAt: partial.producedAt ?? new Date().toISOString(),
    ...partial,
  };
}
