/**
 * Persists task-level TDD seed plans into a session manifest consumed by
 * Test Writer / Runtime Executor and surfaced in coding-session reports.
 */
import fs from "fs/promises";
import path from "path";
import type { CodingTask, TaskFilePlan } from "@/lib/pipeline/types";
import type { TddManifestTest } from "@/lib/pipeline/tdd-evidence";

export interface TddManifestPayload {
  generatedAt: string;
  source: "task-breakdown";
  tests: TddManifestTest[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTddManifestTest(value: unknown): value is TddManifestTest {
  return isRecord(value) && typeof value.id === "string";
}

function collectTaskFiles(task: CodingTask): string[] {
  if (Array.isArray(task.files)) return task.files;
  const files = task.files as TaskFilePlan | undefined;
  if (!files) return [];
  return [...files.creates, ...files.modifies, ...files.reads];
}

export async function writeTddManifestFromTasks(
  outputDir: string,
  tasks: CodingTask[],
): Promise<{ path: string; testCount: number }> {
  const ralphDir = path.join(outputDir, ".ralph");
  const manifestPath = path.join(ralphDir, "test-manifest.json");
  const tests: TddManifestTest[] = [];

  for (const task of tasks) {
    for (const test of task.tddPlan?.tests ?? []) {
      tests.push({
        id: test.id,
        taskId: task.id,
        requirementIds: task.coversRequirementIds ?? [],
        priority: test.priority,
        type: test.type,
        file: test.file,
        targetFiles: collectTaskFiles(task).filter((file) => file !== test.file),
        command: test.command,
        expectedRed: test.expectedRed,
        expectedGreen: test.expectedGreen,
      });
    }
  }

  const payload: TddManifestPayload = {
    generatedAt: new Date().toISOString(),
    source: "task-breakdown",
    tests,
  };

  await fs.mkdir(ralphDir, { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(payload, null, 2), "utf-8");
  return { path: manifestPath, testCount: tests.length };
}

export async function readTddManifest(
  outputDir: string,
): Promise<TddManifestPayload | null> {
  const manifestPath = path.join(outputDir, ".ralph", "test-manifest.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.tests)) return null;
    return {
      generatedAt:
        typeof parsed.generatedAt === "string"
          ? parsed.generatedAt
          : new Date(0).toISOString(),
      source: "task-breakdown",
      tests: parsed.tests.filter(isTddManifestTest),
    };
  } catch {
    return null;
  }
}
