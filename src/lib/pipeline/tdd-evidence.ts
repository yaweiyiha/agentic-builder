/**
 * TDD evidence reader for generated-code sessions. Keeps test-manifest and
 * RED/GREEN execution evidence parsing out of the large report generator.
 */
import fs from "fs/promises";
import path from "path";

export type TddPriority = "P0" | "P1" | "P2";
export type TddPhase = "red" | "green";
export type TddEvidenceStatus =
  | "expected_fail"
  | "pass"
  | "fail"
  | "infra_fail"
  | "skipped";

export interface TddManifestTest {
  id: string;
  taskId?: string;
  requirementIds?: string[];
  priority?: TddPriority;
  type?:
    | "api-contract"
    | "frontend-service"
    | "route-smoke"
    | "runtime-smoke"
    | "e2e"
    | string;
  file?: string;
  targetFiles?: string[];
  command?: string;
  expectedRed?: string;
  expectedGreen?: string;
}

export interface TddEvidenceEvent {
  testId: string;
  taskId?: string;
  phase: TddPhase;
  command?: string;
  exitCode?: number;
  status: TddEvidenceStatus;
  expectedFailureMatched?: boolean;
  expectedFailureReason?: string;
  failureExcerpt?: string;
  timestamp?: string;
}

export interface TddEvidenceSummary {
  manifestPresent: boolean;
  evidencePresent: boolean;
  manifestPath: string;
  evidencePath: string;
  totalManifestTests: number;
  totalEvidenceEvents: number;
  byPriority: Record<TddPriority, { total: number; greenPassed: number }>;
  redValid: number;
  greenPassed: number;
  greenFailed: number;
  p0BlockingFailures: string[];
  missingRedEvidence: string[];
  missingGreenEvidence: string[];
  reviewPresent: boolean;
  reviewFindingCount: number;
  reviewP0ErrorCount: number;
  p0Details: Array<{
    id: string;
    taskId?: string;
    requirementIds: string[];
    command?: string;
    redStatus?: TddEvidenceStatus;
    greenStatus?: TddEvidenceStatus;
    failureExcerpt?: string;
  }>;
}

const EMPTY_PRIORITY_COUNTS: Record<TddPriority, { total: number; greenPassed: number }> = {
  P0: { total: 0, greenPassed: 0 },
  P1: { total: 0, greenPassed: 0 },
  P2: { total: 0, greenPassed: 0 },
};

function clonePriorityCounts(): Record<TddPriority, { total: number; greenPassed: number }> {
  return {
    P0: { ...EMPTY_PRIORITY_COUNTS.P0 },
    P1: { ...EMPTY_PRIORITY_COUNTS.P1 },
    P2: { ...EMPTY_PRIORITY_COUNTS.P2 },
  };
}

function normalizePriority(value: unknown): TddPriority {
  return value === "P1" || value === "P2" ? value : "P0";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isManifestTest(value: unknown): value is TddManifestTest {
  return isRecord(value) && typeof value.id === "string";
}

function extractManifestTests(parsed: unknown): TddManifestTest[] {
  if (Array.isArray(parsed)) return parsed.filter(isManifestTest);
  if (isRecord(parsed) && Array.isArray(parsed.tests)) {
    return parsed.tests.filter(isManifestTest);
  }
  if (isRecord(parsed) && Array.isArray(parsed.requirements)) {
    const out: TddManifestTest[] = [];
    for (const req of parsed.requirements) {
      if (!isRecord(req) || !Array.isArray(req.tests)) continue;
      for (const test of req.tests) {
        if (isManifestTest(test)) out.push(test);
      }
    }
    return out;
  }
  return [];
}

function isEvidenceEvent(value: unknown): value is TddEvidenceEvent {
  return (
    isRecord(value) &&
    typeof value.testId === "string" &&
    (value.phase === "red" || value.phase === "green") &&
    typeof value.status === "string"
  );
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readJsonlEvidence(filePath: string): Promise<TddEvidenceEvent[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return null;
        }
      })
      .filter(isEvidenceEvent);
  } catch {
    return [];
  }
}

async function readTddReviewSummary(outputDir: string): Promise<{
  present: boolean;
  findingCount: number;
  p0ErrorCount: number;
}> {
  const reviewJson = await readJsonIfPresent(path.join(outputDir, ".ralph", "tdd-review.json"));
  if (!isRecord(reviewJson)) {
    return { present: false, findingCount: 0, p0ErrorCount: 0 };
  }
  const findings = Array.isArray(reviewJson.findings) ? reviewJson.findings : [];
  const p0Errors = Array.isArray(reviewJson.p0Errors) ? reviewJson.p0Errors : [];
  return {
    present: true,
    findingCount: findings.length,
    p0ErrorCount: p0Errors.length,
  };
}

export async function readTddEvidenceSummary(
  outputDir: string,
): Promise<TddEvidenceSummary> {
  const ralphDir = path.join(outputDir, ".ralph");
  const manifestPath = path.join(ralphDir, "test-manifest.json");
  const evidencePath = path.join(ralphDir, "tdd-evidence.jsonl");

  const manifestJson = await readJsonIfPresent(manifestPath);
  const manifestTests = manifestJson ? extractManifestTests(manifestJson) : [];
  const evidenceEvents = await readJsonlEvidence(evidencePath);
  const reviewSummary = await readTddReviewSummary(outputDir);
  const byPriority = clonePriorityCounts();
  const evidenceByTest = new Map<string, TddEvidenceEvent[]>();

  for (const event of evidenceEvents) {
    const list = evidenceByTest.get(event.testId) ?? [];
    list.push(event);
    evidenceByTest.set(event.testId, list);
  }

  let redValid = 0;
  let greenPassed = 0;
  let greenFailed = 0;
  const p0BlockingFailures: string[] = [];
  const missingRedEvidence: string[] = [];
  const missingGreenEvidence: string[] = [];
  const p0Details: TddEvidenceSummary["p0Details"] = [];

  for (const test of manifestTests) {
    const priority = normalizePriority(test.priority);
    byPriority[priority].total += 1;
    const events = evidenceByTest.get(test.id) ?? [];
    const latestRed = [...events].reverse().find((event) => event.phase === "red");
    const latestGreen = [...events].reverse().find((event) => event.phase === "green");
    const hasValidRed = events.some(
      (event) =>
        event.phase === "red" &&
        event.status === "expected_fail" &&
        event.expectedFailureMatched !== false,
    );
    const hasGreenPass = events.some(
      (event) => event.phase === "green" && event.status === "pass",
    );
    const hasGreenFail = events.some(
      (event) =>
        event.phase === "green" &&
        (event.status === "fail" || event.status === "infra_fail"),
    );

    if (hasValidRed) redValid += 1;
    else missingRedEvidence.push(test.id);

    if (hasGreenPass) {
      greenPassed += 1;
      byPriority[priority].greenPassed += 1;
    } else {
      missingGreenEvidence.push(test.id);
    }

    if (hasGreenFail) greenFailed += 1;
    if (priority === "P0" && (!hasValidRed || !hasGreenPass || hasGreenFail)) {
      p0BlockingFailures.push(test.id);
    }
    if (priority === "P0") {
      p0Details.push({
        id: test.id,
        taskId: test.taskId,
        requirementIds: test.requirementIds ?? [],
        command: test.command,
        redStatus: latestRed?.status,
        greenStatus: latestGreen?.status,
        failureExcerpt:
          latestGreen?.failureExcerpt ??
          latestRed?.failureExcerpt ??
          undefined,
      });
    }
  }

  if (manifestTests.length === 0) {
    for (const event of evidenceEvents) {
      if (event.phase === "red" && event.status === "expected_fail") redValid += 1;
      if (event.phase === "green" && event.status === "pass") greenPassed += 1;
      if (
        event.phase === "green" &&
        (event.status === "fail" || event.status === "infra_fail")
      ) {
        greenFailed += 1;
      }
    }
  }

  return {
    manifestPresent: manifestJson !== null,
    evidencePresent: evidenceEvents.length > 0,
    manifestPath,
    evidencePath,
    totalManifestTests: manifestTests.length,
    totalEvidenceEvents: evidenceEvents.length,
    byPriority,
    redValid,
    greenPassed,
    greenFailed,
    p0BlockingFailures,
    missingRedEvidence,
    missingGreenEvidence,
    reviewPresent: reviewSummary.present,
    reviewFindingCount: reviewSummary.findingCount,
    reviewP0ErrorCount: reviewSummary.p0ErrorCount,
    p0Details,
  };
}
