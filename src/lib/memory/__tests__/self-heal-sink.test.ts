import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createMemorySelfHealSink } from "../self-heal-sink";
import { FileStore } from "../file-store";
import { __resetMemoryRegistry } from "../index";

let tmp: string;
let outputDir: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mem-sh-"));
  outputDir = path.join(tmp, "out");
  await fs.mkdir(outputDir, { recursive: true });
  __resetMemoryRegistry();
  process.env.MEMORY_ENABLED = "true";
});

afterEach(async () => {
  delete process.env.MEMORY_ENABLED;
  await fs.rm(tmp, { recursive: true, force: true });
});

const SESSION_ID = "K-test-1";

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 60));
}

function makeSink() {
  return createMemorySelfHealSink({
    outputDir,
    kickoffSessionId: SESSION_ID,
  });
}

describe("self-heal sink — outcome classification", () => {
  it('records "fixed" when repairedIds non-empty and stillMissing empty', async () => {
    const sink = makeSink();
    sink({
      stage: "coverage-gate",
      event: "repair_done",
      attempt: 1,
      repairedIds: ["AC-14"],
      stillMissing: [],
      timestamp: "2026-04-28T10:00:00Z",
    });
    await flush();

    const store = new FileStore({ layer: "L2", root: outputDir });
    const all = await store.list({ kind: "self-heal-log" });
    expect(all.length).toBe(1);
    const body = JSON.parse(all[0]!.body);
    expect(body.outcome).toBe("fixed");
    expect(body.repairedIds).toEqual(["AC-14"]);
    expect(all[0]!.tags).toContain("outcome:fixed");
    expect(all[0]!.tags).toContain("stage:coverage-gate");
    expect(all[0]!.tags).toContain(`kickoff:${SESSION_ID}`);
  });

  it('records "progress" when both repairedIds and stillMissing non-empty', async () => {
    const sink = makeSink();
    sink({
      stage: "coverage-gate",
      event: "repair_done",
      attempt: 1,
      repairedIds: ["AC-14"],
      stillMissing: ["AC-15"],
      timestamp: "2026-04-28T10:00:00Z",
    });
    await flush();

    const store = new FileStore({ layer: "L2", root: outputDir });
    const all = await store.list({ kind: "self-heal-log" });
    expect(all.length).toBe(1);
    expect(JSON.parse(all[0]!.body).outcome).toBe("progress");
  });

  it('records "gave_up" on repair_final_state with stillMissing', async () => {
    const sink = makeSink();
    sink({
      stage: "coverage-gate",
      event: "repair_final_state",
      attempt: 3,
      stillMissing: ["AC-99"],
      timestamp: "2026-04-28T10:00:00Z",
    });
    await flush();

    const store = new FileStore({ layer: "L2", root: outputDir });
    const all = await store.list({ kind: "self-heal-log" });
    expect(all.length).toBe(1);
    expect(JSON.parse(all[0]!.body).outcome).toBe("gave_up");
  });

  it('records "other" when files changed but no repair-id signal', async () => {
    const sink = makeSink();
    sink({
      stage: "preflight-deps",
      event: "fix_attempted",
      files: ["package.json"],
      timestamp: "2026-04-28T10:00:00Z",
    });
    await flush();

    const store = new FileStore({ layer: "L2", root: outputDir });
    const all = await store.list({ kind: "self-heal-log" });
    expect(all.length).toBe(1);
    expect(JSON.parse(all[0]!.body).outcome).toBe("other");
    expect(all[0]!.tags).toContain("ext:json");
  });
});

describe("self-heal sink — filtering", () => {
  it("skips pure-notification *_start with no concrete signal", async () => {
    const sink = makeSink();
    sink({
      stage: "coverage-gate",
      event: "repair_start",
      attempt: 1,
      missingIds: ["AC-14"],
      timestamp: "2026-04-28T10:00:00Z",
    });
    await flush();
    const store = new FileStore({ layer: "L2", root: outputDir });
    expect((await store.list({ kind: "self-heal-log" })).length).toBe(0);
  });

  it("skips events with no signal at all", async () => {
    const sink = makeSink();
    sink({
      stage: "task",
      event: "noop",
      timestamp: "2026-04-28T10:00:00Z",
    });
    await flush();
    const store = new FileStore({ layer: "L2", root: outputDir });
    expect((await store.list({ kind: "self-heal-log" })).length).toBe(0);
  });

  it("MEMORY_ENABLED=false → noop sink, no records", async () => {
    process.env.MEMORY_ENABLED = "false";
    const sink = createMemorySelfHealSink({
      outputDir,
      kickoffSessionId: SESSION_ID,
    });
    sink({
      stage: "coverage-gate",
      event: "repair_done",
      repairedIds: ["AC-14"],
      timestamp: "2026-04-28T10:00:00Z",
    });
    await flush();
    const memDir = path.join(outputDir, ".memory");
    const exists = await fs.access(memDir).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });
});

describe("self-heal sink — id stability + idempotency", () => {
  it("same (stage, attempt, taskId) → idempotent overwrite", async () => {
    const sink = makeSink();
    const ev = {
      stage: "task" as const,
      event: "repair_done",
      attempt: 2,
      taskId: "T-001",
      repairedIds: ["X"],
      stillMissing: [],
      timestamp: "2026-04-28T10:00:00Z",
    };
    sink(ev);
    await flush();
    sink({ ...ev, files: ["src/x.ts"] });
    await flush();

    const store = new FileStore({ layer: "L2", root: outputDir });
    const all = await store.list({ kind: "self-heal-log" });
    expect(all.length).toBe(1);
    expect(JSON.parse(all[0]!.body).files).toEqual(["src/x.ts"]);
  });

  it("falls back to event.runId when no kickoffSessionId", async () => {
    const sink = createMemorySelfHealSink({ outputDir });
    sink({
      stage: "coverage-gate",
      event: "repair_done",
      runId: "run-from-event",
      repairedIds: ["AC-1"],
      timestamp: "2026-04-28T10:00:00Z",
    });
    await flush();
    const store = new FileStore({ layer: "L2", root: outputDir });
    const all = await store.list({ kind: "self-heal-log" });
    expect(all.length).toBe(1);
    expect(all[0]!.refs.kickoffId).toBe("run-from-event");
  });

  it("never throws into the emitter chain on bad input", () => {
    const sink = makeSink();
    expect(() => {
      // Deliberately malformed
      sink({
        stage: "x" as never,
        event: "repair_done",
        repairedIds: ["a"],
        timestamp: "2026-04-28T10:00:00Z",
      });
    }).not.toThrow();
  });
});
