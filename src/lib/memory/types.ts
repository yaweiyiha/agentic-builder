/**
 * Core types for the memory system.
 *
 * Two layers:
 *   L1 (system): cross-project regularities, lives at AgenticBuilder/.memory/
 *   L2 (project): per-project facts, lives at <project>/.memory/
 *
 * Both layers share the same MemoryStore interface and MemoryRecord shape.
 */

export type MemoryLayer = "L1" | "L2";

export type MemoryKind =
  // L1
  | "classification"
  | "failure-pattern"
  | "scaffold-fitness"
  | "agent-tuning"
  | "model-routing"
  // L2
  | "project-card"
  | "task-history"
  | "decision"
  | "self-heal-log"
  | "handoff-note"
  | "codebase-map"
  | "model-scorecard"
  | "session-report"
  | "qa-verdict";

export type MemorySource =
  | "cache"
  | "manual"
  | "orchestrator"
  | "self-heal"
  | "distill"
  | "adapter";

export interface MemoryRefs {
  kickoffId?: string;
  taskId?: string;
  parentRecordId?: string;
}

export interface MemoryMetrics {
  hits?: number;
  lastHitAt?: number;
  /** Quality score in [-1, 1]; negative penalizes recall ranking. */
  score?: number;
}

export interface MemoryRecord {
  id: string;
  layer: MemoryLayer;
  kind: MemoryKind;
  title: string;
  /** Either markdown text or JSON.stringify()'d payload, depending on kind. */
  body: string;
  tags: string[];
  source: MemorySource;
  refs: MemoryRefs;
  metrics: MemoryMetrics;
  createdAt: number;
  updatedAt: number;
  schemaVersion: 1;
}

export interface RecallTagFilter {
  all?: string[];
  any?: string[];
  none?: string[];
}

export interface RecallQuery {
  layer?: MemoryLayer | "both";
  kinds?: MemoryKind[];
  tags?: RecallTagFilter;
  text?: string;
  limit?: number;
  minScore?: number;
  kickoffId?: string;
}

export type SaveInput = Omit<
  MemoryRecord,
  "createdAt" | "updatedAt" | "schemaVersion" | "metrics"
> & {
  metrics?: MemoryMetrics;
};

export interface ListOptions {
  layer?: MemoryLayer;
  kind?: MemoryKind;
  limit?: number;
}

export interface MemoryStore {
  save(input: SaveInput): Promise<MemoryRecord>;
  update(
    id: string,
    patch: Partial<Pick<MemoryRecord, "body" | "tags" | "metrics">>,
  ): Promise<MemoryRecord>;
  get(id: string): Promise<MemoryRecord | null>;
  recall(query: RecallQuery): Promise<MemoryRecord[]>;
  delete(id: string): Promise<void>;
  list(opts?: ListOptions): Promise<MemoryRecord[]>;

  bumpHit(id: string): Promise<void>;
  setScore(id: string, score: number): Promise<void>;
}

export class MemorySchemaError extends Error {
  constructor(
    public kind: MemoryKind,
    message: string,
  ) {
    super(`[memory:${kind}] ${message}`);
    this.name = "MemorySchemaError";
  }
}
