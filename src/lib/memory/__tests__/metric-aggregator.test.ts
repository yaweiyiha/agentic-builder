/**
 * Tests for aggregateByBucket — turns trace events + task-history into
 * per-bucket success rate comparisons.
 */

import { describe, expect, it } from "vitest";

import { aggregateByBucket } from "../distill/metric-aggregator";
import type { TraceEvent } from "../trace";
import type { MemoryRecord } from "../types";

const NOW = 1_700_000_000_000;

function injectEvent(
  kickoff: string,
  task: string,
  injected: boolean,
  activeIds: string[] = [],
): TraceEvent {
  return {
    ts: NOW,
    op: "inject",
    layer: "L1",
    kickoffId: kickoff,
    taskId: task,
    agent: "worker_codegen",
    details: { injected, activeIds },
  };
}

function taskHistory(args: {
  kickoff: string;
  taskId: string;
  status: "completed" | "failed";
  taskKind?: string;
  failureMode?: string;
  errorMessage?: string;
}): MemoryRecord {
  return {
    id: `TH-${args.kickoff}-${args.taskId}`,
    layer: "L2",
    kind: "task-history",
    title: `${args.taskId} (${args.status})`,
    body: JSON.stringify({
      status: args.status,
      taskKind: args.taskKind,
      failureMode: args.failureMode,
      errorMessage: args.errorMessage,
    }),
    tags: [],
    source: "orchestrator",
    refs: { kickoffId: args.kickoff, taskId: args.taskId },
    metrics: {},
    createdAt: NOW,
    updatedAt: NOW,
    schemaVersion: 1,
  };
}

describe("aggregateByBucket", () => {
  it("buckets by (taskKind, failureMode, injectState) and tracks counts", () => {
    const trace: TraceEvent[] = [
      injectEvent("k1", "T-1", true, ["FP-a"]),
      injectEvent("k1", "T-2", false), // recall happened, no inject
      injectEvent("k1", "T-3", true, ["FP-a", "FP-b"]),
    ];
    const history: MemoryRecord[] = [
      taskHistory({
        kickoff: "k1",
        taskId: "T-1",
        status: "completed",
        taskKind: "codegen",
      }),
      taskHistory({
        kickoff: "k1",
        taskId: "T-2",
        status: "failed",
        taskKind: "codegen",
        failureMode: "type-error",
      }),
      taskHistory({
        kickoff: "k1",
        taskId: "T-3",
        status: "completed",
        taskKind: "codegen",
      }),
    ];
    const r = aggregateByBucket(trace, history);

    const byKey = new Map(r.buckets.map((b) => [b.key, b]));
    expect(byKey.get("codegen|none|on")?.success).toBe(2);
    expect(byKey.get("codegen|none|on")?.total).toBe(2);
    expect(byKey.get("codegen|type-error|off")?.failure).toBe(1);
    expect(byKey.get("codegen|none|on")?.injectedPatterns).toBe(3);
  });

  it("computes per-(taskKind,failureMode) on/off comparisons with delta", () => {
    const trace: TraceEvent[] = [
      // codegen successes WITH inject
      injectEvent("k1", "A1", true, ["FP-a"]),
      injectEvent("k1", "A2", true, ["FP-a"]),
      // codegen successes WITHOUT inject
      injectEvent("k2", "B1", false),
    ];
    const history: MemoryRecord[] = [
      taskHistory({
        kickoff: "k1",
        taskId: "A1",
        status: "completed",
        taskKind: "codegen",
      }),
      taskHistory({
        kickoff: "k1",
        taskId: "A2",
        status: "completed",
        taskKind: "codegen",
      }),
      taskHistory({
        kickoff: "k2",
        taskId: "B1",
        status: "failed",
        taskKind: "codegen",
        failureMode: "compile-error",
      }),
    ];
    const r = aggregateByBucket(trace, history);
    const success = r.comparisons.find(
      (c) => c.taskKind === "codegen" && c.failureMode === "none",
    );
    expect(success?.on.successRate).toBe(1);
    expect(success?.on.total).toBe(2);
    expect(success?.off.total).toBe(0);
    expect(success?.delta).toBe(1); // 1.0 on - 0.0 off
  });

  it("auto-classifies failureMode from errorMessage when not provided", () => {
    const trace: TraceEvent[] = [injectEvent("k1", "T-fail", false)];
    const history: MemoryRecord[] = [
      taskHistory({
        kickoff: "k1",
        taskId: "T-fail",
        status: "failed",
        taskKind: "codegen",
        errorMessage: "TypeError: x is not a function",
      }),
    ];
    const r = aggregateByBucket(trace, history);
    const k = r.buckets[0]?.key;
    expect(k).toBe("codegen|type-error|off");
  });

  it("infers taskKind from taskId when body lacks the field", () => {
    const trace: TraceEvent[] = [injectEvent("k1", "qa-pass-1", false)];
    const history: MemoryRecord[] = [
      taskHistory({ kickoff: "k1", taskId: "qa-pass-1", status: "completed" }),
    ];
    const r = aggregateByBucket(trace, history);
    expect(r.buckets[0]?.taskKind).toBe("qa");
  });

  it("skips non-terminal task-history records", () => {
    const trace: TraceEvent[] = [];
    const history: MemoryRecord[] = [
      {
        ...taskHistory({
          kickoff: "k1",
          taskId: "T-1",
          status: "completed",
        }),
        body: JSON.stringify({ status: "in_progress" }),
      },
    ];
    const r = aggregateByBucket(trace, history);
    expect(r.buckets).toHaveLength(0);
    expect(r.stats.nonTerminalSkipped).toBe(1);
    expect(r.stats.terminalTasks).toBe(0);
  });

  it("orders comparisons by delta desc (where memory helps most first)", () => {
    const trace: TraceEvent[] = [
      injectEvent("k1", "A1", true, ["FP-a"]),
      injectEvent("k2", "B1", true, ["FP-b"]),
      injectEvent("k3", "B2", false),
    ];
    const history: MemoryRecord[] = [
      // codegen success with inject (high delta)
      taskHistory({
        kickoff: "k1",
        taskId: "A1",
        status: "completed",
        taskKind: "codegen",
      }),
      // qa success with inject
      taskHistory({
        kickoff: "k2",
        taskId: "B1",
        status: "completed",
        taskKind: "qa",
      }),
      // qa failure without inject (so qa-on has 1.0, qa-off has 0)
      taskHistory({
        kickoff: "k3",
        taskId: "B2",
        status: "failed",
        taskKind: "qa",
        failureMode: "type-error",
      }),
    ];
    const r = aggregateByBucket(trace, history);
    expect(r.comparisons.length).toBeGreaterThan(0);
    // First comparison should have non-negative delta
    expect(r.comparisons[0]?.delta).toBeGreaterThanOrEqual(0);
  });
});
