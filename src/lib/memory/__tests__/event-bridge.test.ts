import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { wrapPipelineEventHandler } from "../event-bridge";
import { FileStore } from "../file-store";
import { __resetMemoryRegistry } from "../index";
import type { PipelineEvent } from "@/lib/pipeline/types";

let tmp: string;
let outputDir: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mem-bridge-"));
  // resolveCodeOutputRoot puts generated code under <projectRoot>/generated-code
  // by default; we override by passing codeOutputDir.
  outputDir = path.join(tmp, "out");
  await fs.mkdir(outputDir, { recursive: true });
  __resetMemoryRegistry();
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const RUN_ID = "K-test-1";

function ev(over: Partial<PipelineEvent>): PipelineEvent {
  return {
    type: "step_start",
    runId: RUN_ID,
    stepId: "intent",
    data: {},
    ...over,
  } as PipelineEvent;
}

async function flush(): Promise<void> {
  // Bridge writes are fire-and-forget (void recordX()) — they queue
  // through proper-lockfile. Wait long enough for the writes to land
  // even when other tests are competing for fs I/O in the same run.
  await new Promise((r) => setTimeout(r, 250));
}

describe("event-bridge", () => {
  it("writes project-card on intent complete + task-history per step", async () => {
    const seen: PipelineEvent[] = [];
    const wrapped = wrapPipelineEventHandler((e) => seen.push(e), {
      projectRoot: tmp,
      codeOutputDir: outputDir,
      featureBrief: "Build a clock app",
    });

    wrapped(ev({ type: "step_start", stepId: "intent" }));
    wrapped(
      ev({
        type: "step_complete",
        stepId: "intent",
        data: {
          content: "Build a clock app",
          metadata: {
            classification: {
              tier: "S",
              type: "tool",
              needsBackend: false,
              needsDatabase: false,
              needsAuth: false,
              reasoning: "single-page utility",
            },
          },
        },
      }),
    );
    wrapped(ev({ type: "step_start", stepId: "prd" }));
    wrapped(
      ev({ type: "step_complete", stepId: "prd", data: { costUsd: 0.02, durationMs: 1234 } }),
    );

    await flush();

    const store = new FileStore({ layer: "L2", root: outputDir });
    const all = await store.list({ limit: 50 });

    // pass-through preserved
    expect(seen.length).toBe(4);

    // project-card present
    const card = all.find((r) => r.kind === "project-card");
    expect(card).toBeTruthy();
    expect(card?.id).toBe(`PC-${RUN_ID}`);
    expect(card?.body).toContain("Build a clock app");
    expect(card?.tags).toContain(`kickoff:${RUN_ID}`);
    expect(card?.tags).toContain("tier:S");

    // task-history records: intent in_progress + completed, prd in_progress + completed
    // (idempotent save means in_progress overwritten by completed)
    const histories = all.filter((r) => r.kind === "task-history");
    expect(histories.length).toBe(2);
    const intent = histories.find((r) => r.refs.taskId === "intent");
    const prd = histories.find((r) => r.refs.taskId === "prd");
    expect(intent?.tags).toContain("status:completed");
    expect(prd?.tags).toContain("status:completed");
    const prdBody = JSON.parse(prd!.body);
    expect(prdBody.costUsd).toBe(0.02);
    expect(prdBody.durationMs).toBe(1234);
  });

  it("records step_error as failed status", async () => {
    const wrapped = wrapPipelineEventHandler(() => {}, {
      projectRoot: tmp,
      codeOutputDir: outputDir,
    });
    wrapped(ev({ type: "step_start", stepId: "trd" }));
    wrapped(
      ev({
        type: "step_error",
        stepId: "trd",
        data: { error: "model timeout" },
      }),
    );
    await flush();
    const store = new FileStore({ layer: "L2", root: outputDir });
    const all = await store.list({ limit: 50 });
    const trd = all.find((r) => r.refs.taskId === "trd");
    expect(trd?.tags).toContain("status:failed");
    expect(JSON.parse(trd!.body).errorMessage).toBe("model timeout");
  });

  it("never throws into the inner handler when memory ops fail", async () => {
    // Point outputDir at a path we cannot write to — bridge should swallow.
    const badDir = path.join(tmp, "ro");
    await fs.mkdir(badDir, { recursive: true });
    await fs.chmod(badDir, 0o555);

    const seen: PipelineEvent[] = [];
    const wrapped = wrapPipelineEventHandler((e) => seen.push(e), {
      projectRoot: tmp,
      codeOutputDir: badDir,
    });

    // Should not throw
    expect(() => {
      wrapped(ev({ type: "step_start", stepId: "intent" }));
      wrapped(
        ev({
          type: "step_complete",
          stepId: "intent",
          data: { content: "x" },
        }),
      );
    }).not.toThrow();

    await flush();
    expect(seen.length).toBe(2);
    await fs.chmod(badDir, 0o755); // restore for cleanup
  });

  it("dedups duplicate step_complete for the same (runId, stepId)", async () => {
    const wrapped = wrapPipelineEventHandler(() => {}, {
      projectRoot: tmp,
      codeOutputDir: outputDir,
    });
    wrapped(ev({ type: "step_start", stepId: "prd" }));
    wrapped(
      ev({
        type: "step_complete",
        stepId: "prd",
        data: { costUsd: 0.05, durationMs: 100 },
      }),
    );
    // Engine sometimes re-emits (emitPrdStepCompleteRefresh).
    wrapped(
      ev({
        type: "step_complete",
        stepId: "prd",
        data: { costUsd: 0.05, durationMs: 100 },
      }),
    );
    await flush();
    const store = new FileStore({ layer: "L2", root: outputDir });
    const all = await store.list({ limit: 50 });
    const prdRecords = all.filter((r) => r.refs.taskId === "prd");
    expect(prdRecords.length).toBe(1);
  });

  it("captures tokenUsage.totalTokens into task-history body", async () => {
    const wrapped = wrapPipelineEventHandler(() => {}, {
      projectRoot: tmp,
      codeOutputDir: outputDir,
    });
    wrapped(ev({ type: "step_start", stepId: "prd" }));
    wrapped(
      ev({
        type: "step_complete",
        stepId: "prd",
        data: {
          costUsd: 0,
          durationMs: 5000,
          tokenUsage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
        },
      }),
    );
    await flush();
    const store = new FileStore({ layer: "L2", root: outputDir });
    const all = await store.list({ limit: 50 });
    const prd = all.find((r) => r.refs.taskId === "prd")!;
    const body = JSON.parse(prd.body);
    expect(body.totalTokens).toBe(300);
    expect(body.costUsd).toBe(0);
  });

  it("kickoffIdOverride pins all records to the same session id", async () => {
    const wrapped = wrapPipelineEventHandler(() => {}, {
      projectRoot: tmp,
      codeOutputDir: outputDir,
      kickoffIdOverride: "SES-shared",
    });
    // Engine generates its own runId, but memory should ignore it.
    wrapped({
      type: "step_start",
      runId: "internal-engine-id-1",
      stepId: "intent",
      data: {},
    } as PipelineEvent);
    wrapped({
      type: "step_complete",
      runId: "internal-engine-id-1",
      stepId: "intent",
      data: { content: "x", metadata: { classification: { tier: "S" } } },
    } as PipelineEvent);
    await flush();
    const store = new FileStore({ layer: "L2", root: outputDir });
    const all = await store.list({ limit: 50 });
    const card = all.find((r) => r.kind === "project-card")!;
    const intent = all.find((r) => r.kind === "task-history")!;
    expect(card.id).toBe("PC-SES-shared");
    expect(card.refs.kickoffId).toBe("SES-shared");
    expect(intent.id).toBe("TH-SES-shared-intent");
    expect(intent.refs.kickoffId).toBe("SES-shared");
  });

  it("MEMORY_ENABLED=false bypasses the bridge entirely", async () => {
    const prev = process.env.MEMORY_ENABLED;
    process.env.MEMORY_ENABLED = "false";
    try {
      const seen: PipelineEvent[] = [];
      const wrapped = wrapPipelineEventHandler((e) => seen.push(e), {
        projectRoot: tmp,
        codeOutputDir: outputDir,
      });
      wrapped(ev({ type: "step_start", stepId: "intent" }));
      wrapped(ev({ type: "step_complete", stepId: "intent", data: {} }));
      await flush();
      expect(seen.length).toBe(2);

      // No .memory dir should be created
      const memDir = path.join(outputDir, ".memory");
      const exists = await fs
        .access(memDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.MEMORY_ENABLED;
      else process.env.MEMORY_ENABLED = prev;
    }
  });
});
