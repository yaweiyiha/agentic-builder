/**
 * AttemptTracker — cross-stage repair attempt counter.
 *
 * Each self-heal entry point (phase-repair, task-coverage-repair,
 * migration-coverage-repair, audit-repair-dispatch, contract-usage-coverage)
 * calls `noteStart` before running and `noteOutcome` after. When the same
 * `(stage, scopeKey)` pair has accumulated `threshold` attempts without a
 * "repaired" outcome, `isCircuitOpen` returns true and callers must skip the
 * repair and escalate (typically to `computeStagnationReplan` or a
 * human-decision gate).
 *
 * Persistence lives at `<outputDir>/.ralph/repair-attempts.json`. The file
 * is a single JSON object keyed by `${stage}:${scopeKey}` because we need
 * read-modify-write semantics (jsonl append wouldn't let us count).
 *
 * File-IO failures are swallowed — telemetry must never break the pipeline.
 */

import fs from "fs/promises";
import path from "path";
import type { RepairStage } from "./events";

export type AttemptOutcome =
  | "in_progress"
  | "repaired"
  | "still_missing"
  | "errored";

export interface AttemptScope {
  stage: RepairStage;
  scopeKey: string;
}

export interface AttemptHistoryEntry {
  at: string;
  outcome: AttemptOutcome;
  repairedIds?: string[];
}

export interface AttemptRecord {
  attempts: number;
  firstAttemptAt: string;
  lastAttemptAt: string;
  lastOutcome: AttemptOutcome;
  history: AttemptHistoryEntry[];
}

export interface AttemptTrackerOptions {
  outputDir: string;
  threshold?: number;
  relativePath?: string;
  /** Cap on per-scope history length to keep the JSON file bounded. */
  historyLimit?: number;
}

const DEFAULT_RELATIVE = ".ralph/repair-attempts.json";
const DEFAULT_THRESHOLD = 3;
const DEFAULT_HISTORY_LIMIT = 20;

function keyOf(scope: AttemptScope): string {
  return `${scope.stage}:${scope.scopeKey}`;
}

function isAttemptOutcome(v: unknown): v is AttemptOutcome {
  return (
    v === "in_progress" ||
    v === "repaired" ||
    v === "still_missing" ||
    v === "errored"
  );
}

function isAttemptRecord(v: unknown): v is AttemptRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.attempts === "number" &&
    typeof r.firstAttemptAt === "string" &&
    typeof r.lastAttemptAt === "string" &&
    isAttemptOutcome(r.lastOutcome) &&
    Array.isArray(r.history)
  );
}

export class AttemptTracker {
  private readonly absolutePath: string;
  private readonly threshold: number;
  private readonly historyLimit: number;
  private state: Map<string, AttemptRecord> = new Map();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: AttemptTrackerOptions) {
    const rel = options.relativePath ?? DEFAULT_RELATIVE;
    this.absolutePath = path.join(options.outputDir, rel);
    this.threshold = options.threshold ?? DEFAULT_THRESHOLD;
    this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.absolutePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (isAttemptRecord(v)) this.state.set(k, v);
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        console.warn(
          `[AttemptTracker] load failed (starting fresh):`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  async noteStart(scope: AttemptScope): Promise<number> {
    await this.load();
    const key = keyOf(scope);
    const now = new Date().toISOString();
    const existing = this.state.get(key);
    const startEntry: AttemptHistoryEntry = { at: now, outcome: "in_progress" };
    const record: AttemptRecord = existing
      ? {
          ...existing,
          attempts: existing.attempts + 1,
          lastAttemptAt: now,
          lastOutcome: "in_progress",
          history: [...existing.history, startEntry].slice(-this.historyLimit),
        }
      : {
          attempts: 1,
          firstAttemptAt: now,
          lastAttemptAt: now,
          lastOutcome: "in_progress",
          history: [startEntry],
        };
    this.state.set(key, record);
    this.persist();
    return record.attempts;
  }

  async noteOutcome(
    scope: AttemptScope,
    outcome: AttemptOutcome,
    repairedIds?: string[],
  ): Promise<void> {
    await this.load();
    const key = keyOf(scope);
    const now = new Date().toISOString();
    const existing = this.state.get(key);

    if (outcome === "repaired" && repairedIds && repairedIds.length > 0) {
      this.state.delete(key);
      this.persist();
      return;
    }

    if (!existing) {
      this.state.set(key, {
        attempts: 0,
        firstAttemptAt: now,
        lastAttemptAt: now,
        lastOutcome: outcome,
        history: [{ at: now, outcome, repairedIds }],
      });
      this.persist();
      return;
    }

    const nextHistory = [
      ...existing.history,
      { at: now, outcome, ...(repairedIds ? { repairedIds } : {}) },
    ].slice(-this.historyLimit);

    this.state.set(key, {
      ...existing,
      lastAttemptAt: now,
      lastOutcome: outcome,
      history: nextHistory,
    });
    this.persist();
  }

  isCircuitOpen(scope: AttemptScope, threshold?: number): boolean {
    const limit = threshold ?? this.threshold;
    const record = this.state.get(keyOf(scope));
    if (!record) return false;
    return record.attempts >= limit;
  }

  getRecord(scope: AttemptScope): AttemptRecord | undefined {
    return this.state.get(keyOf(scope));
  }

  reset(scope: AttemptScope): void {
    this.state.delete(keyOf(scope));
    this.persist();
  }

  snapshot(): Record<string, AttemptRecord> {
    return Object.fromEntries(this.state.entries());
  }

  /** Wait for any pending writes to flush — primarily for tests. */
  async flush(): Promise<void> {
    await this.writeChain;
  }

  private persist(): void {
    const payload = JSON.stringify(this.snapshot(), null, 2);
    this.writeChain = this.writeChain.then(async () => {
      try {
        await fs.mkdir(path.dirname(this.absolutePath), { recursive: true });
        await fs.writeFile(this.absolutePath, payload, "utf-8");
      } catch (err) {
        console.warn(
          `[AttemptTracker] persist failed (ignored):`,
          err instanceof Error ? err.message : err,
        );
      }
    });
  }
}

/**
 * Stable scope key for "missing requirement ids" repair surfaces — used by
 * task-coverage-repair, contract-usage-coverage, etc. Sorting + joining
 * makes the key invariant under ordering changes in the underlying gate
 * output.
 */
export function missingIdsScopeKey(ids: readonly string[]): string {
  return [...ids]
    .map((id) => id.toUpperCase())
    .sort()
    .join(",");
}
