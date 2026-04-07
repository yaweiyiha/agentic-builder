import type {
  GateReportBase,
  PrdRequirementIndex,
} from "@/lib/requirements/prd-spec-types";

/**
 * Best-effort: see which PRD AC ids are not mentioned in the QA audit markdown.
 */
export function runQaCoverageGate(
  prdIndex: PrdRequirementIndex,
  qaMarkdown: string,
): GateReportBase {
  const text = (qaMarkdown ?? "").toUpperCase();
  const missing = prdIndex.acceptanceCriteriaIds.filter(
    (id) => !text.includes(id.toUpperCase()),
  );

  const warnings: string[] = [];
  if (missing.length > 0) {
    warnings.push(
      `QA output may not reference these acceptance criteria: ${missing.join(", ")}`,
    );
  }

  return {
    gateId: "qa-ac-coverage",
    passed: missing.length === 0,
    warnings,
    missingIds: missing,
  };
}
