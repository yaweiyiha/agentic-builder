export { runPrdSpecGate } from "./prd-spec-gate";
export type { PrdSpecGateResult } from "./prd-spec-gate";
export { runQaCoverageGate } from "./qa-coverage-gate";
export { runTaskCoverageGate } from "./task-coverage-gate";
export { runPhaseRequirementGate } from "./phase-requirement-gate";
export type { PhaseRequirementGateInput } from "./phase-requirement-gate";
export { runEvidenceGate, makeEvidence } from "./evidence-gate";
export type { EvidenceGateResult } from "./evidence-gate";
export {
  EVIDENCE_POLICIES,
  byKindAndName,
  byCommandPrefix,
} from "./evidence-requirements";
export type {
  EvidenceStage,
  EvidenceRequirement,
  EvidenceStagePolicy,
} from "./evidence-requirements";
export {
  evidenceFromRuntimeSmokeGate,
  evidenceFromTscDiagnostics,
  evidenceFromTddReview,
  evidenceFromPrdSpecGate,
  evidenceFromGateReport,
  evidenceFromRulesValidation,
  evidenceFromDagValidation,
} from "./evidence-adapters";
export { collectCodingStageEvidence } from "./coding-stage-evidence";
export type { CollectCodingStageEvidenceResult } from "./coding-stage-evidence";
