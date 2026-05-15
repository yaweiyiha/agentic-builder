/**
 * Runtime RED/GREEN executor for task-level TDD manifests.
 */
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { readTddManifest } from "@/lib/pipeline/tdd-manifest";
import type {
  TddEvidenceEvent,
  TddEvidenceStatus,
  TddManifestTest,
  TddPhase,
  TddPriority,
} from "@/lib/pipeline/tdd-evidence";
import type { RepairEmitter } from "@/lib/pipeline/self-heal";

const execFileAsync = promisify(execFile);
const TDD_COMMAND_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 2000;

export interface TddRuntimeExecutorResult {
  phase: TddPhase;
  manifestPresent: boolean;
  total: number;
  passed: number;
  expectedFailed: number;
  failed: number;
  skipped: number;
  p0Failures: string[];
  summary: string;
}

function normalizePriority(value: unknown): TddPriority {
  return value === "P1" || value === "P2" ? value : "P0";
}

function isUnsafeCommand(command: string): boolean {
  return /\brm\s+-rf\b|\bsudo\b|\bgit\s+push\b|>\s*\/dev\/|\/\s*$/i.test(command);
}

function classifyFailure(output: string): TddEvidenceStatus {
  if (/missing script|command not found|Cannot find module ['"]?(vitest|jest|playwright)|ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL/i.test(output)) {
    return "infra_fail";
  }
  return "fail";
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`"'()[\]{}:;,.!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractExpectedRedTerms(expectedRed: string | undefined): string[] {
  if (!expectedRed?.trim()) return [];
  const raw = expectedRed.match(/[A-Za-z0-9_./:-]+/g) ?? [];
  const stop = new Set([
    "the",
    "and",
    "or",
    "before",
    "after",
    "returns",
    "return",
    "fails",
    "fail",
    "should",
    "test",
    "route",
    "exists",
  ]);
  return [
    ...new Set(
      raw
        .map((term) => term.toLowerCase())
        .filter((term) => term.length >= 3 && !stop.has(term)),
    ),
  ].slice(0, 12);
}

function matchExpectedRed(output: string, expectedRed: string | undefined): {
  matched: boolean;
  reason: string;
} {
  const terms = extractExpectedRedTerms(expectedRed);
  if (terms.length === 0) {
    return {
      matched: true,
      reason: "No expectedRed terms declared; accepted non-infra failure.",
    };
  }
  const normalizedOutput = normalizeText(output);
  const matchedTerms = terms.filter((term) =>
    normalizedOutput.includes(normalizeText(term)),
  );
  const requiredMatches = Math.max(1, Math.ceil(Math.min(terms.length, 6) / 2));
  return {
    matched: matchedTerms.length >= requiredMatches,
    reason:
      matchedTerms.length >= requiredMatches
        ? `Matched expectedRed terms: ${matchedTerms.join(", ")}.`
        : `Expected RED mismatch: matched ${matchedTerms.length}/${requiredMatches} required terms from "${expectedRed}".`,
  };
}

async function appendEvidence(
  outputDir: string,
  event: TddEvidenceEvent,
): Promise<void> {
  const ralphDir = path.join(outputDir, ".ralph");
  await fs.mkdir(ralphDir, { recursive: true });
  await fs.appendFile(
    path.join(ralphDir, "tdd-evidence.jsonl"),
    `${JSON.stringify(event)}\n`,
    "utf-8",
  );
}

async function runOneTest(
  outputDir: string,
  phase: TddPhase,
  test: TddManifestTest,
): Promise<TddEvidenceEvent> {
  const command = test.command?.trim();
  if (!command) {
    return {
      testId: test.id,
      taskId: test.taskId,
      phase,
      status: "skipped",
      failureExcerpt: "No command declared in TDD manifest.",
      timestamp: new Date().toISOString(),
    };
  }
  if (isUnsafeCommand(command)) {
    return {
      testId: test.id,
      taskId: test.taskId,
      phase,
      command,
      status: "skipped",
      failureExcerpt: "TDD command rejected as unsafe.",
      timestamp: new Date().toISOString(),
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-c", command], {
      cwd: outputDir,
      timeout: TDD_COMMAND_TIMEOUT_MS,
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    const output = `${stdout ?? ""}${stderr ?? ""}`.trim();
    const greenPass = phase === "green";
    return {
      testId: test.id,
      taskId: test.taskId,
      phase,
      command,
      exitCode: 0,
      status: greenPass ? "pass" : "fail",
      expectedFailureMatched: phase === "red" ? false : undefined,
      failureExcerpt: greenPass
        ? output.slice(-MAX_OUTPUT_CHARS)
        : "RED test passed before implementation, so it is not a valid failing test.",
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    const e = err as {
      code?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const output = `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`.trim();
    const failureKind = classifyFailure(output);
    const expectedRedMatch =
      phase === "red" && failureKind !== "infra_fail"
        ? matchExpectedRed(output, test.expectedRed)
        : { matched: false, reason: "" };
    const status =
      phase === "red" && failureKind !== "infra_fail" && expectedRedMatch.matched
        ? "expected_fail"
        : failureKind;
    return {
      testId: test.id,
      taskId: test.taskId,
      phase,
      command,
      exitCode: typeof e.code === "number" ? e.code : 1,
      status,
      expectedFailureMatched: phase === "red" ? status === "expected_fail" : undefined,
      expectedFailureReason: phase === "red" ? expectedRedMatch.reason : undefined,
      failureExcerpt: output.slice(-MAX_OUTPUT_CHARS),
      timestamp: new Date().toISOString(),
    };
  }
}

export async function runTddRuntimePhase(input: {
  outputDir: string;
  phase: TddPhase;
  emitter?: RepairEmitter;
}): Promise<TddRuntimeExecutorResult> {
  const manifest = await readTddManifest(input.outputDir);
  if (!manifest || manifest.tests.length === 0) {
    const summary = "TDD runtime skipped: no tests in manifest.";
    input.emitter?.({
      stage: "tdd-runtime",
      event: "tdd_runtime_skipped",
      details: { phase: input.phase, reason: "no-manifest-tests" },
    });
    return {
      phase: input.phase,
      manifestPresent: !!manifest,
      total: 0,
      passed: 0,
      expectedFailed: 0,
      failed: 0,
      skipped: 0,
      p0Failures: [],
      summary,
    };
  }

  let passed = 0;
  let expectedFailed = 0;
  let failed = 0;
  let skipped = 0;
  const p0Failures: string[] = [];

  for (const test of manifest.tests) {
    const event = await runOneTest(input.outputDir, input.phase, test);
    await appendEvidence(input.outputDir, event);

    if (event.status === "pass") passed += 1;
    else if (event.status === "expected_fail") expectedFailed += 1;
    else if (event.status === "skipped") skipped += 1;
    else failed += 1;

    const priority = normalizePriority(test.priority);
    const isBlocking =
      priority === "P0" &&
      ((input.phase === "red" && event.status !== "expected_fail") ||
        (input.phase === "green" && event.status !== "pass"));
    if (isBlocking) p0Failures.push(test.id);
  }

  const summary =
    input.phase === "red"
      ? `TDD RED: ${expectedFailed}/${manifest.tests.length} expected failures, ${failed} failed unexpectedly, ${passed} passed too early, ${skipped} skipped.`
      : `TDD GREEN: ${passed}/${manifest.tests.length} passed, ${failed} failed, ${skipped} skipped.`;

  input.emitter?.({
    stage: "tdd-runtime",
    event: input.phase === "red" ? "tdd_red_executed" : "tdd_green_executed",
    details: {
      total: manifest.tests.length,
      passed,
      expectedFailed,
      failed,
      skipped,
      p0Failures,
    },
  });

  return {
    phase: input.phase,
    manifestPresent: true,
    total: manifest.tests.length,
    passed,
    expectedFailed,
    failed,
    skipped,
    p0Failures,
    summary,
  };
}
