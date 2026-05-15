/**
 * Coding-stage evidence collector.
 *
 * The supervisor and worker subgraph persist validator outputs to
 * `<outputDir>/.ralph/{runtime-smoke,tsc-diagnostics,tdd-review}.json` as
 * they run. This helper reads those persisted artefacts and translates
 * them to canonical `Evidence` records the `runEvidenceGate("coding", …)`
 * call can consume — no changes to the supervisor required.
 *
 * Missing files are silently skipped (returns no evidence for that
 * validator). The evidence-gate will then refuse the stage because the
 * required matcher won't find a match — this is the intended behaviour:
 * "no artefact ⇒ no evidence ⇒ stage cannot advance".
 */

import fs from "fs/promises";
import path from "path";
import type { Evidence } from "@/lib/requirements/prd-spec-types";
import {
  evidenceFromRuntimeSmokeGate,
  evidenceFromTscDiagnostics,
  evidenceFromTddReview,
} from "./evidence-adapters";
import type { RuntimeSmokeGateResult } from "@/lib/pipeline/self-heal/runtime-smoke-gate";
import type { TscDiagnosticsResult } from "@/lib/pipeline/self-heal/tsc-diagnostics-as-tasks";
import type { TddReviewResult } from "@/lib/pipeline/tdd-reviewer";

const RUNTIME_SMOKE_RELATIVE = ".ralph/runtime-smoke.json";
const TSC_DIAGNOSTICS_RELATIVE = ".ralph/tsc-diagnostics.json";
const TDD_REVIEW_RELATIVE = ".ralph/tdd-review.json";

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      console.warn(
        `[coding-stage-evidence] failed to read ${filePath}:`,
        err instanceof Error ? err.message : err,
      );
    }
    return null;
  }
}

export interface CollectCodingStageEvidenceResult {
  evidence: Evidence[];
  /** Validator names whose artefact was missing — useful for diagnostics. */
  missingArtefacts: string[];
}

export async function collectCodingStageEvidence(
  outputDir: string,
): Promise<CollectCodingStageEvidenceResult> {
  const evidence: Evidence[] = [];
  const missingArtefacts: string[] = [];

  const smoke = await readJson<RuntimeSmokeGateResult>(
    path.join(outputDir, RUNTIME_SMOKE_RELATIVE),
  );
  if (smoke) {
    evidence.push(evidenceFromRuntimeSmokeGate(smoke));
  } else {
    missingArtefacts.push("runtime-smoke-gate");
  }

  const tsc = await readJson<TscDiagnosticsResult>(
    path.join(outputDir, TSC_DIAGNOSTICS_RELATIVE),
  );
  if (tsc) {
    evidence.push(evidenceFromTscDiagnostics(tsc));
  } else {
    missingArtefacts.push("tsc-diagnostics-as-tasks");
  }

  const tdd = await readJson<TddReviewResult>(
    path.join(outputDir, TDD_REVIEW_RELATIVE),
  );
  if (tdd) {
    evidence.push(evidenceFromTddReview(tdd));
  } else {
    missingArtefacts.push("tdd-reviewer");
  }

  return { evidence, missingArtefacts };
}
