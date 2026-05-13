// ── Generic Snapshot Helpers ─────────────────────────────────────────────────
//
// API endpoint:  PUT/GET  /api/projects/[slug]/project-step-snapshot

import { useStepStore } from "@/store/step-store";
import type { StepSnapshot, SnapshotData } from "./types";
import type { StepId } from "@/_config/pipeline-flow";

// ── Low-level fetch helpers ───────────────────────────────────────────────────

/** GET /api/projects/{slug}/project-step-snapshot?stepId=xxx */
async function fetchSnapshot(
  projectSlug: string,
  stepId: string,
): Promise<Record<string, unknown> | null> {
  const url = `/api/projects/${projectSlug}/project-step-snapshot?stepId=${encodeURIComponent(stepId)}`;
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) return null;
  const data = (await resp.json()) as { snapshot?: Record<string, unknown> | null };
  return data.snapshot ?? null;
}

/** GET /api/projects/{slug}/project-step-snapshot  (no params) — returns all snapshots */
async function fetchAllSnapshots(
  projectSlug: string,
): Promise<Record<string, Record<string, unknown>>> {
  const url = `/api/projects/${projectSlug}/project-step-snapshot`;
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) return {};
  const data = (await resp.json()) as { snapshots?: Record<string, Record<string, unknown>> };
  return data.snapshots ?? {};
}

/** PUT /api/projects/{slug}/project-step-snapshot */
async function putSnapshot(
  projectSlug: string,
  stepId: string,
  snapshot: Record<string, unknown>,
): Promise<void> {
  await fetch(`/api/projects/${projectSlug}/project-step-snapshot`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stepId, snapshot }),
  });
}

// ── Bulk load: fetch ALL step snapshots and restore them into the store ──────
// Call this once on step navigation so every step's data is available.

export async function loadAllStepSnapshots(projectSlug: string): Promise<void> {
  const all = await fetchAllSnapshots(projectSlug);
  const s = useStepStore.getState();
  const merged = { ...s.steps } as Record<string, Record<string, unknown>>;
  for (const [stepId, snap] of Object.entries(all)) {
    if (!snap || (snap.content === undefined && snap.metadata === undefined)) continue;
    // A step has meaningful data if it has content OR non-empty metadata (e.g.
    // design step at style phase stores designStyles in metadata before content).
    const hasMeta = snap.metadata != null && typeof snap.metadata === "object" && Object.keys(snap.metadata as Record<string, unknown>).length > 0;
    const hasContent = (snap.content != null && snap.content !== "") || hasMeta;
    merged[stepId] = {
      ...(merged[stepId] ?? {}),
      ...snap,
      status: hasContent ? (snap.status ?? "pending") : "pending",
      stepId,
      timestamp: new Date().toISOString(),
    };
  }
  useStepStore.setState({ steps: merged as typeof s.steps });
}

// ── Standard per-step snapshot (saves only its own step's data) ──────────────

export function createStepDataSnapshot(stepId: StepId): StepSnapshot<Record<string, unknown>> {
  function serialize(): Record<string, unknown> {
    const s = useStepStore.getState();
    const d = s.steps[stepId];
    return {
      content:   d?.content ?? null,
      metadata:  d?.metadata ?? null,
      status:    d?.status ?? null,
      costUsd:   d?.costUsd ?? null,
      durationMs: d?.durationMs ?? null,
      model:     d?.model ?? null,
      error:     d?.error ?? null,
    } as Record<string, unknown>;
  }

  function deserialize(snapshot: Record<string, unknown>): void {
    if (snapshot.content === undefined && snapshot.metadata === undefined) return;
    const s = useStepStore.getState();
    useStepStore.setState({
      steps: {
        ...s.steps,
        [stepId]: {
          ...((s.steps[stepId] as Record<string, unknown>) ?? {}),
          ...snapshot,
          stepId,
          timestamp: new Date().toISOString(),
        },
      },
    });
  }

  return {
    async load(projectSlug: string): Promise<Record<string, unknown> | null> {
      const raw = await fetchSnapshot(projectSlug, stepId);
      if (!raw) return null;
      deserialize(raw);
      return raw;
    },
    async save(_projectSlug: string, _data: Record<string, unknown>): Promise<void> {
      const data = serialize();
      await putSnapshot(_projectSlug, stepId, data);
    },
    getContextFromPrevious(previousSnapshot: unknown): Record<string, unknown> {
      return (previousSnapshot as Record<string, unknown>) ?? {};
    },
  };
}

// ── Legacy Factory (for custom snapshots like intent) ────────────────────────

export interface SnapshotFactoryOptions<T extends SnapshotData> {
  stepId: StepId;
  serialize: () => T;
  deserialize: (snapshot: T) => void;
  onLoaded?: () => void;
}

export function createStepSnapshot<T extends SnapshotData>(
  opts: SnapshotFactoryOptions<T>,
): StepSnapshot<T> {
  const stepId = opts.stepId;

  return {
    async load(projectSlug: string): Promise<T | null> {
      try {
        const raw = await fetchSnapshot(projectSlug, stepId);
        if (!raw) return null;
        const snapshot = raw as T;
        opts.deserialize(snapshot);
        opts.onLoaded?.();
        return snapshot;
      } catch (err) {
        console.error(`[snapshot] load error (${stepId}):`, err);
        return null;
      }
    },

    async save(projectSlug: string, data: T): Promise<void> {
      try {
        await putSnapshot(projectSlug, stepId, data as Record<string, unknown>);
      } catch (err) {
        console.error(`[snapshot] save error (${stepId}):`, err);
      }
    },

    getContextFromPrevious(previousSnapshot: unknown): Partial<T> {
      return (previousSnapshot as Partial<T>) ?? {};
    },
  };
}
