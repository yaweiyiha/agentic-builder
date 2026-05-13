// ── Generic Snapshot Helpers ─────────────────────────────────────────────────
//
// Each step's snapshot.ts delegates to these helpers for DB persistence.
// Snapshot API endpoint:  PUT/GET  /api/projects/[slug]/substage-snapshot

import type { StepSnapshot, SnapshotData } from "./types";
import type { StepId } from "@/_config/pipeline-flow";
import { getNodePath } from "@/_config/pipeline-flow";

// ── Low-level fetch helpers ───────────────────────────────────────────────────

async function fetchSnapshot(
  projectSlug: string,
  stageId: string,
  subStageId: string,
): Promise<Record<string, unknown> | null> {
  const url = `/api/projects/${projectSlug}/substage-snapshot?stage=${encodeURIComponent(stageId)}&subStage=${encodeURIComponent(subStageId)}`;
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) return null;
  const data = (await resp.json()) as { snapshot?: Record<string, unknown> | null };
  return data.snapshot ?? null;
}

async function putSnapshot(
  projectSlug: string,
  stageId: string,
  subStageId: string,
  snapshot: Record<string, unknown>,
): Promise<void> {
  await fetch(`/api/projects/${projectSlug}/substage-snapshot`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stageId, subStageId, snapshot }),
  });
}

// ── Factory: create a snapshot handler for a given step ──────────────────────

export interface SnapshotFactoryOptions<T extends SnapshotData> {
  stepId: StepId;
  /** Serialize store → snapshot payload */
  serialize: () => T;
  /** Deserialize snapshot → store update (return partial to merge) */
  deserialize: (snapshot: T) => void;
  /** Called after load completes */
  onLoaded?: () => void;
}

export function createStepSnapshot<T extends SnapshotData>(
  opts: SnapshotFactoryOptions<T>,
): StepSnapshot<T> {
  const path = getNodePath(opts.stepId);
  const stageId = path?.stage.id ?? "";
  const subStageId = path?.step.id ?? "";

  return {
    async load(projectSlug: string): Promise<T | null> {
      if (!stageId || !subStageId) return null;
      try {
        const raw = await fetchSnapshot(projectSlug, stageId, subStageId);
        if (!raw) return null;
        const snapshot = raw as T;
        opts.deserialize(snapshot);
        opts.onLoaded?.();
        return snapshot;
      } catch (err) {
        console.error(`[snapshot] load error (${opts.stepId}):`, err);
        return null;
      }
    },

    async save(projectSlug: string, data: T): Promise<void> {
      if (!stageId || !subStageId) return;
      try {
        await putSnapshot(projectSlug, stageId, subStageId, data as Record<string, unknown>);
      } catch (err) {
        console.error(`[snapshot] save error (${opts.stepId}):`, err);
      }
    },

    getContextFromPrevious(previousSnapshot: unknown): Partial<T> {
      // Default: the previous snapshot IS the context
      // Steps can override to extract specific fields
      return (previousSnapshot as Partial<T>) ?? {};
    },
  };
}

