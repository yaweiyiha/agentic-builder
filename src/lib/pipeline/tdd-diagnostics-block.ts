/**
 * Formats TDD artifacts into repair instructions for IntegrationVerifyFix.
 */
import fs from "fs/promises";
import path from "path";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch {
    return null;
  }
}

async function readJsonl(filePath: string): Promise<unknown[]> {
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
      .filter((item): item is unknown => item !== null);
  } catch {
    return [];
  }
}

export async function formatTddRepairBlock(outputDir: string): Promise<string> {
  const ralphDir = path.join(outputDir, ".ralph");
  const manifest = await readJson(path.join(ralphDir, "test-manifest.json"));
  const review = await readJson(path.join(ralphDir, "tdd-review.json"));
  const evidence = await readJsonl(path.join(ralphDir, "tdd-evidence.jsonl"));
  const lines: string[] = [];

  const manifestTests =
    isRecord(manifest) && Array.isArray(manifest.tests) ? manifest.tests : [];
  const reviewP0Errors =
    isRecord(review) && Array.isArray(review.p0Errors) ? review.p0Errors : [];
  const greenFailures = evidence.filter(
    (event) =>
      isRecord(event) &&
      event.phase === "green" &&
      event.status !== "pass" &&
      event.status !== "skipped",
  );

  if (
    manifestTests.length === 0 &&
    reviewP0Errors.length === 0 &&
    greenFailures.length === 0
  ) {
    return "";
  }

  lines.push("## TDD Repair Block");
  lines.push(
    "P0 TDD is a hard gate. Fix production code or test quality until P0 GREEN passes and TDD review has zero P0 errors.",
  );
  lines.push(`- Manifest tests: ${manifestTests.length}`);

  if (reviewP0Errors.length > 0) {
    lines.push("- P0 review errors:");
    for (const finding of reviewP0Errors.slice(0, 10)) {
      if (!isRecord(finding)) continue;
      lines.push(
        `  - ${String(finding.testId ?? "?")}: ${String(finding.message ?? "review error")} (${String(finding.file ?? "unknown file")})`,
      );
    }
  }

  if (greenFailures.length > 0) {
    lines.push("- GREEN failures:");
    for (const event of greenFailures.slice(-10)) {
      if (!isRecord(event)) continue;
      lines.push(
        `  - ${String(event.testId ?? "?")}: status=${String(event.status ?? "?")} exit=${String(event.exitCode ?? "?")}`,
      );
      const excerpt = String(event.failureExcerpt ?? "").trim();
      if (excerpt) lines.push(`    ${excerpt.slice(0, 500).replace(/\n/g, " ")}`);
    }
  }

  return lines.join("\n");
}
