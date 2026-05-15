import fs from "fs/promises";
import path from "path";
import type { KickoffWorkItem } from "@/lib/pipeline/types";
import { extractPrdSpec } from "@/lib/requirements/prd-spec-extractor";
import type { PrdSpec } from "@/lib/requirements/prd-spec-types";
import {
  buildE2eCoverageReport,
  deriveFallbackE2eTasks,
  extractPrdE2eSpec,
  formatE2eCoverageReport,
  formatPrdE2eSpecForContext,
  serializePrdE2eSpec,
  type PrdE2eSpec,
} from "./prd-e2e-spec";

export interface PreparedE2eArtifacts {
  prdSpec: PrdSpec | null;
  e2eSpec: PrdE2eSpec | null;
  e2eContextBlock: string;
  extraTasks: KickoffWorkItem[];
}

async function writeIfContent(
  outputRoot: string,
  relPath: string,
  content: string,
): Promise<void> {
  if (!content.trim()) return;
  const absPath = path.join(outputRoot, relPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content, "utf-8");
}

export async function prepareE2eArtifacts(params: {
  outputRoot: string;
  prdDoc: string;
  tasks: KickoffWorkItem[];
}): Promise<PreparedE2eArtifacts> {
  const { outputRoot, prdDoc, tasks } = params;
  if (!prdDoc.trim()) {
    return {
      prdSpec: null,
      e2eSpec: null,
      e2eContextBlock: "",
      extraTasks: [],
    };
  }

  const prdSpec = await extractPrdSpec(prdDoc);
  const e2eExtraction = await extractPrdE2eSpec(prdDoc, prdSpec);
  const e2eSpec = e2eExtraction.spec;
  if (!e2eSpec) {
    return {
      prdSpec,
      e2eSpec: null,
      e2eContextBlock: "",
      extraTasks: [],
    };
  }

  const extraTasks = deriveFallbackE2eTasks(e2eSpec, tasks);
  const normalizedTasks = [...tasks, ...extraTasks];
  const coverage = buildE2eCoverageReport(e2eSpec, normalizedTasks);
  const e2eSpecMarkdown = formatPrdE2eSpecForContext(e2eSpec);
  const coverageMarkdown = formatE2eCoverageReport(coverage);

  await writeIfContent(outputRoot, "PRD_E2E_SPEC.json", serializePrdE2eSpec(e2eSpec));
  await writeIfContent(outputRoot, "PRD_E2E_SPEC.md", `${e2eSpecMarkdown}\n`);
  await writeIfContent(outputRoot, "E2E_COVERAGE.md", `${coverageMarkdown}\n`);

  const e2eContextBlock = [
    e2eSpecMarkdown,
    "",
    coverageMarkdown,
    "",
    e2eExtraction.parseFailed
      ? "Warning: PRD E2E spec required fallback handling."
      : `E2E spec model: ${e2eExtraction.model}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    prdSpec,
    e2eSpec,
    e2eContextBlock,
    extraTasks,
  };
}
