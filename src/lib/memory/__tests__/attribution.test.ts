/**
 * Tests for outcome attribution.
 *
 * Pure-function tests against `computeAttributions` — no file I/O.
 * Covers: success bump, failure penalty, asymmetric deltas, manual:approved
 * immunity, score clamping, cursor (already-attributed) skip, non-terminal
 * task statuses skipped, missing pattern records skipped.
 */

import { describe, expect, it } from "vitest";

import {
  computeAttributions,
  pairKey,
  DEFAULT_DELTA_SUCCESS,
  DEFAULT_DELTA_FAILURE,
} from "../distill/attribution";
import type { TraceEvent } from "../trace";
import type { MemoryRecord } from "../types";

// ---------- builders ----------

function pattern(id: string, score: number, approved = false): MemoryRecord {
  return {
    id,
    layer: "L1",
    kind: "failure-pattern",
    title: id,
    body: "## body",
    tags: approved ? ["mined", "manual:approved"] : ["mined"],
    source: "distill",
    refs: {},
    metrics: { hits: 0, score },
    createdAt: 0,
    updatedAt: 0,
    schemaVersion: 1,
  };
}

function taskHistory(
  kickoffId: string,
  taskId: string,
  status: string,
): MemoryRecord {
  return {
    id: `TH-${kickoffId}-${taskId}`,
    layer: "L2",
    kind: "task-history",
    title: `${taskId} (${status})`,
    body: JSON.stringify({ status, attempts: 1, files: [] }),
    tags: [],
    source: "orchestrator",
    refs: { kickoffId, taskId },
    metrics: {},
    createdAt: 0,
    updatedAt: 0,
    schemaVersion: 1,
  };
}

function injectEvent(
  kickoffId: string,
  taskId: string,
  activeIds: string[],
  injected = true,
): TraceEvent {
  return {
    ts: 0,
    op: "inject",
    layer: "L1",
    kickoffId,
    taskId,
    agent: "worker_codegen",
    details: { activeIds, injected, injectedTokens: 100 },
  };
}

const D_S = DEFAULT_DELTA_SUCCESS;
const D_F = DEFAULT_DELTA_FAILURE;

// ---------- tests ----------

describe("computeAttributions — success / failure deltas", () => {
  it("success bumps score by +deltaSuccess on injected pattern", () => {
    const p = pattern("FP-A", 0.1);
    const r = computeAttributions({
      traceEvents: [injectEvent("K1", "T1", ["FP-A"])],
      taskHistory: [taskHistory("K1", "T1", "completed")],
      patternsById: new Map([["FP-A", p]]),
      alreadyAttributed: new Set(),
      deltaSuccess: D_S,
      deltaFailure: D_F,
    });
    expect(r.attributions).toHaveLength(1);
    const a = r.attributions[0]!;
    expect(a.successes).toBe(1);
    expect(a.failures).toBe(0);
    expect(a.delta).toBeCloseTo(D_S);
    expect(a.newScore).toBeCloseTo(0.1 + D_S);
  });

  it("failure penalises by deltaFailure", () => {
    const p = pattern("FP-A", 0.5);
    const r = computeAttributions({
      traceEvents: [injectEvent("K1", "T1", ["FP-A"])],
      taskHistory: [taskHistory("K1", "T1", "failed")],
      patternsById: new Map([["FP-A", p]]),
      alreadyAttributed: new Set(),
      deltaSuccess: D_S,
      deltaFailure: D_F,
    });
    const a = r.attributions[0]!;
    expect(a.failures).toBe(1);
    expect(a.delta).toBeCloseTo(D_F);
    expect(a.newScore).toBeCloseTo(0.5 + D_F);
  });

  it("aggregates multiple events for the same pattern", () => {
    const p = pattern("FP-A", 0);
    const events: TraceEvent[] = [];
    const ths: MemoryRecord[] = [];
    for (let i = 0; i < 4; i++) {
      events.push(injectEvent("K1", `T${i}`, ["FP-A"]));
      ths.push(taskHistory("K1", `T${i}`, "completed"));
    }
    for (let i = 4; i < 6; i++) {
      events.push(injectEvent("K1", `T${i}`, ["FP-A"]));
      ths.push(taskHistory("K1", `T${i}`, "failed"));
    }
    const r = computeAttributions({
      traceEvents: events,
      taskHistory: ths,
      patternsById: new Map([["FP-A", p]]),
      alreadyAttributed: new Set(),
      deltaSuccess: D_S,
      deltaFailure: D_F,
    });
    const a = r.attributions[0]!;
    expect(a.successes).toBe(4);
    expect(a.failures).toBe(2);
    expect(a.delta).toBeCloseTo(4 * D_S + 2 * D_F);
  });
});

describe("computeAttributions — clamping", () => {
  it("score caps at +1 even with many successes", () => {
    const p = pattern("FP-A", 0.95);
    const r = computeAttributions({
      traceEvents: [
        injectEvent("K1", "T1", ["FP-A"]),
        injectEvent("K1", "T2", ["FP-A"]),
        injectEvent("K1", "T3", ["FP-A"]),
        injectEvent("K1", "T4", ["FP-A"]),
      ],
      taskHistory: [
        taskHistory("K1", "T1", "completed"),
        taskHistory("K1", "T2", "completed"),
        taskHistory("K1", "T3", "completed"),
        taskHistory("K1", "T4", "completed"),
      ],
      patternsById: new Map([["FP-A", p]]),
      alreadyAttributed: new Set(),
      deltaSuccess: D_S,
      deltaFailure: D_F,
    });
    expect(r.attributions[0]!.newScore).toBe(1);
  });

  it("score floors at -1", () => {
    const p = pattern("FP-A", -0.95);
    const events: TraceEvent[] = [];
    const ths: MemoryRecord[] = [];
    for (let i = 0; i < 5; i++) {
      events.push(injectEvent("K1", `T${i}`, ["FP-A"]));
      ths.push(taskHistory("K1", `T${i}`, "failed"));
    }
    const r = computeAttributions({
      traceEvents: events,
      taskHistory: ths,
      patternsById: new Map([["FP-A", p]]),
      alreadyAttributed: new Set(),
      deltaSuccess: D_S,
      deltaFailure: D_F,
    });
    expect(r.attributions[0]!.newScore).toBe(-1);
  });
});

describe("computeAttributions — manual:approved immunity", () => {
  it("approved patterns never get score changes from attribution", () => {
    const p = pattern("FP-A", 0.5, /* approved */ true);
    const r = computeAttributions({
      traceEvents: [
        injectEvent("K1", "T1", ["FP-A"]),
        injectEvent("K1", "T2", ["FP-A"]),
      ],
      taskHistory: [
        taskHistory("K1", "T1", "failed"),
        taskHistory("K1", "T2", "failed"),
      ],
      patternsById: new Map([["FP-A", p]]),
      alreadyAttributed: new Set(),
      deltaSuccess: D_S,
      deltaFailure: D_F,
    });
    const a = r.attributions[0]!;
    expect(a.immune).toBe(true);
    expect(a.failures).toBe(2); // counted for diagnostics
    expect(a.delta).toBe(0);
    expect(a.newScore).toBe(0.5);
  });
});

describe("computeAttributions — cursor + filtering", () => {
  it("skips already-attributed (kickoffId, taskId) pairs", () => {
    const p = pattern("FP-A", 0);
    const cursor = new Set<string>([pairKey("K1", "T1")]);
    const r = computeAttributions({
      traceEvents: [injectEvent("K1", "T1", ["FP-A"])],
      taskHistory: [taskHistory("K1", "T1", "completed")],
      patternsById: new Map([["FP-A", p]]),
      alreadyAttributed: cursor,
      deltaSuccess: D_S,
      deltaFailure: D_F,
    });
    expect(r.attributions).toHaveLength(0);
    expect(r.stats.taskHistorySkippedAlreadyAttributed).toBe(1);
    expect(r.newlyAttributed).toHaveLength(0);
  });

  it("skips non-terminal status (in_progress, skipped)", () => {
    const p = pattern("FP-A", 0);
    const r = computeAttributions({
      traceEvents: [
        injectEvent("K1", "T1", ["FP-A"]),
        injectEvent("K1", "T2", ["FP-A"]),
      ],
      taskHistory: [
        taskHistory("K1", "T1", "in_progress"),
        taskHistory("K1", "T2", "skipped"),
      ],
      patternsById: new Map([["FP-A", p]]),
      alreadyAttributed: new Set(),
      deltaSuccess: D_S,
      deltaFailure: D_F,
    });
    expect(r.attributions).toHaveLength(0);
    expect(r.stats.taskHistorySkippedNotTerminal).toBe(2);
  });

  it("skips inject events with injected=false (shadow only)", () => {
    const p = pattern("FP-A", 0);
    const r = computeAttributions({
      traceEvents: [injectEvent("K1", "T1", ["FP-A"], /* injected */ false)],
      taskHistory: [taskHistory("K1", "T1", "completed")],
      patternsById: new Map([["FP-A", p]]),
      alreadyAttributed: new Set(),
      deltaSuccess: D_S,
      deltaFailure: D_F,
    });
    expect(r.attributions).toHaveLength(0);
  });

  it("skips patterns missing from patternsById (deleted between runs)", () => {
    const r = computeAttributions({
      traceEvents: [injectEvent("K1", "T1", ["FP-deleted"])],
      taskHistory: [taskHistory("K1", "T1", "completed")],
      patternsById: new Map(),
      alreadyAttributed: new Set(),
      deltaSuccess: D_S,
      deltaFailure: D_F,
    });
    expect(r.attributions).toHaveLength(0);
    // Pair is still attributed so we don't revisit it
    expect(r.newlyAttributed).toEqual([pairKey("K1", "T1")]);
  });

  it("returns newlyAttributed pairs for cursor advancement", () => {
    const p = pattern("FP-A", 0);
    const r = computeAttributions({
      traceEvents: [
        injectEvent("K1", "T1", ["FP-A"]),
        injectEvent("K1", "T2", ["FP-A"]),
      ],
      taskHistory: [
        taskHistory("K1", "T1", "completed"),
        taskHistory("K1", "T2", "failed"),
      ],
      patternsById: new Map([["FP-A", p]]),
      alreadyAttributed: new Set(),
      deltaSuccess: D_S,
      deltaFailure: D_F,
    });
    expect(new Set(r.newlyAttributed)).toEqual(
      new Set([pairKey("K1", "T1"), pairKey("K1", "T2")]),
    );
  });
});

describe("computeAttributions — multi-pattern injection", () => {
  it("credits the same outcome to all patterns active in that task", () => {
    const a = pattern("FP-A", 0);
    const b = pattern("FP-B", 0.5);
    const r = computeAttributions({
      traceEvents: [injectEvent("K1", "T1", ["FP-A", "FP-B"])],
      taskHistory: [taskHistory("K1", "T1", "completed")],
      patternsById: new Map([
        ["FP-A", a],
        ["FP-B", b],
      ]),
      alreadyAttributed: new Set(),
      deltaSuccess: D_S,
      deltaFailure: D_F,
    });
    expect(r.attributions).toHaveLength(2);
    for (const x of r.attributions) {
      expect(x.successes).toBe(1);
      expect(x.delta).toBeCloseTo(D_S);
    }
  });
});

// ---------- cite-based attribution ----------

function citeEvent(
  kickoffId: string,
  taskId: string,
  validIds: string[],
  invalidIds: string[] = [],
): TraceEvent {
  return {
    ts: 0,
    op: "cite",
    layer: "L1",
    kickoffId,
    taskId,
    agent: "worker_codegen",
    details: { validIds, invalidIds, citedIds: [...validIds, ...invalidIds] },
  };
}

describe("computeAttributions — cite-based attribution", () => {
  it("when cite present, only cited patterns get credit (others get nothing)", () => {
    const a = pattern("FP-A", 0);
    const b = pattern("FP-B", 0);
    const r = computeAttributions({
      traceEvents: [
        injectEvent("K1", "T1", ["FP-A", "FP-B"]),
        citeEvent("K1", "T1", ["FP-A"]), // only A was useful
      ],
      taskHistory: [taskHistory("K1", "T1", "completed")],
      patternsById: new Map([
        ["FP-A", a],
        ["FP-B", b],
      ]),
      alreadyAttributed: new Set(),
      deltaSuccess: D_S,
      deltaFailure: D_F,
    });
    const byId = new Map(r.attributions.map((x) => [x.patternId, x]));
    expect(byId.get("FP-A")?.successes).toBe(1);
    expect(byId.get("FP-A")?.source).toBe("cite");
    expect(byId.has("FP-B")).toBe(false);
  });

  it("source='inject-fallback' when no cite present (existing behavior)", () => {
    const a = pattern("FP-A", 0);
    const r = computeAttributions({
      traceEvents: [injectEvent("K1", "T1", ["FP-A"])],
      taskHistory: [taskHistory("K1", "T1", "completed")],
      patternsById: new Map([["FP-A", a]]),
      alreadyAttributed: new Set(),
      deltaSuccess: D_S,
      deltaFailure: D_F,
    });
    expect(r.attributions[0]?.source).toBe("inject-fallback");
  });

  it("source='mixed' when same pattern earns credit via cite in one task and fallback in another", () => {
    const a = pattern("FP-A", 0);
    const r = computeAttributions({
      traceEvents: [
        injectEvent("K1", "T1", ["FP-A"]),
        citeEvent("K1", "T1", ["FP-A"]),
        injectEvent("K1", "T2", ["FP-A"]),
        // T2 has no cite event → fallback
      ],
      taskHistory: [
        taskHistory("K1", "T1", "completed"),
        taskHistory("K1", "T2", "completed"),
      ],
      patternsById: new Map([["FP-A", a]]),
      alreadyAttributed: new Set(),
      deltaSuccess: D_S,
      deltaFailure: D_F,
    });
    expect(r.attributions[0]?.successes).toBe(2);
    expect(r.attributions[0]?.source).toBe("mixed");
  });

  it("hallucinated cited ids (not in injection set) are dropped", () => {
    const a = pattern("FP-A", 0);
    const fake = pattern("FP-FAKE", 0);
    const r = computeAttributions({
      traceEvents: [
        injectEvent("K1", "T1", ["FP-A"]),
        // citedIds includes FP-FAKE which was never injected
        citeEvent("K1", "T1", [], ["FP-FAKE"]),
      ],
      taskHistory: [taskHistory("K1", "T1", "completed")],
      patternsById: new Map([
        ["FP-A", a],
        ["FP-FAKE", fake],
      ]),
      alreadyAttributed: new Set(),
      deltaSuccess: D_S,
      deltaFailure: D_F,
    });
    // FP-FAKE was hallucinated → dropped → no attribution
    expect(r.attributions.find((x) => x.patternId === "FP-FAKE")).toBeUndefined();
    // No valid cites → falls back to "all injected" → FP-A still gets credit
    expect(r.attributions.find((x) => x.patternId === "FP-A")?.successes).toBe(1);
    expect(r.attributions.find((x) => x.patternId === "FP-A")?.source).toBe(
      "inject-fallback",
    );
  });

  it("cite events from non-task scope (no kickoffId/taskId) are ignored", () => {
    const a = pattern("FP-A", 0);
    const orphanCite: TraceEvent = {
      ts: 0,
      op: "cite",
      layer: "L1",
      agent: "worker_codegen",
      details: { validIds: ["FP-A"] },
    };
    const r = computeAttributions({
      traceEvents: [injectEvent("K1", "T1", ["FP-A"]), orphanCite],
      taskHistory: [taskHistory("K1", "T1", "completed")],
      patternsById: new Map([["FP-A", a]]),
      alreadyAttributed: new Set(),
      deltaSuccess: D_S,
      deltaFailure: D_F,
    });
    // Orphan cite ignored → falls back to inject behavior
    expect(r.attributions[0]?.source).toBe("inject-fallback");
  });
});
