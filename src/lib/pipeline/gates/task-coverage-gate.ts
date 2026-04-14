import type {
  GateReportBase,
  PrdRequirementIndex,
} from "@/lib/requirements/prd-spec-types";
import type { KickoffWorkItem } from "@/lib/pipeline/types";

/**
 * Checks whether kick-off tasks declare `coversRequirementIds` for PRD AC/FR ids.
 */
export function runTaskCoverageGate(
  prdIndex: PrdRequirementIndex,
  tasks: KickoffWorkItem[],
): GateReportBase {
  const targetIds = [
    ...prdIndex.acceptanceCriteriaIds,
    ...prdIndex.featureIds,
  ];
  if (targetIds.length === 0) {
    return {
      gateId: "task-prd-coverage",
      passed: true,
      warnings: [
        "No PRD AC/FR ids extracted — skipped strict task coverage check.",
      ],
      missingIds: [],
    };
  }

  const covered = new Set<string>();
  for (const t of tasks) {
    const ids = t.coversRequirementIds;
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      if (typeof id === "string") covered.add(id.toUpperCase());
    }
  }

  const missing = targetIds.filter(
    (id) => !covered.has(id.toUpperCase()),
  );

  const warnings: string[] = [];
  if (missing.length > 0) {
    warnings.push(
      `No task lists coversRequirementIds for: ${missing.join(", ")}`,
    );
  }

  return {
    gateId: "task-prd-coverage",
    passed: missing.length === 0,
    warnings,
    missingIds: missing,
  };
}
