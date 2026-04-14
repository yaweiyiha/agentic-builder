import type { ProjectTier } from "@/lib/agents/project-classifier";
import type { PipelineStepId } from "./types";

const COST_PER_TOKEN = 0.0000015;

export interface ParallelDocBlueprint {
  id: PipelineStepId;
  label: string;
  estimatedTokens: number;
  estimatedCost: number;
}

export function parallelDocBlueprintsForTier(tier: ProjectTier): ParallelDocBlueprint[] {
  const docs: ParallelDocBlueprint[] = [];

  if (tier === "L") {
    docs.push(
      { id: "trd", label: "TRD", estimatedTokens: 6000, estimatedCost: 6000 * COST_PER_TOKEN },
      {
        id: "sysdesign",
        label: "System Design",
        estimatedTokens: 5000,
        estimatedCost: 5000 * COST_PER_TOKEN,
      },
      {
        id: "implguide",
        label: "Implementation Guide",
        estimatedTokens: 4000,
        estimatedCost: 4000 * COST_PER_TOKEN,
      },
    );
  }

  docs.push({
    id: "design",
    label: "Design Spec",
    estimatedTokens: 3000,
    estimatedCost: 3000 * COST_PER_TOKEN,
  });

  docs.push({
    id: "pencil",
    label: "Pencil Design",
    estimatedTokens: 8000,
    estimatedCost: 8000 * COST_PER_TOKEN,
  });

  if (tier !== "S") {
    docs.push(
      { id: "qa", label: "QA Test Cases", estimatedTokens: 2500, estimatedCost: 2500 * COST_PER_TOKEN },
      { id: "verify", label: "Verification", estimatedTokens: 2000, estimatedCost: 2000 * COST_PER_TOKEN },
    );
  }

  return docs;
}

export function defaultSelectedParallelDocIds(tier: ProjectTier): PipelineStepId[] {
  return parallelDocBlueprintsForTier(tier).map((d) => d.id);
}

export const SKIPPED_LABELS_BY_TIER: Record<ProjectTier, string[]> = {
  S: ["TRD", "System Design", "Implementation Guide", "QA", "Verification"],
  M: ["TRD", "System Design", "Implementation Guide"],
  L: [],
};
