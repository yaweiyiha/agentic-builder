import { describe, expect, it } from "vitest";

import { minePatternsFromRepairLog } from "../distill/repair-log-miner";
import type { RepairEvent } from "@/lib/pipeline/self-heal/events";

function ev(over: Partial<RepairEvent>): RepairEvent {
  return {
    timestamp: "2026-04-28T10:00:00Z",
    stage: "coverage-gate",
    event: "repair_done",
    ...over,
  } as RepairEvent;
}

describe("minePatternsFromRepairLog — clustering", () => {
  it("does not emit patterns below the min-cluster threshold", () => {
    const events = [ev({ repairedIds: ["AC-1"] })];
    const patterns = minePatternsFromRepairLog(events, { minCluster: 2 });
    expect(patterns.length).toBe(0);
  });

  it("clusters by (stage, event)", () => {
    const events = [
      ev({ stage: "coverage-gate", event: "repair_done", repairedIds: ["a"] }),
      ev({ stage: "coverage-gate", event: "repair_done", repairedIds: ["b"] }),
      ev({ stage: "e2e-triage", event: "repair_done", repairedIds: ["c"] }),
      ev({ stage: "e2e-triage", event: "repair_done", repairedIds: ["d"] }),
    ];
    const patterns = minePatternsFromRepairLog(events, { minCluster: 2 });
    expect(patterns.length).toBe(2);
    expect(patterns.map((p) => p.id).sort()).toEqual([
      "FP-mined-coverage-gate-repair-done",
      "FP-mined-e2e-triage-repair-done",
    ]);
  });

  it("ids are deterministic and idempotent across runs", () => {
    const events = [
      ev({ stage: "coverage-gate", event: "repair_done", repairedIds: ["a"] }),
      ev({ stage: "coverage-gate", event: "repair_done", repairedIds: ["b"] }),
    ];
    const a = minePatternsFromRepairLog(events);
    const b = minePatternsFromRepairLog(events);
    expect(a[0]!.id).toBe(b[0]!.id);
    expect(a[0]!.body).toBe(b[0]!.body);
  });

  it("counts outcomes correctly", () => {
    const events = [
      ev({ event: "repair_done", repairedIds: ["a"], stillMissing: [] }),
      ev({ event: "repair_done", repairedIds: ["b"], stillMissing: ["c"] }),
      ev({
        event: "repair_done",
        stillMissing: ["d"],
      }),
      ev({ event: "repair_done", files: ["x.ts"] }),
    ];
    const [p] = minePatternsFromRepairLog(events, { minCluster: 1 });
    expect(p!.outcomes).toEqual({ fixed: 1, progress: 1, gaveUp: 0, other: 2 });
  });

  it("skips pure-notification *_start events with no signal", () => {
    const events = [
      ev({ event: "repair_start", missingIds: ["a"] }),
      ev({ event: "repair_start", missingIds: ["b"] }),
    ];
    const patterns = minePatternsFromRepairLog(events, { minCluster: 1 });
    expect(patterns.length).toBe(0);
  });

  it("aggregates top file extensions", () => {
    const events = [
      ev({
        event: "fix",
        files: ["a.ts", "b.tsx", "c.ts", "d.json"],
      }),
      ev({ event: "fix", files: ["e.ts", "f.json"] }),
    ];
    const [p] = minePatternsFromRepairLog(events, { minCluster: 1 });
    expect(p!.topExtensions[0]).toBe("ts"); // 3 .ts > 2 .json > 1 .tsx
    expect(p!.tags).toContain("ext:ts");
    expect(p!.tags).toContain("event:fix");
    expect(p!.tags).toContain("stage:coverage-gate");
    expect(p!.tags).toContain("mined");
  });

  it("counts unique sessions, not events", () => {
    const events = [
      ev({ sessionId: "s1", repairedIds: ["a"] }),
      ev({ sessionId: "s1", repairedIds: ["b"] }),
      ev({ sessionId: "s2", repairedIds: ["c"] }),
    ];
    const [p] = minePatternsFromRepairLog(events, { minCluster: 1 });
    expect(p!.occurrences).toBe(3);
    expect(p!.sessions).toBe(2);
  });

  it("body contains symptoms / pattern / frequency / status sections", () => {
    const events = [
      ev({
        event: "fix_attempted",
        details: { reason: "missing dependency X" },
        files: ["a.ts"],
      }),
      ev({
        event: "fix_attempted",
        details: { reason: "missing dependency X" },
        files: ["b.ts"],
      }),
    ];
    const [p] = minePatternsFromRepairLog(events);
    expect(p!.body).toContain("## Symptoms");
    expect(p!.body).toContain("## Pattern");
    expect(p!.body).toContain("## Frequency");
    expect(p!.body).toContain("## Status");
    expect(p!.body).toContain("missing dependency X");
    expect(p!.body).toContain("Layer 3 shadow");
  });

  it("limit caps the patterns returned", () => {
    const events: RepairEvent[] = [];
    for (let i = 0; i < 5; i++) {
      events.push(ev({ stage: `s${i}`, event: "e", repairedIds: ["a"] }));
      events.push(ev({ stage: `s${i}`, event: "e", repairedIds: ["b"] }));
    }
    const all = minePatternsFromRepairLog(events);
    expect(all.length).toBe(5);
    const top = minePatternsFromRepairLog(events, { limit: 2 });
    expect(top.length).toBe(2);
  });
});
