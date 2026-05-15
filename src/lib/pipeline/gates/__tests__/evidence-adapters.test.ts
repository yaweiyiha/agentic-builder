/**
 * Tests for evidence adapters — verify each validator's result type is
 * faithfully translated into Evidence records that runEvidenceGate can
 * match against the policy table.
 */

import { describe, expect, it } from "vitest";
import {
  evidenceFromRuntimeSmokeGate,
  evidenceFromTscDiagnostics,
  evidenceFromTddReview,
  evidenceFromPrdSpecGate,
  evidenceFromGateReport,
  evidenceFromRulesValidation,
  evidenceFromDagValidation,
} from "../evidence-adapters";

describe("evidenceFromRuntimeSmokeGate", () => {
  it("passes when result.pass is true", () => {
    const e = evidenceFromRuntimeSmokeGate({
      pass: true,
      bootFailed: false,
      failures: [],
      successes: [{ target: "GET /health", detail: "200 OK" }],
      port: 4000,
      probedEndpoints: [{ method: "GET", endpoint: "/health" }],
    });
    expect(e.passed).toBe(true);
    expect(e.exitCode).toBe(0);
    expect(e.validatorName).toBe("runtime-smoke-gate");
    expect(e.kind).toBe("validator");
  });

  it("fails when failures exist", () => {
    const e = evidenceFromRuntimeSmokeGate({
      pass: false,
      bootFailed: true,
      failures: [
        {
          code: "backend_did_not_start",
          target: "_boot",
          directive: "fix boot",
          evidence: "EADDRINUSE",
        },
      ],
      successes: [],
      port: 4000,
      probedEndpoints: [],
    });
    expect(e.passed).toBe(false);
    expect(e.exitCode).toBe(1);
    expect(e.details?.bootFailed).toBe(true);
    expect(e.details?.failureCount).toBe(1);
  });
});

describe("evidenceFromTscDiagnostics", () => {
  it("passes when all workspaces have exit 0 and no diagnostics", () => {
    const e = evidenceFromTscDiagnostics({
      ran: true,
      workspaces: [
        { workspace: "backend", skipped: false, exitCode: 0, diagnosticCount: 0 },
        { workspace: "frontend", skipped: false, exitCode: 0, diagnosticCount: 0 },
      ],
      tasks: [],
    });
    expect(e.passed).toBe(true);
    expect(e.details?.totalDiagnostics).toBe(0);
  });

  it("fails when any workspace has non-zero exit code", () => {
    const e = evidenceFromTscDiagnostics({
      ran: true,
      workspaces: [
        { workspace: "backend", skipped: false, exitCode: 1, diagnosticCount: 3 },
        { workspace: "frontend", skipped: false, exitCode: 0, diagnosticCount: 0 },
      ],
      tasks: [],
    });
    expect(e.passed).toBe(false);
    expect(e.details?.totalDiagnostics).toBe(3);
  });

  it("treats skipped workspaces as not blocking", () => {
    const e = evidenceFromTscDiagnostics({
      ran: true,
      workspaces: [
        {
          workspace: "frontend",
          skipped: true,
          skipReason: "no tsconfig",
          exitCode: 0,
          diagnosticCount: 0,
        },
        { workspace: "backend", skipped: false, exitCode: 0, diagnosticCount: 0 },
      ],
      tasks: [],
    });
    expect(e.passed).toBe(true);
  });
});

describe("evidenceFromTddReview", () => {
  it("passes when manifest present and zero P0 errors", () => {
    const e = evidenceFromTddReview({
      manifestPresent: true,
      totalTests: 10,
      findings: [],
      p0Errors: [],
      summary: "ok",
    });
    expect(e.passed).toBe(true);
    expect(e.details?.p0ErrorCount).toBe(0);
  });

  it("fails when manifest missing", () => {
    const e = evidenceFromTddReview({
      manifestPresent: false,
      totalTests: 0,
      findings: [],
      p0Errors: [],
      summary: "no manifest",
    });
    expect(e.passed).toBe(false);
  });

  it("fails when P0 errors present", () => {
    const e = evidenceFromTddReview({
      manifestPresent: true,
      totalTests: 3,
      findings: [
        {
          testId: "t1",
          priority: "P0",
          severity: "error",
          message: "missing assertion",
        },
      ],
      p0Errors: [
        {
          testId: "t1",
          priority: "P0",
          severity: "error",
          message: "missing assertion",
        },
      ],
      summary: "fail",
    });
    expect(e.passed).toBe(false);
    expect(e.details?.p0ErrorCount).toBe(1);
  });
});

describe("evidenceFromPrdSpecGate", () => {
  it("passes when index has AC ids", () => {
    const e = evidenceFromPrdSpecGate({
      passed: true,
      warnings: [],
      index: {
        acceptanceCriteriaIds: ["AC-001", "AC-002"],
        featureIds: [],
        userStoryIds: [],
        componentIds: [],
      },
    });
    expect(e.passed).toBe(true);
    expect(e.validatorName).toBe("prd-spec-gate");
    expect(e.details?.acIdCount).toBe(2);
  });

  it("fails when index is empty", () => {
    const e = evidenceFromPrdSpecGate({
      passed: false,
      warnings: ["no ids"],
      index: {
        acceptanceCriteriaIds: [],
        featureIds: [],
        userStoryIds: [],
        componentIds: [],
      },
    });
    expect(e.passed).toBe(false);
  });
});

describe("evidenceFromRulesValidation", () => {
  it("passes when validation.ok is true", () => {
    const e = evidenceFromRulesValidation({
      ok: true,
      ruleCount: 4,
      ruleTypes: ["piecewise-linear", "decision-table"],
      warnings: [],
    });
    expect(e.passed).toBe(true);
    expect(e.validatorName).toBe("trd-rules-validator");
    expect(e.details?.ruleCount).toBe(4);
  });

  it("fails when warnings are present", () => {
    const e = evidenceFromRulesValidation({
      ok: false,
      ruleCount: 2,
      ruleTypes: ["piecewise-linear"],
      warnings: [{ code: "unknown-rule-type", message: "x" }],
    });
    expect(e.passed).toBe(false);
    expect(e.details?.warningCount).toBe(1);
  });
});

describe("evidenceFromDagValidation", () => {
  it("passes when validation.ok is true", () => {
    const e = evidenceFromDagValidation({
      ok: true,
      pipelineCount: 1,
      nodeCount: 4,
      servicesReferenced: ["DataAdapter", "ScoringEngine"],
      warnings: [],
    });
    expect(e.passed).toBe(true);
    expect(e.validatorName).toBe("dag-validator");
    expect(e.details?.nodeCount).toBe(4);
  });

  it("fails when ok is false", () => {
    const e = evidenceFromDagValidation({
      ok: false,
      pipelineCount: 1,
      nodeCount: 3,
      servicesReferenced: [],
      warnings: [{ code: "cycle-detected", message: "x" }],
    });
    expect(e.passed).toBe(false);
  });
});

describe("evidenceFromGateReport", () => {
  it("uses gateId as validatorName", () => {
    const e = evidenceFromGateReport({
      gateId: "task-prd-coverage",
      passed: true,
      warnings: [],
      missingIds: [],
    });
    expect(e.validatorName).toBe("task-prd-coverage");
    expect(e.passed).toBe(true);
  });

  it("includes a sample of missingIds in details", () => {
    const e = evidenceFromGateReport({
      gateId: "task-prd-coverage",
      passed: false,
      warnings: [],
      missingIds: Array.from({ length: 30 }, (_, i) => `AC-${i}`),
    });
    expect(e.passed).toBe(false);
    const details = e.details as { missingIds: string[] };
    expect(details.missingIds.length).toBe(20);
  });
});
