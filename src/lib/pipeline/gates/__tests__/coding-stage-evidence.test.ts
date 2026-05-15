/**
 * Tests for collectCodingStageEvidence — reads .ralph/*.json artefacts and
 * produces Evidence records. Missing artefacts must not throw; they are
 * reported as `missingArtefacts` so the evidence-gate can refuse the
 * stage cleanly.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { collectCodingStageEvidence } from "../coding-stage-evidence";
import { runEvidenceGate } from "../evidence-gate";

async function mkTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "coding-evidence-"));
}

async function writeJson(dir: string, rel: string, payload: unknown): Promise<void> {
  const abs = path.join(dir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, JSON.stringify(payload), "utf-8");
}

describe("collectCodingStageEvidence", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkTempDir();
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns empty evidence + lists every validator as missing when no artefacts exist", async () => {
    const r = await collectCodingStageEvidence(dir);
    expect(r.evidence).toEqual([]);
    expect(r.missingArtefacts.sort()).toEqual(
      ["runtime-smoke-gate", "tdd-reviewer", "tsc-diagnostics-as-tasks"].sort(),
    );
  });

  it("collects all three when all artefacts are present and passing", async () => {
    await writeJson(dir, ".ralph/runtime-smoke.json", {
      pass: true,
      bootFailed: false,
      failures: [],
      successes: [{ target: "GET /health", detail: "200" }],
      port: 4000,
      probedEndpoints: [{ method: "GET", endpoint: "/health" }],
    });
    await writeJson(dir, ".ralph/tsc-diagnostics.json", {
      ran: true,
      workspaces: [
        { workspace: "backend", skipped: false, exitCode: 0, diagnosticCount: 0 },
      ],
      tasks: [],
    });
    await writeJson(dir, ".ralph/tdd-review.json", {
      manifestPresent: true,
      totalTests: 5,
      findings: [],
      p0Errors: [],
      summary: "ok",
    });

    const r = await collectCodingStageEvidence(dir);
    expect(r.missingArtefacts).toEqual([]);
    expect(r.evidence).toHaveLength(3);
    expect(r.evidence.every((e) => e.passed)).toBe(true);

    const gate = runEvidenceGate("coding", r.evidence);
    expect(gate.passed).toBe(true);
    expect(gate.missingRequirements).toEqual([]);
  });

  it("returns failing evidence when artefacts contain failures (and evidence-gate refuses the stage)", async () => {
    await writeJson(dir, ".ralph/runtime-smoke.json", {
      pass: false,
      bootFailed: true,
      failures: [
        {
          code: "backend_did_not_start",
          target: "_boot",
          directive: "fix",
          evidence: "EADDRINUSE",
        },
      ],
      successes: [],
      port: 4000,
      probedEndpoints: [],
    });
    await writeJson(dir, ".ralph/tsc-diagnostics.json", {
      ran: true,
      workspaces: [
        { workspace: "backend", skipped: false, exitCode: 1, diagnosticCount: 2 },
      ],
      tasks: [],
    });
    await writeJson(dir, ".ralph/tdd-review.json", {
      manifestPresent: true,
      totalTests: 5,
      findings: [],
      p0Errors: [],
      summary: "ok",
    });

    const r = await collectCodingStageEvidence(dir);
    expect(r.evidence).toHaveLength(3);

    const gate = runEvidenceGate("coding", r.evidence);
    expect(gate.passed).toBe(false);
    expect(gate.missingRequirements).toContain(
      "Runtime smoke gate returned exit code 0",
    );
    expect(gate.missingRequirements).toContain(
      "TSC diagnostics report contains zero errors",
    );
  });

  it("ignores corrupted JSON files without throwing", async () => {
    await fs.mkdir(path.join(dir, ".ralph"), { recursive: true });
    await fs.writeFile(
      path.join(dir, ".ralph/runtime-smoke.json"),
      "{ not json",
      "utf-8",
    );
    await expect(collectCodingStageEvidence(dir)).resolves.toBeDefined();
    const r = await collectCodingStageEvidence(dir);
    expect(r.missingArtefacts).toContain("runtime-smoke-gate");
  });
});
