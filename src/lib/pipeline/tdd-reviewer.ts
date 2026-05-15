/**
 * Static TDD reviewer. Validates that generated tests are real artifacts, not
 * skipped or assertion-free placeholders.
 */
import fs from "fs/promises";
import path from "path";
import { readTddManifest } from "@/lib/pipeline/tdd-manifest";
import type { TddManifestTest, TddPriority } from "@/lib/pipeline/tdd-evidence";
import type { RepairEmitter } from "@/lib/pipeline/self-heal";

export interface TddReviewFinding {
  testId: string;
  taskId?: string;
  priority: TddPriority;
  severity: "error" | "warn";
  message: string;
  file?: string;
}

export interface TddReviewResult {
  manifestPresent: boolean;
  totalTests: number;
  findings: TddReviewFinding[];
  p0Errors: TddReviewFinding[];
  summary: string;
}

function normalizePriority(value: unknown): TddPriority {
  return value === "P1" || value === "P2" ? value : "P0";
}

function normalizeRelPath(file: string): string {
  return path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, "");
}

function hasAssertion(content: string): boolean {
  return /\bexpect\s*\(|\bassert\.|\bshould\b|\btoEqual\b|\btoBe\b/.test(content);
}

function hasSkippedTest(content: string): boolean {
  return /\b(?:it|test|describe)\.skip\s*\(|\b(?:it|test)\.todo\s*\(/.test(content);
}

function looksMockOnly(content: string): boolean {
  const lowered = content.toLowerCase();
  return (
    lowered.includes("mock data") ||
    lowered.includes("placeholder") ||
    lowered.includes("todo replace") ||
    /expect\s*\(\s*true\s*\)\.toBe\s*\(\s*true\s*\)/.test(content)
  );
}

function stripExtension(file: string): string {
  return file.replace(/\.[cm]?[jt]sx?$/, "");
}

function routeTerms(test: TddManifestTest): string[] {
  const text = `${test.expectedRed ?? ""} ${test.expectedGreen ?? ""} ${test.command ?? ""}`;
  return [...new Set(text.match(/\/api\/[A-Za-z0-9_/:.-]+|[A-Z]+ \/[A-Za-z0-9_/:.-]+/g) ?? [])];
}

function referencesTarget(content: string, test: TddManifestTest): boolean {
  const targetFiles = test.targetFiles ?? [];
  if (targetFiles.length === 0 && routeTerms(test).length === 0) return true;
  const normalized = content.replace(/\\/g, "/");
  for (const file of targetFiles) {
    const normalizedFile = file.replace(/\\/g, "/");
    const withoutExt = stripExtension(normalizedFile);
    const base = path.basename(withoutExt);
    if (
      normalized.includes(normalizedFile) ||
      normalized.includes(withoutExt) ||
      (base.length >= 3 && normalized.includes(base))
    ) {
      return true;
    }
  }
  for (const route of routeTerms(test)) {
    if (normalized.includes(route)) return true;
    const endpoint = route.replace(/^[A-Z]+\s+/, "");
    if (endpoint !== route && normalized.includes(endpoint)) return true;
  }
  return false;
}

function coversRequirementIds(content: string, requirementIds: string[] | undefined): boolean {
  const ids = requirementIds ?? [];
  if (ids.length === 0) return true;
  return ids.some((id) => content.includes(id));
}

async function reviewOne(
  outputDir: string,
  test: TddManifestTest,
): Promise<TddReviewFinding[]> {
  const priority = normalizePriority(test.priority);
  const findings: TddReviewFinding[] = [];
  if (!test.file?.trim()) {
    return [
      {
        testId: test.id,
        taskId: test.taskId,
        priority,
        severity: "error",
        message: "TDD manifest test has no file path.",
      },
    ];
  }

  const relPath = normalizeRelPath(test.file);
  const abs = path.join(outputDir, relPath);
  let content = "";
  try {
    content = await fs.readFile(abs, "utf-8");
  } catch {
    return [
      {
        testId: test.id,
        taskId: test.taskId,
        priority,
        severity: "error",
        file: relPath,
        message: "TDD test file is missing.",
      },
    ];
  }

  if (content.trim().length < 120) {
    findings.push({
      testId: test.id,
      taskId: test.taskId,
      priority,
      severity: "error",
      file: relPath,
      message: "TDD test file is too small to be meaningful.",
    });
  }
  if (!hasAssertion(content)) {
    findings.push({
      testId: test.id,
      taskId: test.taskId,
      priority,
      severity: "error",
      file: relPath,
      message: "TDD test has no assertion.",
    });
  }
  if (hasSkippedTest(content)) {
    findings.push({
      testId: test.id,
      taskId: test.taskId,
      priority,
      severity: "error",
      file: relPath,
      message: "TDD test is skipped or marked todo.",
    });
  }
  if (looksMockOnly(content)) {
    findings.push({
      testId: test.id,
      taskId: test.taskId,
      priority,
      severity: "warn",
      file: relPath,
      message: "TDD test appears to be mock-only or placeholder-like.",
    });
  }
  if (!referencesTarget(content, test)) {
    findings.push({
      testId: test.id,
      taskId: test.taskId,
      priority,
      severity: "error",
      file: relPath,
      message:
        "TDD test does not reference a target route, service, API client, or task-owned file.",
    });
  }
  if (!coversRequirementIds(content, test.requirementIds)) {
    findings.push({
      testId: test.id,
      taskId: test.taskId,
      priority,
      severity: "error",
      file: relPath,
      message:
        "TDD test does not cite any covered requirement id from coversRequirementIds.",
    });
  }

  return findings;
}

export async function reviewTddTests(input: {
  outputDir: string;
  emitter?: RepairEmitter;
}): Promise<TddReviewResult> {
  const manifest = await readTddManifest(input.outputDir);
  if (!manifest || manifest.tests.length === 0) {
    const result: TddReviewResult = {
      manifestPresent: !!manifest,
      totalTests: 0,
      findings: [],
      p0Errors: [],
      summary: "TDD review skipped: no tests in manifest.",
    };
    await writeReview(input.outputDir, result);
    return result;
  }

  const findings: TddReviewFinding[] = [];
  for (const test of manifest.tests) {
    findings.push(...(await reviewOne(input.outputDir, test)));
  }
  const p0Errors = findings.filter(
    (finding) => finding.priority === "P0" && finding.severity === "error",
  );
  const result: TddReviewResult = {
    manifestPresent: true,
    totalTests: manifest.tests.length,
    findings,
    p0Errors,
    summary:
      findings.length === 0
        ? `TDD review clean: ${manifest.tests.length} test(s).`
        : `TDD review found ${findings.length} finding(s), including ${p0Errors.length} P0 error(s).`,
  };
  await writeReview(input.outputDir, result);
  input.emitter?.({
    stage: "tdd-review",
    event: p0Errors.length > 0 ? "tdd_review_failed" : "tdd_review_passed",
    details: {
      totalTests: result.totalTests,
      findingCount: findings.length,
      p0ErrorCount: p0Errors.length,
      topFindings: findings.slice(0, 10),
    },
  });
  return result;
}

async function writeReview(outputDir: string, result: TddReviewResult): Promise<void> {
  const ralphDir = path.join(outputDir, ".ralph");
  await fs.mkdir(ralphDir, { recursive: true });
  await fs.writeFile(
    path.join(ralphDir, "tdd-review.json"),
    JSON.stringify(result, null, 2),
    "utf-8",
  );
}
