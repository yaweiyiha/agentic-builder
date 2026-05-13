/**
 * FileStore — v2 per-record self-contained file backend.
 *
 * Layout under `<root>/.memory/`:
 *   records/<kind>/<id>.{md,json}   one file per record (committable)
 *   metrics.json                     per-developer hits/score (gitignored)
 *   trace.jsonl                      per-developer trace log (gitignored)
 *   .lock-target                     proper-lockfile sentinel (gitignored)
 *
 * Per-record file format:
 *   - kind format "markdown" → JSON-in-frontmatter + body
 *
 *       ---
 *       {"id":"FP-xyz","layer":"L1","kind":"failure-pattern",...}
 *       ---
 *
 *       Body markdown content here
 *
 *   - kind format "json" → single JSON envelope `{...meta, body: <object>}`
 *
 * Why this design:
 *   1. Each record's file is self-contained → committable in git → "memory
 *      survives a fresh clone" works without an explicit central index.
 *   2. Per-record files mean per-record git diffs → no merge conflicts on
 *      unrelated records.
 *   3. Metrics (hits / lastHitAt / score) live in a separate file that is
 *      gitignored → per-developer counters never conflict across machines.
 *   4. Markdown bodies stay clean below the frontmatter fence → readable in
 *      Obsidian, GitHub, IDE markdown previews.
 *
 * Concurrency:
 *   In-process Promise chain serializes writes; proper-lockfile sits over a
 *   sentinel file for cross-process safety.
 *
 * Failure mode:
 *   FileStore methods throw on programmer errors (bad input, schema
 *   violations). Callers in production code paths MUST wrap save/update in
 *   try/catch and swallow — memory writes are non-critical (design doc
 *   §12.5.1 写入纪律).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import lockfile from "proper-lockfile";

import {
  DEFAULT_RECALL_LIMIT,
  DEFAULT_RECALL_WEIGHTS,
  RECENCY_HALF_LIFE_MS,
  type RecallWeights,
} from "./recall-config";
import { getKindSpec, validateBody } from "./schemas";
import type {
  ListOptions,
  MemoryKind,
  MemoryLayer,
  MemoryMetrics,
  MemoryRecord,
  MemoryStore,
  RecallQuery,
  SaveInput,
} from "./types";

const RECORDS_DIRNAME = "records";
const METRICS_FILENAME = "metrics.json";
const LOCK_SENTINEL = ".lock-target";
const SCHEMA_VERSION = 1 as const;
const FRONTMATTER_FENCE = "---";

export interface FileStoreOptions {
  layer: MemoryLayer;
  root: string;
  weights?: RecallWeights;
}

export class FileStore implements MemoryStore {
  private readonly memoryDir: string;
  private readonly recordsDir: string;
  private readonly metricsPath: string;
  private readonly lockPath: string;
  private readonly weights: RecallWeights;
  private readonly layer: MemoryLayer;
  private writeQueue: Promise<unknown> = Promise.resolve();
  private cache: Map<string, MemoryRecord> | null = null;

  constructor(opts: FileStoreOptions) {
    this.layer = opts.layer;
    this.memoryDir = path.join(opts.root, ".memory");
    this.recordsDir = path.join(this.memoryDir, RECORDS_DIRNAME);
    this.metricsPath = path.join(this.memoryDir, METRICS_FILENAME);
    this.lockPath = path.join(this.memoryDir, LOCK_SENTINEL);
    this.weights = opts.weights ?? DEFAULT_RECALL_WEIGHTS;
  }

  async save(input: SaveInput): Promise<MemoryRecord> {
    if (input.layer !== this.layer) {
      throw new Error(
        `FileStore(layer=${this.layer}) refused record with layer=${input.layer}`,
      );
    }
    validateBody(input.kind, input.body);

    const now = Date.now();
    const id = input.id || makeId(input.kind);

    return await this.withWriteLock(async () => {
      const cache = await this.ensureCache();
      const existing = cache.get(id);

      const record: MemoryRecord = {
        id,
        layer: input.layer,
        kind: input.kind,
        title: input.title,
        body: input.body,
        tags: dedupe(input.tags ?? []),
        source: input.source,
        refs: input.refs ?? {},
        metrics: existing?.metrics ?? input.metrics ?? { hits: 0 },
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        schemaVersion: SCHEMA_VERSION,
      };

      // If a previous record had a different kind, remove the old file —
      // path depends on kind.
      if (existing && existing.kind !== record.kind) {
        await this.removeRecordFile(existing).catch(() => {});
      }

      await this.writeRecordFile(record);
      cache.set(id, record);
      // metrics may have been merged from existing; persist if changed.
      if (input.metrics) {
        await this.writeMetricsFor(id, record.metrics);
      }
      return record;
    });
  }

  async update(
    id: string,
    patch: Partial<Pick<MemoryRecord, "body" | "tags" | "metrics">>,
  ): Promise<MemoryRecord> {
    return await this.withWriteLock(async () => {
      const cache = await this.ensureCache();
      const prev = cache.get(id);
      if (!prev) throw new Error(`memory record not found: ${id}`);

      const next: MemoryRecord = {
        ...prev,
        body: patch.body ?? prev.body,
        tags: patch.tags ? dedupe(patch.tags) : prev.tags,
        metrics: { ...prev.metrics, ...(patch.metrics ?? {}) },
        updatedAt: Date.now(),
      };
      if (patch.body !== undefined) {
        validateBody(next.kind, next.body);
      }
      await this.writeRecordFile(next);
      cache.set(id, next);
      if (patch.metrics) {
        await this.writeMetricsFor(id, next.metrics);
      }
      return next;
    });
  }

  async get(id: string): Promise<MemoryRecord | null> {
    const cache = await this.ensureCache();
    return cache.get(id) ?? null;
  }

  async list(opts: ListOptions = {}): Promise<MemoryRecord[]> {
    const cache = await this.ensureCache();
    let rows = Array.from(cache.values());
    if (opts.layer) rows = rows.filter((r) => r.layer === opts.layer);
    if (opts.kind) rows = rows.filter((r) => r.kind === opts.kind);
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    if (opts.limit && opts.limit > 0) rows = rows.slice(0, opts.limit);
    return rows;
  }

  async recall(query: RecallQuery): Promise<MemoryRecord[]> {
    const cache = await this.ensureCache();
    const layerFilter =
      query.layer && query.layer !== "both" ? query.layer : null;

    const candidates = Array.from(cache.values()).filter((r) => {
      if (layerFilter && r.layer !== layerFilter) return false;
      if (query.kinds && query.kinds.length && !query.kinds.includes(r.kind))
        return false;
      if (query.kickoffId && r.refs.kickoffId !== query.kickoffId) return false;
      if (
        typeof query.minScore === "number" &&
        (r.metrics.score ?? 0) < query.minScore
      )
        return false;
      if (!matchTags(r.tags, query.tags)) return false;
      return true;
    });

    const text = (query.text ?? "").trim().toLowerCase();
    const limit = query.limit ?? DEFAULT_RECALL_LIMIT;
    const now = Date.now();

    return candidates
      .map((r) => ({
        record: r,
        score: rankScore(r, { text, weights: this.weights, now, query }),
      }))
      .filter((x) => x.score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.record);
  }

  async delete(id: string): Promise<void> {
    await this.withWriteLock(async () => {
      const cache = await this.ensureCache();
      const existing = cache.get(id);
      if (!existing) return;
      await this.removeRecordFile(existing).catch(() => {});
      cache.delete(id);
      await this.writeMetricsFor(id, null);
    });
  }

  async bumpHit(id: string): Promise<void> {
    await this.withWriteLock(async () => {
      const cache = await this.ensureCache();
      const r = cache.get(id);
      if (!r) return;
      r.metrics = {
        ...r.metrics,
        hits: (r.metrics.hits ?? 0) + 1,
        lastHitAt: Date.now(),
      };
      await this.writeMetricsFor(id, r.metrics);
    });
  }

  async setScore(id: string, score: number): Promise<void> {
    if (score < -1 || score > 1) {
      throw new Error(`score must be in [-1, 1]; got ${score}`);
    }
    await this.update(id, { metrics: { score } });
  }

  // ---------- internals ----------

  private async ensureDirs(): Promise<void> {
    await fs.mkdir(this.recordsDir, { recursive: true });
  }

  private async ensureLockTarget(): Promise<void> {
    await this.ensureDirs();
    try {
      await fs.access(this.lockPath);
    } catch {
      await fs.writeFile(this.lockPath, "", "utf8");
    }
  }

  /**
   * Build the in-memory cache by walking `records/` and overlaying
   * `metrics.json`. Idempotent and safe to call from multiple awaiters
   * in the same tick — first caller does the work, others reuse.
   */
  private async ensureCache(): Promise<Map<string, MemoryRecord>> {
    if (this.cache) return this.cache;
    const cache = new Map<string, MemoryRecord>();
    await this.ensureDirs();

    let kindDirs: string[];
    try {
      kindDirs = await fs.readdir(this.recordsDir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        this.cache = cache;
        return cache;
      }
      throw e;
    }

    for (const kindDir of kindDirs) {
      const dirPath = path.join(this.recordsDir, kindDir);
      let stat: import("node:fs").Stats;
      try {
        stat = await fs.stat(dirPath);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      let entries: string[];
      try {
        entries = await fs.readdir(dirPath);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.endsWith(".md") && !entry.endsWith(".json")) continue;
        const filePath = path.join(dirPath, entry);
        try {
          const raw = await fs.readFile(filePath, "utf8");
          const record = parseRecordFile(raw, entry.endsWith(".md") ? "markdown" : "json");
          if (record) cache.set(record.id, record);
        } catch (err) {
          console.warn(
            `[memory] skipping unparseable record file ${filePath}: ${(err as Error).message}`,
          );
        }
      }
    }

    // Overlay metrics
    const metrics = await this.readMetricsFile();
    for (const [id, m] of Object.entries(metrics)) {
      const r = cache.get(id);
      if (r) r.metrics = { ...r.metrics, ...m };
    }

    this.cache = cache;
    return cache;
  }

  private async writeRecordFile(r: MemoryRecord): Promise<void> {
    await fs.mkdir(path.join(this.recordsDir, r.kind), { recursive: true });
    const spec = getKindSpec(r.kind);
    const filePath = this.recordPathFor(r);
    const tmp = filePath + ".tmp";
    const serialized = serializeRecord(r, spec.format);
    await fs.writeFile(tmp, serialized, "utf8");
    await fs.rename(tmp, filePath);
  }

  private async removeRecordFile(r: MemoryRecord): Promise<void> {
    await fs.rm(this.recordPathFor(r), { force: true });
  }

  private recordPathFor(r: MemoryRecord): string {
    const spec = getKindSpec(r.kind);
    const ext = spec.format === "markdown" ? ".md" : ".json";
    return path.join(this.recordsDir, r.kind, `${r.id}${ext}`);
  }

  private async readMetricsFile(): Promise<Record<string, MemoryMetrics>> {
    try {
      const raw = await fs.readFile(this.metricsPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
      return {};
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
      console.warn(`[memory] metrics.json unreadable, starting fresh: ${(e as Error).message}`);
      return {};
    }
  }

  /** Persist a single record's metrics (or remove the entry if `null`). */
  private async writeMetricsFor(
    id: string,
    metrics: MemoryMetrics | null,
  ): Promise<void> {
    const all = await this.readMetricsFile();
    if (metrics === null || Object.keys(metrics).length === 0) {
      delete all[id];
    } else {
      all[id] = metrics;
    }
    const tmp = this.metricsPath + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(all, null, 2), "utf8");
    await fs.rename(tmp, this.metricsPath);
  }

  private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.writeQueue;
    let resolveCurrent: () => void = () => {};
    const current = new Promise<void>((res) => {
      resolveCurrent = res;
    });
    this.writeQueue = previous.then(() => current);

    try {
      await previous.catch(() => {});
      await this.ensureLockTarget();
      const release = await lockfile.lock(this.lockPath, {
        retries: { retries: 20, minTimeout: 50, maxTimeout: 500 },
        stale: 30_000,
      });
      try {
        return await fn();
      } finally {
        await release();
      }
    } finally {
      resolveCurrent();
    }
  }
}

// ---------- (de)serialization ----------

type RecordMetaForFile = Omit<MemoryRecord, "body" | "metrics">;

function recordMeta(r: MemoryRecord): RecordMetaForFile {
  // metrics is excluded — it lives in metrics.json, not committed.
  const { body, metrics, ...meta } = r;
  void body;
  void metrics;
  return meta;
}

function serializeRecord(r: MemoryRecord, format: "markdown" | "json"): string {
  if (format === "markdown") {
    const meta = JSON.stringify(recordMeta(r));
    return `${FRONTMATTER_FENCE}\n${meta}\n${FRONTMATTER_FENCE}\n\n${r.body}\n`;
  }
  // JSON envelope
  let bodyValue: unknown;
  try {
    bodyValue = JSON.parse(r.body);
  } catch {
    bodyValue = r.body;
  }
  return JSON.stringify({ ...recordMeta(r), body: bodyValue }, null, 2);
}

function parseRecordFile(raw: string, format: "markdown" | "json"): MemoryRecord | null {
  if (format === "markdown") {
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?\n?([\s\S]*)$/);
    if (!m) return null;
    let meta: RecordMetaForFile;
    try {
      meta = JSON.parse(m[1]!);
    } catch {
      return null;
    }
    const body = (m[2] ?? "").replace(/\n$/, "");
    return { ...meta, body, metrics: { hits: 0 } } as MemoryRecord;
  }
  let parsed: { body?: unknown } & Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const { body, ...meta } = parsed;
  const bodyStr =
    typeof body === "string" ? body : JSON.stringify(body ?? {});
  return { ...(meta as unknown as RecordMetaForFile), body: bodyStr, metrics: { hits: 0 } } as MemoryRecord;
}

// ---------- helpers ----------

function makeId(kind: MemoryKind): string {
  return `${kindPrefix(kind)}-${randomUUID().slice(0, 8)}`;
}

function kindPrefix(kind: MemoryKind): string {
  switch (kind) {
    case "classification":
      return "CL";
    case "failure-pattern":
      return "FP";
    case "scaffold-fitness":
      return "SF";
    case "agent-tuning":
      return "AT";
    case "model-routing":
      return "MR";
    case "prd-pattern":
      return "PRD";
    case "design-pattern":
      return "DSG";
    case "project-card":
      return "PC";
    case "task-history":
      return "TH";
    case "decision":
      return "DC";
    case "self-heal-log":
      return "SH";
    case "handoff-note":
      return "HN";
    case "codebase-map":
      return "CM";
    case "model-scorecard":
      return "MS";
    case "session-report":
      return "SR";
    case "qa-verdict":
      return "QV";
  }
}

function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

function matchTags(
  tags: string[],
  filter: RecallQuery["tags"],
): boolean {
  if (!filter) return true;
  const set = new Set(tags);
  if (filter.all && !filter.all.every((t) => set.has(t))) return false;
  if (filter.any && filter.any.length && !filter.any.some((t) => set.has(t)))
    return false;
  if (filter.none && filter.none.some((t) => set.has(t))) return false;
  return true;
}

interface RankCtx {
  text: string;
  weights: RecallWeights;
  now: number;
  query: RecallQuery;
}

function rankScore(r: MemoryRecord, ctx: RankCtx): number {
  let score = 0;

  const desiredTags = [
    ...(ctx.query.tags?.all ?? []),
    ...(ctx.query.tags?.any ?? []),
  ];
  if (desiredTags.length) {
    const set = new Set(r.tags);
    const hits = desiredTags.filter((t) => set.has(t)).length;
    score += ctx.weights.tagMatch * (hits / desiredTags.length);
  }

  if (ctx.text) {
    const hay = (r.title + " " + r.body).toLowerCase();
    if (hay.includes(ctx.text)) score += ctx.weights.textRelevance;
    else if (ctx.query.text) score -= 1;
  }

  const hits = r.metrics.hits ?? 0;
  score += ctx.weights.hits * Math.log(hits + 1);

  const ageMs = Math.max(0, ctx.now - r.updatedAt);
  const decay = Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS);
  score += ctx.weights.recency * decay;

  const qScore = r.metrics.score ?? 0;
  if (qScore < 0) score += ctx.weights.negativeScorePenalty * qScore;

  return score;
}
