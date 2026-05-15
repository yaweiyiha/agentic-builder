/**
 * Stage → required-evidence policy table.
 *
 * Each entry declares the evidence a stage MUST produce before its
 * "this stage is complete" signal is accepted. `runEvidenceGate`
 * (./evidence-gate.ts) compares an accumulated `Evidence[]` against this
 * table to decide whether to let the pipeline advance.
 *
 * Strict guardrail: an `llm-self-check` evidence alone is NEVER sufficient.
 * Stages that use one must also produce a `validator` or `command`
 * evidence — this is enforced inside `runEvidenceGate`, not declared here.
 */

import type { Evidence, EvidenceKind } from "@/lib/requirements/prd-spec-types";

export type EvidenceStage =
  | "prd"
  | "trd"
  | "sysdesign"
  | "design"
  | "task-breakdown"
  | "coding"
  | "qa";

export interface EvidenceRequirement {
  /** Human-readable label surfaced in error messages and the UI. */
  description: string;
  /** Predicate run against each accumulated Evidence record. */
  matcher: (e: Evidence) => boolean;
  /** When true, the requirement may be satisfied by a passing evidence
   *  of any kind in the table — useful for "any of these acceptable
   *  validators is fine" semantics. Default: false (strict match). */
  optional?: boolean;
}

export interface EvidenceStagePolicy {
  stage: EvidenceStage;
  required: EvidenceRequirement[];
}

const byKindAndName = (
  kind: EvidenceKind,
  name: string,
): EvidenceRequirement["matcher"] => {
  return (e) =>
    e.kind === kind &&
    (kind === "validator" ? e.validatorName === name : true) &&
    e.passed === true;
};

const byCommandPrefix = (prefix: string): EvidenceRequirement["matcher"] => {
  return (e) =>
    e.kind === "command" && (e.command?.startsWith(prefix) ?? false) && e.passed === true;
};

export const EVIDENCE_POLICIES: Record<EvidenceStage, EvidenceStagePolicy> = {
  prd: {
    stage: "prd",
    required: [
      {
        description: "PRD spec gate passed (PRD has at least one AC/FR id)",
        matcher: byKindAndName("validator", "prd-spec-gate"),
      },
    ],
  },
  trd: {
    stage: "trd",
    required: [
      {
        description: "TRD rule validator passed (DSL well-formedness)",
        matcher: byKindAndName("validator", "trd-rules-validator"),
      },
      {
        description: "Pipeline DAG validator passed (no cycles / dangling deps)",
        matcher: byKindAndName("validator", "dag-validator"),
      },
    ],
  },
  sysdesign: {
    stage: "sysdesign",
    required: [
      {
        description: "TRD artefact persistence completed (shared-schema + dag written)",
        matcher: byKindAndName("validator", "persist-trd-artifacts"),
      },
    ],
  },
  design: {
    stage: "design",
    required: [
      {
        description: "Design references resolved against generated-code output",
        matcher: byKindAndName("validator", "design-references"),
      },
    ],
  },
  "task-breakdown": {
    stage: "task-breakdown",
    required: [
      {
        description: "Task-coverage gate (task-prd-coverage) passed",
        matcher: byKindAndName("validator", "task-prd-coverage"),
      },
      {
        description: "Phase-requirement gate passed (backend phase present where required)",
        matcher: byKindAndName("validator", "phase-requirement"),
      },
    ],
  },
  coding: {
    stage: "coding",
    required: [
      {
        description: "Runtime smoke gate returned exit code 0",
        matcher: (e) =>
          e.validatorName === "runtime-smoke-gate" &&
          e.passed === true &&
          (e.exitCode === 0 || e.exitCode === undefined),
      },
      {
        description: "TSC diagnostics report contains zero errors",
        matcher: byKindAndName("validator", "tsc-diagnostics-as-tasks"),
      },
      {
        description: "TDD reviewer reports no P0 errors",
        matcher: byKindAndName("validator", "tdd-reviewer"),
      },
    ],
  },
  qa: {
    stage: "qa",
    required: [
      {
        description: "QA coverage gate (qa-ac-coverage) passed",
        matcher: byKindAndName("validator", "qa-ac-coverage"),
      },
      {
        description: "Verifier agent produced a passing verdict",
        matcher: byKindAndName("validator", "verifier-agent"),
      },
    ],
  },
};

/** Re-export used by callers that want the helper without importing the
 *  whole table. */
export { byKindAndName, byCommandPrefix };
