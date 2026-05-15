/**
 * Tests for escalateRepairCircuit — the function called once a repair
 * surface has tripped the AttemptTracker circuit breaker.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { AttemptTracker, type AttemptScope } from "../attempt-tracker";
import { escalateRepairCircuit } from "../escalate-repair-circuit";
import type { RepairEvent } from "../events";

async function mkTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "escalate-circuit-"));
}

const scope: AttemptScope = { stage: "phase-gate", scopeKey: "backend" };

function collectingEmitter(): {
  events: RepairEvent[];
  emitter: (e: Omit<RepairEvent, "timestamp"> & { timestamp?: string }) => void;
} {
  const events: RepairEvent[] = [];
  return {
    events,
    emitter: (e) => {
      events.push({
        ...e,
        timestamp: e.timestamp ?? new Date().toISOString(),
      } as RepairEvent);
    },
  };
}

describe("escalateRepairCircuit — without chat", () => {
  let dir: string;
  let tracker: AttemptTracker;
  beforeEach(async () => {
    dir = await mkTempDir();
    tracker = new AttemptTracker({ outputDir: dir });
  });
  afterEach(async () => {
    await tracker.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns recorded=false when scope has no tracked record", async () => {
    const { emitter, events } = collectingEmitter();
    const result = await escalateRepairCircuit({
      scope,
      tracker,
      outputDir: dir,
      emitter,
    });
    expect(result.recorded).toBe(false);
    expect(events).toEqual([]);
  });

  it("appends an escalation entry and emits circuit_escalation event", async () => {
    await tracker.noteStart(scope);
    await tracker.noteOutcome(scope, "still_missing");
    await tracker.noteStart(scope);
    await tracker.noteStart(scope);

    const { emitter, events } = collectingEmitter();
    const result = await escalateRepairCircuit({
      scope,
      tracker,
      outputDir: dir,
      emitter,
      reason: "test escalation",
      sessionId: "sess-1",
    });

    expect(result.recorded).toBe(true);
    expect(result.escalationFilePath).toBe(
      path.join(dir, ".ralph/escalations.jsonl"),
    );
    expect(result.plan).toBeUndefined();

    const raw = await fs.readFile(result.escalationFilePath!, "utf-8");
    const line = raw.trim();
    const entry = JSON.parse(line);
    expect(entry.scope.stage).toBe("phase-gate");
    expect(entry.scope.scopeKey).toBe("backend");
    expect(entry.attempts).toBe(3);
    expect(entry.reason).toBe("test escalation");
    expect(entry.sessionId).toBe("sess-1");
    expect(entry.plan).toBeUndefined();

    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe("circuit_escalation");
    expect(events[0]?.circuitOpen).toBe(true);
    expect(events[0]?.details?.planAttached).toBe(false);
  });

  it("appends multiple entries to the same file as JSONL", async () => {
    await tracker.noteStart(scope);
    await tracker.noteStart(scope);
    const { emitter } = collectingEmitter();
    await escalateRepairCircuit({ scope, tracker, outputDir: dir, emitter });
    await escalateRepairCircuit({ scope, tracker, outputDir: dir, emitter });

    const raw = await fs.readFile(
      path.join(dir, ".ralph/escalations.jsonl"),
      "utf-8",
    );
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(() => JSON.parse(lines[0]!)).not.toThrow();
    expect(() => JSON.parse(lines[1]!)).not.toThrow();
  });
});

describe("escalateRepairCircuit — with chat", () => {
  let dir: string;
  let tracker: AttemptTracker;
  beforeEach(async () => {
    dir = await mkTempDir();
    tracker = new AttemptTracker({ outputDir: dir });
  });
  afterEach(async () => {
    await tracker.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("includes a plan when the replan succeeds", async () => {
    await tracker.noteStart(scope);
    await tracker.noteStart(scope);
    await tracker.noteStart(scope);

    const { emitter, events } = collectingEmitter();
    const result = await escalateRepairCircuit({
      scope,
      tracker,
      outputDir: dir,
      emitter,
      diagnostics: { tscErrors: ["fake/file.ts:1 TS2322"] },
      chat: async () =>
        [
          "- Fix fake/file.ts:1 by widening type.",
          "- Re-run tsc to confirm.",
          "- Update tests if needed.",
        ].join("\n"),
    });

    expect(result.recorded).toBe(true);
    expect(result.plan).toContain("Fix fake/file.ts");
    expect(events[0]?.details?.planAttached).toBe(true);

    const raw = await fs.readFile(result.escalationFilePath!, "utf-8");
    const entry = JSON.parse(raw.trim());
    expect(entry.plan).toContain("Fix fake/file.ts");
  });

  it("records the escalation even when chat throws", async () => {
    await tracker.noteStart(scope);
    await tracker.noteStart(scope);
    await tracker.noteStart(scope);
    const { emitter, events } = collectingEmitter();
    const result = await escalateRepairCircuit({
      scope,
      tracker,
      outputDir: dir,
      emitter,
      chat: async () => {
        throw new Error("LLM unavailable");
      },
    });
    expect(result.recorded).toBe(true);
    expect(result.plan).toBeUndefined();
    expect(events[0]?.event).toBe("circuit_escalation");
    expect(events[0]?.details?.planAttached).toBe(false);
  });
});
