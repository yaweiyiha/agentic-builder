// This barrel re-exports every self-heal module, including ones that
// transitively pull in server-only Node APIs (`child_process`, `fs/promises`,
// the langgraph worker graph, etc). It MUST NOT be imported from any
// component that may ship to the browser.
//
// Client-side code that only needs telemetry types (e.g. `RepairEmitter`
// or `getRepairEmitter`) should import from `./events` directly:
//
//     import { getRepairEmitter } from "@/lib/pipeline/self-heal/events";
//
// Server-only code (API routes, the pipeline engine) can import from this
// barrel normally.

export {
  createRepairEmitter,
  noopRepairEmitter,
  consoleRepairSink,
  registerRepairEmitter,
  unregisterRepairEmitter,
  getRepairEmitter,
} from "./events";
export type { RepairEvent, RepairEmitter, RepairStage } from "./events";
export { createJsonlRepairSink } from "./jsonl-sink";
export {
  runFeatureChecklistAudit,
} from "./feature-checklist-audit";
export type {
  AuditEntry,
  AuditTaskSummary,
  AuditVerdict,
  FeatureChecklistAuditInput,
  FeatureChecklistAuditResult,
} from "./feature-checklist-audit";
export { repairTaskCoverage } from "./task-coverage-repair";
export type {
  TaskCoverageRepairInput,
  TaskCoverageRepairResult,
} from "./task-coverage-repair";
export { repairMissingBackendPhase } from "./phase-repair";
export type { PhaseRepairInput, PhaseRepairResult } from "./phase-repair";
export { dispatchAuditRepair } from "./audit-repair-dispatch";
export type {
  AuditRepairDispatchInput,
  AuditRepairDispatchResult,
} from "./audit-repair-dispatch";
export { runContractUsageCoverage } from "./contract-usage-coverage";
export type {
  ContractUsageCoverageInput,
  ContractUsageCoverageResult,
  CoverageCaseId,
  CoverageClassification,
  CoverageRepairTask,
  CoveragePolicy,
} from "./contract-usage-coverage";
export {
  runRuntimeIntegrationAudit,
  formatRuntimeAuditBlock,
} from "./runtime-integration-audit";
export type {
  RuntimeIntegrationAuditInput,
  RuntimeIntegrationAuditResult,
  RuntimeAuditFinding,
  RuntimeAuditRuleId,
  RuntimeAuditScope,
  RuntimeAuditSeverity,
} from "./runtime-integration-audit";
export { runRuntimeSmokeGate } from "./runtime-smoke-gate";
export type {
  RuntimeSmokeFailure,
  RuntimeSmokeFailureCode,
  RuntimeSmokeGateInput,
  RuntimeSmokeGateResult,
  RuntimeSmokeSuccess,
} from "./runtime-smoke-gate";
export { runTscDiagnosticsAsTasks } from "./tsc-diagnostics-as-tasks";
export type {
  TscDiagnosticTask,
  TscDiagnosticsInput,
  TscDiagnosticsResult,
} from "./tsc-diagnostics-as-tasks";
