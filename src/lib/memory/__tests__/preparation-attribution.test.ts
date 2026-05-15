/**
 * Unit tests for `computePrepAttributions`.
 *
 * Builds a synthetic trace + pattern set in memory and asserts the
 * algorithm correctly:
 *   - credits patterns when the user approved the artifact (human_approval)
 *   - blames patterns when the user edited it (human_edit)
 *   - prefers cite ids over the full inject set when both exist
 *   - leaves immune (manual:approved) patterns alone
 *   - skips already-attributed (sessionId, phase) keys via cursor
 *   - clamps scores to [-1, 1]
 */

import { describe, expect, it } from "vitest";

import {
  computePrepAttributions,
  cursorKey,
  DEFAULT_DELTA_APPROVAL,
  DEFAULT_DELTA_EDIT,
} from "../distill/preparation-attribution";
import type { TraceEvent } from "../trace";
import type { MemoryRecord } from "../types";

function pattern(
  id: string,
  over: Partial<MemoryRecord> = {},
): MemoryRecord {
  return {
    id,
    layer: "L1",
    kind: "prd-pattern",
    title: id,
    body: "",
    tags: [],
    source: "orchestrator",
    refs: {},
    metrics: { hits: 0, score: 0.4 },
    createdAt: 0,
    updatedAt: 0,
    schemaVersion: 1,
    ...over,
  };
}

function injectEvent(
  agent: "pm" | "design",
  sessionId: string,
  activeIds: string[],
): TraceEvent {
  return {
    ts: Date.now(),
    op: "inject",
    layer: "L1",
    kickoffId: sessionId,
    agent,
    details: { injected: true, activeIds },
  };
}

function citeEvent(
  agent: "pm" | "design",
  sessionId: string,
  validIds: string[],
): TraceEvent {
  return {
    ts: Date.now(),
    op: "cite",
    layer: "L1",
    kickoffId: sessionId,
    agent,
    details: { validIds },
  };
}

function outcomeEvent(
  phase: "prd" | "design",
  sessionId: string,
  source: "human_approval" | "human_edit",
): TraceEvent {
  return {
    ts: Date.now(),
    op: "prep-outcome",
    layer: "L1",
    kickoffId: sessionId,
    agent: phase === "prd" ? "pm" : "design",
    details: { phase, source, newRecordId: "PRD-new", projectType: "x", tier: "S" },
  };
}

const DELTAS = {
  deltaApproval: DEFAULT_DELTA_APPROVAL,
  deltaEdit: DEFAULT_DELTA_EDIT,
};

describe("computePrepAttributions", () => {
  it("credits all injected patterns on human_approval (no cite)", () => {
    const events: TraceEvent[] = [
      injectEvent("pm", "S1", ["PRD-a", "PRD-b"]),
      outcomeEvent("prd", "S1", "human_approval"),
    ];
    const patterns = new Map([
      ["PRD-a", pattern("PRD-a")],
      ["PRD-b", pattern("PRD-b")],
    ]);
    const r = computePrepAttributions({
      traceEvents: events,
      patternsById: patterns,
      alreadyAttributed: new Set(),
      ...DELTAS,
    });
    expect(r.attributions).toHaveLength(2);
    for (const a of r.attributions) {
      expect(a.approvals).toBe(1);
      expect(a.edits).toBe(0);
      expect(a.delta).toBeCloseTo(DEFAULT_DELTA_APPROVAL, 5);
      expect(a.source).toBe("inject-fallback");
    }
    expect(r.newlyAttributed).toEqual([cursorKey("S1", "prd")]);
  });

  it("blames only cited patterns when cite is present", () => {
    const events: TraceEvent[] = [
      injectEvent("design", "S2", ["DSG-a", "DSG-b", "DSG-c"]),
      citeEvent("design", "S2", ["DSG-b"]),
      outcomeEvent("design", "S2", "human_edit"),
    ];
    const patterns = new Map([
      ["DSG-a", pattern("DSG-a", { kind: "design-pattern" })],
      ["DSG-b", pattern("DSG-b", { kind: "design-pattern" })],
      ["DSG-c", pattern("DSG-c", { kind: "design-pattern" })],
    ]);
    const r = computePrepAttributions({
      traceEvents: events,
      patternsById: patterns,
      alreadyAttributed: new Set(),
      ...DELTAS,
    });
    expect(r.attributions).toHaveLength(1);
    const [a] = r.attributions;
    expect(a.patternId).toBe("DSG-b");
    expect(a.edits).toBe(1);
    expect(a.delta).toBeCloseTo(DEFAULT_DELTA_EDIT, 5);
    expect(a.source).toBe("cite");
  });

  it("drops hallucinated cite ids that weren't injected", () => {
    const events: TraceEvent[] = [
      injectEvent("pm", "S3", ["PRD-real"]),
      citeEvent("pm", "S3", ["PRD-real", "PRD-hallucinated"]),
      outcomeEvent("prd", "S3", "human_approval"),
    ];
    const patterns = new Map([
      ["PRD-real", pattern("PRD-real")],
      ["PRD-hallucinated", pattern("PRD-hallucinated")],
    ]);
    const r = computePrepAttributions({
      traceEvents: events,
      patternsById: patterns,
      alreadyAttributed: new Set(),
      ...DELTAS,
    });
    expect(r.attributions.map((a) => a.patternId)).toEqual(["PRD-real"]);
  });

  it("leaves manual:approved patterns immune (delta = 0, score unchanged)", () => {
    const events: TraceEvent[] = [
      injectEvent("pm", "S4", ["PRD-immune"]),
      outcomeEvent("prd", "S4", "human_edit"),
    ];
    const patterns = new Map([
      [
        "PRD-immune",
        pattern("PRD-immune", {
          tags: ["manual:approved"],
          metrics: { hits: 0, score: 0.5 },
        }),
      ],
    ]);
    const r = computePrepAttributions({
      traceEvents: events,
      patternsById: patterns,
      alreadyAttributed: new Set(),
      ...DELTAS,
    });
    const [a] = r.attributions;
    expect(a.immune).toBe(true);
    expect(a.delta).toBe(0);
    expect(a.newScore).toBe(0.5);
  });

  it("skips outcomes whose (sessionId, phase) is already attributed", () => {
    const events: TraceEvent[] = [
      injectEvent("pm", "S5", ["PRD-x"]),
      outcomeEvent("prd", "S5", "human_approval"),
    ];
    const patterns = new Map([["PRD-x", pattern("PRD-x")]]);
    const r = computePrepAttributions({
      traceEvents: events,
      patternsById: patterns,
      alreadyAttributed: new Set([cursorKey("S5", "prd")]),
      ...DELTAS,
    });
    expect(r.attributions).toHaveLength(0);
    expect(r.stats.outcomeEventsSkippedAlreadyAttributed).toBe(1);
    expect(r.newlyAttributed).toHaveLength(0);
  });

  it("clamps newScore to [-1, 1]", () => {
    const events: TraceEvent[] = [];
    // 30 approvals → +1.5 raw, should clamp to +1.0
    for (let i = 0; i < 30; i++) {
      const sid = `S${i}`;
      events.push(injectEvent("pm", sid, ["PRD-popular"]));
      events.push(outcomeEvent("prd", sid, "human_approval"));
    }
    const patterns = new Map([
      ["PRD-popular", pattern("PRD-popular", { metrics: { hits: 0, score: 0.4 } })],
    ]);
    const r = computePrepAttributions({
      traceEvents: events,
      patternsById: patterns,
      alreadyAttributed: new Set(),
      ...DELTAS,
    });
    const [a] = r.attributions;
    expect(a.newScore).toBe(1);
    expect(a.approvals).toBe(30);
  });

  it("aggregates approvals + edits across sessions correctly", () => {
    const events: TraceEvent[] = [
      // S6: edit on prd
      injectEvent("pm", "S6", ["PRD-x"]),
      outcomeEvent("prd", "S6", "human_edit"),
      // S7: approval on design (same pattern injected into both phases)
      injectEvent("design", "S7", ["PRD-x"]),
      outcomeEvent("design", "S7", "human_approval"),
      // S8: another approval on prd
      injectEvent("pm", "S8", ["PRD-x"]),
      outcomeEvent("prd", "S8", "human_approval"),
    ];
    const patterns = new Map([["PRD-x", pattern("PRD-x")]]);
    const r = computePrepAttributions({
      traceEvents: events,
      patternsById: patterns,
      alreadyAttributed: new Set(),
      ...DELTAS,
    });
    const [a] = r.attributions;
    expect(a.approvals).toBe(2);
    expect(a.edits).toBe(1);
    expect(a.delta).toBeCloseTo(
      2 * DEFAULT_DELTA_APPROVAL + DEFAULT_DELTA_EDIT,
      5,
    );
    expect(a.phase).toBe("both");
  });

  it("skips outcomes that have no matching injection", () => {
    const events: TraceEvent[] = [
      // No inject event for S9 → outcome is orphaned
      outcomeEvent("prd", "S9", "human_approval"),
    ];
    const patterns = new Map<string, MemoryRecord>();
    const r = computePrepAttributions({
      traceEvents: events,
      patternsById: patterns,
      alreadyAttributed: new Set(),
      ...DELTAS,
    });
    expect(r.attributions).toHaveLength(0);
    expect(r.stats.outcomeEventsSkippedNoInjection).toBe(1);
  });

  it("ignores inject events from non-prep agents", () => {
    const events: TraceEvent[] = [
      // worker_codegen inject — must NOT be counted toward prep attribution
      {
        ts: 0,
        op: "inject",
        layer: "L1",
        kickoffId: "S10",
        agent: "worker_codegen",
        details: { injected: true, activeIds: ["FP-x"] },
      },
      outcomeEvent("prd", "S10", "human_approval"),
    ];
    const patterns = new Map([["FP-x", pattern("FP-x")]]);
    const r = computePrepAttributions({
      traceEvents: events,
      patternsById: patterns,
      alreadyAttributed: new Set(),
      ...DELTAS,
    });
    expect(r.attributions).toHaveLength(0);
    expect(r.stats.outcomeEventsSkippedNoInjection).toBe(1);
  });

  it("marks source as 'mixed' when one outcome cited and another did not", () => {
    const events: TraceEvent[] = [
      // S11 with cite
      injectEvent("pm", "S11", ["PRD-z"]),
      citeEvent("pm", "S11", ["PRD-z"]),
      outcomeEvent("prd", "S11", "human_approval"),
      // S12 without cite (fallback)
      injectEvent("pm", "S12", ["PRD-z"]),
      outcomeEvent("prd", "S12", "human_approval"),
    ];
    const patterns = new Map([["PRD-z", pattern("PRD-z")]]);
    const r = computePrepAttributions({
      traceEvents: events,
      patternsById: patterns,
      alreadyAttributed: new Set(),
      ...DELTAS,
    });
    const [a] = r.attributions;
    expect(a.source).toBe("mixed");
    expect(a.approvals).toBe(2);
  });
});
