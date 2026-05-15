/**
 * Tests for renderMemoryContext — verifies that injection-time re-ranking
 * keeps the highest-quality records when the token budget bites, even when
 * the input order (recall ranking) would have dropped them.
 */

import { describe, expect, it } from "vitest";

import { renderMemoryContext, sortByInjectionRelevance } from "../inject";
import type { MemoryRecord } from "../types";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function rec(over: Partial<MemoryRecord> & { id: string }): MemoryRecord {
  return {
    id: over.id,
    layer: "L1",
    kind: "failure-pattern",
    title: over.title ?? `title ${over.id}`,
    body: over.body ?? `body ${over.id}`,
    tags: over.tags ?? [],
    source: over.source ?? "manual",
    refs: over.refs ?? {},
    metrics: over.metrics ?? {},
    createdAt: over.createdAt ?? NOW - DAY,
    updatedAt: over.updatedAt ?? NOW - DAY,
    schemaVersion: 1,
  };
}

describe("renderMemoryContext — relevance-based truncation", () => {
  it("higher quality score wins when budget bites, regardless of input order", () => {
    // Each body is ~600 chars → 150 tokens. Budget 200 tokens fits ~1 record.
    const big = "x".repeat(600);
    // Input order is reversed from quality order to verify re-ranking happens.
    const records: MemoryRecord[] = [
      rec({ id: "FP-low", body: big, metrics: { score: 0.1 } }),
      rec({ id: "FP-mid", body: big, metrics: { score: 0.4 } }),
      rec({ id: "FP-high", body: big, metrics: { score: 0.9 } }),
    ];

    const out = renderMemoryContext(records, { tokenBudget: 200, now: NOW });

    expect(out.included.length).toBeGreaterThanOrEqual(1);
    expect(out.included[0]?.id).toBe("FP-high");
    expect(out.included.map((r) => r.id)).not.toContain("FP-low");
  });

  it("recency breaks ties when quality scores are equal", () => {
    const big = "x".repeat(600);
    const records: MemoryRecord[] = [
      rec({
        id: "FP-old",
        body: big,
        metrics: { score: 0.5 },
        updatedAt: NOW - 90 * DAY,
      }),
      rec({
        id: "FP-new",
        body: big,
        metrics: { score: 0.5 },
        updatedAt: NOW - 1 * DAY,
      }),
    ];
    const out = renderMemoryContext(records, { tokenBudget: 200, now: NOW });
    expect(out.included[0]?.id).toBe("FP-new");
  });

  it("hits contribute when score and recency are tied", () => {
    const big = "x".repeat(600);
    const records: MemoryRecord[] = [
      rec({
        id: "FP-cold",
        body: big,
        metrics: { score: 0.5, hits: 0 },
        updatedAt: NOW - DAY,
      }),
      rec({
        id: "FP-hot",
        body: big,
        metrics: { score: 0.5, hits: 50 },
        updatedAt: NOW - DAY,
      }),
    ];
    const out = renderMemoryContext(records, { tokenBudget: 200, now: NOW });
    expect(out.included[0]?.id).toBe("FP-hot");
  });

  it("never returns empty when at least one record is present (always keeps top-1)", () => {
    // Tiny budget that wouldn't normally fit any record's body.
    const records: MemoryRecord[] = [
      rec({ id: "FP-only", body: "x".repeat(2000), metrics: { score: 0.9 } }),
    ];
    const out = renderMemoryContext(records, { tokenBudget: 1, now: NOW });
    expect(out.included.map((r) => r.id)).toEqual(["FP-only"]);
  });

  it("with a generous budget, all records render in relevance order", () => {
    const records: MemoryRecord[] = [
      rec({ id: "FP-a", metrics: { score: 0.2 } }),
      rec({ id: "FP-b", metrics: { score: 0.8 } }),
      rec({ id: "FP-c", metrics: { score: 0.5 } }),
    ];
    const out = renderMemoryContext(records, { tokenBudget: 5000, now: NOW });
    expect(out.included.map((r) => r.id)).toEqual(["FP-b", "FP-c", "FP-a"]);
  });

  it("custom relevanceWeights override defaults", () => {
    // With qualityScore weight = 0, ranking falls back to recency + hits.
    const records: MemoryRecord[] = [
      rec({
        id: "FP-low-recent",
        metrics: { score: 0.1 },
        updatedAt: NOW - DAY,
      }),
      rec({
        id: "FP-high-old",
        metrics: { score: 0.9 },
        updatedAt: NOW - 365 * DAY,
      }),
    ];
    const out = renderMemoryContext(records, {
      tokenBudget: 5000,
      now: NOW,
      relevanceWeights: { qualityScore: 0, recency: 10, hits: 0 },
    });
    expect(out.included[0]?.id).toBe("FP-low-recent");
  });
});

describe("sortByInjectionRelevance — pure function exposure", () => {
  it("matches the order used by renderMemoryContext", () => {
    const records: MemoryRecord[] = [
      rec({ id: "FP-a", metrics: { score: 0.2 } }),
      rec({ id: "FP-b", metrics: { score: 0.8 } }),
      rec({ id: "FP-c", metrics: { score: 0.5 } }),
    ];
    const sorted = sortByInjectionRelevance(records, undefined, NOW);
    expect(sorted.map((r) => r.id)).toEqual(["FP-b", "FP-c", "FP-a"]);
  });
});
