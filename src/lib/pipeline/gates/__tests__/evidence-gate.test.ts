/**
 * Tests for the evidence gate — the "no completion claim without evidence"
 * enforcer.
 */

import { describe, expect, it } from "vitest";
import { runEvidenceGate, makeEvidence } from "../evidence-gate";
import type { Evidence } from "@/lib/requirements/prd-spec-types";

function validator(name: string, passed = true, extra: Partial<Evidence> = {}): Evidence {
  return makeEvidence({
    kind: "validator",
    validatorName: name,
    description: `validator ${name}`,
    passed,
    ...extra,
  });
}

describe("runEvidenceGate — coding stage", () => {
  it("fails when no evidence is supplied", () => {
    const r = runEvidenceGate("coding", []);
    expect(r.passed).toBe(false);
    expect(r.missingRequirements.length).toBeGreaterThan(0);
    expect(r.gateId).toBe("evidence-coding");
  });

  it("fails when only some required validators are present", () => {
    const r = runEvidenceGate("coding", [
      validator("runtime-smoke-gate", true, { exitCode: 0 }),
    ]);
    expect(r.passed).toBe(false);
    expect(r.missingRequirements).toContain(
      "TSC diagnostics report contains zero errors",
    );
    expect(r.missingRequirements).toContain(
      "TDD reviewer reports no P0 errors",
    );
  });

  it("passes when all three coding validators report success", () => {
    const r = runEvidenceGate("coding", [
      validator("runtime-smoke-gate", true, { exitCode: 0 }),
      validator("tsc-diagnostics-as-tasks"),
      validator("tdd-reviewer"),
    ]);
    expect(r.passed).toBe(true);
    expect(r.missingRequirements).toEqual([]);
  });

  it("treats a failing validator as missing (passed=false)", () => {
    const r = runEvidenceGate("coding", [
      validator("runtime-smoke-gate", false, { exitCode: 1 }),
      validator("tsc-diagnostics-as-tasks"),
      validator("tdd-reviewer"),
    ]);
    expect(r.passed).toBe(false);
    expect(r.missingRequirements).toContain(
      "Runtime smoke gate returned exit code 0",
    );
  });

  it("rejects runtime-smoke evidence with non-zero exit code", () => {
    const r = runEvidenceGate("coding", [
      validator("runtime-smoke-gate", true, { exitCode: 1 }),
      validator("tsc-diagnostics-as-tasks"),
      validator("tdd-reviewer"),
    ]);
    expect(r.passed).toBe(false);
    expect(r.missingRequirements).toContain(
      "Runtime smoke gate returned exit code 0",
    );
  });
});

describe("runEvidenceGate — llm-self-check guardrail", () => {
  it("rejects stages whose evidence is only llm-self-check", () => {
    const r = runEvidenceGate("coding", [
      makeEvidence({
        kind: "llm-self-check",
        description: "agent says it's done",
        passed: true,
      }),
    ]);
    expect(r.passed).toBe(false);
    expect(r.warnings.some((w) => w.includes("llm-self-check"))).toBe(true);
  });

  it("accepts llm-self-check alongside a validator (mixed evidence)", () => {
    const r = runEvidenceGate("coding", [
      validator("runtime-smoke-gate", true, { exitCode: 0 }),
      validator("tsc-diagnostics-as-tasks"),
      validator("tdd-reviewer"),
      makeEvidence({
        kind: "llm-self-check",
        description: "agent confidence note",
        passed: true,
      }),
    ]);
    expect(r.passed).toBe(true);
  });
});

describe("runEvidenceGate — other stages", () => {
  it("prd stage passes with prd-spec-gate evidence", () => {
    const r = runEvidenceGate("prd", [validator("prd-spec-gate")]);
    expect(r.passed).toBe(true);
  });

  it("trd stage requires both trd-rules-validator and dag-validator", () => {
    expect(
      runEvidenceGate("trd", [validator("trd-rules-validator")]).passed,
    ).toBe(false);
    expect(
      runEvidenceGate("trd", [
        validator("trd-rules-validator"),
        validator("dag-validator"),
      ]).passed,
    ).toBe(true);
  });

  it("task-breakdown stage requires both task-prd-coverage and phase-requirement", () => {
    expect(
      runEvidenceGate("task-breakdown", [
        validator("task-prd-coverage"),
      ]).passed,
    ).toBe(false);
    expect(
      runEvidenceGate("task-breakdown", [
        validator("task-prd-coverage"),
        validator("phase-requirement"),
      ]).passed,
    ).toBe(true);
  });

  it("qa stage requires both qa-ac-coverage and verifier-agent", () => {
    expect(runEvidenceGate("qa", [validator("qa-ac-coverage")]).passed).toBe(
      false,
    );
    expect(
      runEvidenceGate("qa", [
        validator("qa-ac-coverage"),
        validator("verifier-agent"),
      ]).passed,
    ).toBe(true);
  });
});

describe("makeEvidence", () => {
  it("auto-populates producedAt when omitted", () => {
    const e = makeEvidence({
      kind: "validator",
      description: "test",
      passed: true,
    });
    expect(e.producedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("preserves an explicit producedAt", () => {
    const e = makeEvidence({
      kind: "validator",
      description: "test",
      passed: true,
      producedAt: "2025-01-01T00:00:00.000Z",
    });
    expect(e.producedAt).toBe("2025-01-01T00:00:00.000Z");
  });
});
