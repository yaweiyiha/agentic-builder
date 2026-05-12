// Step: Design — DB Snapshot
// Persists core step state plus the design cache (styles, selected style, source mode,
// stitch result) so users can revisit the design step later.
import { createStepSnapshot } from "../../../_shared/snapshot-context";
import type { StepSnapshot } from "../../../_shared/types";
import { useStepStore } from "@/store/step-store";
import { getNodePath } from "@/_config/pipeline-flow";
import type { DesignStyle, StitchGenerateResult } from "./agent";

// ── Module-level design cache ─────────────────────────────────────────────────

export interface DesignCache {
  /** PRD fingerprint used when cache was written — invalidated on PRD change. */
  prdHash: string | null;
  /** AI-generated design styles. */
  designStyles: DesignStyle[] | null;
  /** The user-chosen style ID. */
  selectedDesignStyleId: string | null;
  /** Which source mode the user picked ("ai" | "custom"). */
  designSourceMode: "ai" | "custom";
  /** Custom-uploaded file names (display-only). */
  customFileNames: string[];
  /** Latest stitch generation result. */
  stitchResult: StitchGenerateResult | null;
}

let _designCache: DesignCache | null = null;

export function getDesignCache(): DesignCache | null {
  return _designCache;
}

export function setDesignCache(cache: DesignCache | null) {
  _designCache = cache;
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

const path = getNodePath("design");
const stageId = path?.stage.id ?? "";
const subStageId = path?.step.id ?? "";

const base = createStepSnapshot<Record<string, unknown>>({
  stepId: "design",
  serialize: () => {
    const s = useStepStore.getState();
    return {
      featureBrief: s.featureBrief,
      steps: s.steps as Record<string, unknown>,
      totalCostUsd: s.totalCostUsd,
      codeOutputDir: s.codeOutputDir,
      designCache: _designCache as unknown as Record<string, unknown> | undefined,
    };
  },
  deserialize: (snapshot) => {
    const s = useStepStore.getState();
    if (snapshot.steps) {
      useStepStore.setState({
        steps: { ...s.steps, ...(snapshot.steps as typeof s.steps) },
        featureBrief: (snapshot.featureBrief as string) ?? s.featureBrief,
        totalCostUsd: (snapshot.totalCostUsd as number) ?? s.totalCostUsd,
        codeOutputDir: (snapshot.codeOutputDir as string) ?? s.codeOutputDir,
      });
    }
    // Restore design cache
    const cacheRaw = snapshot.designCache as Record<string, unknown> | undefined;
    if (cacheRaw) {
      _designCache = {
        prdHash: (cacheRaw.prdHash as string) ?? null,
        designStyles: (cacheRaw.designStyles as DesignStyle[]) ?? null,
        selectedDesignStyleId:
          (cacheRaw.selectedDesignStyleId as string) ?? null,
        designSourceMode:
          (cacheRaw.designSourceMode as "ai" | "custom") ?? "ai",
        customFileNames: (cacheRaw.customFileNames as string[]) ?? [],
        stitchResult: (cacheRaw.stitchResult as StitchGenerateResult) ?? null,
      };
    } else {
      _designCache = null;
    }
  },
});

export const designSnapshot: StepSnapshot = {
  load: base.load,
  getContextFromPrevious: base.getContextFromPrevious,
  // Override save to always merge in the live design cache — page.tsx builds a
  // generic snapshot payload that doesn't know about step-specific extras.
  async save(projectSlug: string, data: unknown) {
    if (!stageId || !subStageId) return;
    const merged = {
      ...(data as Record<string, unknown>),
      designCache: _designCache as unknown as Record<string, unknown> | undefined,
    };
    try {
      await fetch(`/api/projects/${projectSlug}/substage-snapshot`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId, subStageId, snapshot: merged }),
      });
    } catch (err) {
      console.error(`[design-snapshot] save error:`, err);
    }
  },
};
