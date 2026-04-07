import type { PrdRequirementIndex } from "@/lib/requirements/prd-spec-types";
import { extractPrdRequirementIndex } from "@/lib/requirements/extract-prd-spec";

export interface PrdSpecGateResult {
  index: PrdRequirementIndex;
  passed: boolean;
  warnings: string[];
}

/**
 * Runs after PRD text is finalized. Non-blocking: always returns an index;
 * `passed` is false if the PRD looks too thin for downstream coverage checks.
 */
export function runPrdSpecGate(prdMarkdown: string): PrdSpecGateResult {
  const index = extractPrdRequirementIndex(prdMarkdown);
  const warnings: string[] = [];

  if (
    index.acceptanceCriteriaIds.length === 0 &&
    index.featureIds.length === 0
  ) {
    warnings.push(
      "No AC-* or FR-* IDs detected in PRD text — task/test coverage gates will be weak. Ensure the PRD uses labeled acceptance criteria and features.",
    );
  }

  if (index.componentIds.length === 0) {
    warnings.push(
      "No IC-* interactive component IDs detected — kick-off task coverage vs components may be incomplete.",
    );
  }

  const passed =
    index.acceptanceCriteriaIds.length > 0 || index.featureIds.length > 0;

  return { index, passed, warnings };
}
