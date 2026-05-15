/**
 * Evidence adapters — convert existing validator result types into the
 * canonical `Evidence` record consumed by `runEvidenceGate`. Adapters do
 * NOT re-run anything; callers run the underlying validator themselves
 * (or fetch its persisted output) and then feed the result here.
 *
 * Keeping the conversion logic in one place means a future change to the
 * Evidence shape touches one file, not every call site.
 */

import crypto from "crypto";
import type { Evidence } from "@/lib/requirements/prd-spec-types";
import { makeEvidence } from "./evidence-gate";
import type { RuntimeSmokeGateResult } from "@/lib/pipeline/self-heal/runtime-smoke-gate";
import type { TscDiagnosticsResult } from "@/lib/pipeline/self-heal/tsc-diagnostics-as-tasks";
import type { TddReviewResult } from "@/lib/pipeline/tdd-reviewer";
import type { GateReportBase } from "@/lib/requirements/prd-spec-types";
import type { PrdSpecGateResult } from "./prd-spec-gate";
import type { RulesDslValidation } from "@/lib/agents/architect/trd-rules-validator";
import type { DagValidation } from "@/lib/agents/architect/dag-validator";

function digest(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
}

export function evidenceFromRuntimeSmokeGate(
  result: RuntimeSmokeGateResult,
): Evidence {
  return makeEvidence({
    kind: "validator",
    validatorName: "runtime-smoke-gate",
    description: result.pass
      ? `Runtime smoke gate passed — ${result.successes.length} endpoint(s) probed cleanly on port ${result.port}.`
      : `Runtime smoke gate failed — ${result.failures.length} failure(s)${result.bootFailed ? " (boot failed)" : ""}.`,
    passed: result.pass === true,
    exitCode: result.pass ? 0 : 1,
    outputDigest: digest(JSON.stringify(result)),
    details: {
      port: result.port,
      successCount: result.successes.length,
      failureCount: result.failures.length,
      bootFailed: result.bootFailed,
      probedEndpointCount: result.probedEndpoints.length,
      topFailures: result.failures.slice(0, 3).map((f) => ({
        code: f.code,
        target: f.target,
      })),
    },
  });
}

export function evidenceFromTscDiagnostics(
  result: TscDiagnosticsResult,
): Evidence {
  const totalDiagnostics = result.workspaces.reduce(
    (acc, w) => acc + w.diagnosticCount,
    0,
  );
  const allWorkspacesGreen =
    result.ran && result.workspaces.every((w) => w.skipped || w.exitCode === 0);
  return makeEvidence({
    kind: "validator",
    validatorName: "tsc-diagnostics-as-tasks",
    description: allWorkspacesGreen
      ? `TSC reports zero diagnostics across ${result.workspaces.length} workspace(s).`
      : `TSC reports ${totalDiagnostics} diagnostic(s) across ${result.workspaces.length} workspace(s).`,
    passed: allWorkspacesGreen,
    outputDigest: digest(JSON.stringify(result)),
    details: {
      ran: result.ran,
      totalDiagnostics,
      workspaces: result.workspaces.map((w) => ({
        workspace: w.workspace,
        skipped: w.skipped,
        diagnosticCount: w.diagnosticCount,
        exitCode: w.exitCode,
      })),
    },
  });
}

export function evidenceFromTddReview(result: TddReviewResult): Evidence {
  const passed = result.manifestPresent && result.p0Errors.length === 0;
  return makeEvidence({
    kind: "validator",
    validatorName: "tdd-reviewer",
    description: passed
      ? `TDD reviewer found no P0 errors across ${result.totalTests} test(s).`
      : `TDD reviewer found ${result.p0Errors.length} P0 error(s) (manifestPresent=${result.manifestPresent}).`,
    passed,
    outputDigest: digest(JSON.stringify(result)),
    details: {
      manifestPresent: result.manifestPresent,
      totalTests: result.totalTests,
      p0ErrorCount: result.p0Errors.length,
      findingCount: result.findings.length,
    },
  });
}

export function evidenceFromRulesValidation(
  validation: RulesDslValidation,
): Evidence {
  return makeEvidence({
    kind: "validator",
    validatorName: "trd-rules-validator",
    description: validation.ok
      ? `TRD rules DSL validated (${validation.ruleCount} rule(s) across ${validation.ruleTypes.length} type(s)).`
      : `TRD rules DSL validation found ${validation.warnings.length} warning(s).`,
    passed: validation.ok,
    outputDigest: digest(JSON.stringify(validation)),
    details: {
      ruleCount: validation.ruleCount,
      ruleTypes: validation.ruleTypes,
      warningCount: validation.warnings.length,
    },
  });
}

export function evidenceFromDagValidation(validation: DagValidation): Evidence {
  return makeEvidence({
    kind: "validator",
    validatorName: "dag-validator",
    description: validation.ok
      ? `Pipeline DAG validated (${validation.pipelineCount} pipeline(s), ${validation.nodeCount} node(s)).`
      : `Pipeline DAG validation produced ${validation.warnings.length} warning(s).`,
    passed: validation.ok,
    outputDigest: digest(JSON.stringify(validation)),
    details: {
      pipelineCount: validation.pipelineCount,
      nodeCount: validation.nodeCount,
      servicesReferenced: validation.servicesReferenced,
      warningCount: validation.warnings.length,
    },
  });
}

/**
 * Adapter for the prd-spec gate (returns a result without a gateId field).
 */
export function evidenceFromPrdSpecGate(result: PrdSpecGateResult): Evidence {
  return makeEvidence({
    kind: "validator",
    validatorName: "prd-spec-gate",
    description: result.passed
      ? `PRD spec gate passed (${result.index.acceptanceCriteriaIds.length} AC + ${result.index.featureIds.length} FR ids).`
      : `PRD spec gate weak — PRD has no labelled AC/FR ids.`,
    passed: result.passed,
    outputDigest: digest(JSON.stringify(result)),
    details: {
      acIdCount: result.index.acceptanceCriteriaIds.length,
      featureIdCount: result.index.featureIds.length,
      componentIdCount: result.index.componentIds.length,
      warnings: result.warnings,
    },
  });
}

/**
 * Generic adapter for any GateReportBase-shaped validator (task-coverage-gate,
 * phase-requirement-gate, qa-coverage-gate). The validator's gateId becomes
 * the evidence's validatorName.
 */
export function evidenceFromGateReport(report: GateReportBase): Evidence {
  return makeEvidence({
    kind: "validator",
    validatorName: report.gateId,
    description:
      report.gateId +
      (report.passed
        ? " passed"
        : ` failed (${report.missingIds.length} missing id(s))`),
    passed: report.passed,
    outputDigest: digest(JSON.stringify(report)),
    details: {
      warnings: report.warnings,
      missingIds: report.missingIds.slice(0, 20),
    },
  });
}
