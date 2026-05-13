/**
 * End-to-end smoke for the preparation-phase memory loop.
 *
 * Exercises the FULL chain in a tmp L1 root:
 *
 *   1. POST /api/memory/prd/capture        (positive — no edits)
 *      → assert prd-pattern record on disk
 *      → assert prep-outcome event in trace.jsonl
 *
 *   2. simulate an inject trace event for that sessionId          (the
 *      pipeline normally writes this in engine.ts during PRD generation;
 *      we synthesise one here so attribution has something to credit)
 *
 *   3. POST /api/memory/attribute/preparation
 *      → assert the injected pattern's score was bumped by +deltaApproval
 *      → assert the cursor file blocks a second run from re-attributing
 *
 *   4. POST /api/memory/prd/capture again with `human_edit`
 *      → simulate fresh inject
 *      → run attribution again
 *      → assert score delta = deltaEdit
 *
 * This catches whole-pipeline regressions (e.g. wrong agent name in
 * trace event, wrong cursor key shape, score not actually persisted)
 * that no unit test would surface.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Mock the diff-summary LLM — we don't need it for the trace flow and
// we don't want a network call from a unit suite.
vi.mock("@/lib/openrouter", () => ({
  chatCompletion: vi.fn(async () => ({
    choices: [
      {
        message: {
          content:
            "### Title\nMock summary\n\n### Pattern\nMock guidance text.",
        },
      },
    ],
    model: "mock-model",
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  })),
  resolveModel: vi.fn(() => "mock-model"),
  estimateCost: vi.fn(() => 0),
}));

// Reset memory singletons between tests so each tmp dir is honoured.
import { __resetMemoryRegistry, getSystemMemory } from "../index";
import { getTraceLogger } from "../trace";
import {
  DEFAULT_DELTA_APPROVAL,
  DEFAULT_DELTA_EDIT,
} from "../distill/preparation-attribution";

let tmp: string;
let originalCwd: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mem-prep-e2e-"));
  originalCwd = process.cwd();
  process.chdir(tmp);
  process.env.MEMORY_L1_ROOT = tmp;
  process.env.MEMORY_ENABLED = "true";
  __resetMemoryRegistry();
  // Trace logger is module-cached by dir; clear it the same way recall
  // tests do — by importing a fresh module after resetting registry isn't
  // available, so we rely on per-test tmp dir + the trace logger's
  // internal Map being keyed by absolute path (different each test).
});

afterEach(async () => {
  process.chdir(originalCwd);
  delete process.env.MEMORY_L1_ROOT;
  await fs.rm(tmp, { recursive: true, force: true });
});

async function jsonRequest(body: unknown): Promise<Request> {
  return new Request("http://test.local/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readTrace(): Promise<Array<Record<string, unknown>>> {
  const p = path.join(tmp, ".memory", "trace.jsonl");
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("preparation memory loop · end-to-end", () => {
  it("capture → trace → attribute → score updated (positive path)", async () => {
    // Dynamic-import handlers AFTER env vars are set so module-level
    // singletons (memory store, trace logger) bind to the tmp root.
    const { POST: captureHandler } = await import(
      "@/app/api/memory/prd/capture/route"
    );
    const { POST: attributeHandler } = await import(
      "@/app/api/memory/attribute/preparation/route"
    );

    const sessionId = "S-e2e-positive";
    const prd = "x".repeat(500); // > MIN_PRD_CHARS

    // ── 1. capture (positive — original === final means no edits) ─────
    const res = await captureHandler(
      await jsonRequest({
        sessionId,
        tier: "S",
        projectType: "calculator",
        originalPrd: prd,
        finalPrd: prd,
      }),
    );
    const captured = (await res.json()) as {
      ok: boolean;
      recordId: string;
      outcome: string;
    };
    expect(captured.ok).toBe(true);
    expect(captured.outcome).toBe("positive");
    expect(captured.recordId).toMatch(/^PRD-/);

    // ── 2. assert record on disk ──────────────────────────────────────
    const recordPath = path.join(
      tmp,
      ".memory/records/prd-pattern",
      `${captured.recordId}.md`,
    );
    await expect(fs.access(recordPath)).resolves.toBeUndefined();

    // ── 3. assert prep-outcome event in trace ─────────────────────────
    const trace = await readTrace();
    const outcomeEvt = trace.find(
      (e) =>
        e.op === "prep-outcome" &&
        e.kickoffId === sessionId &&
        (e.details as { phase?: string })?.phase === "prd",
    );
    expect(outcomeEvt).toBeDefined();
    expect((outcomeEvt!.details as { source: string }).source).toBe(
      "human_approval",
    );

    // ── 4. simulate inject event so attribution has a credit target ──
    //   In real pipeline runs, engine.ts emits this during PRD generation
    //   for an *earlier* session. Here we create a separate pattern that
    //   was "injected" into THIS session, then assert it gets credited.
    const sysMem = getSystemMemory();
    const injected = await sysMem.save({
      layer: "L1",
      kind: "prd-pattern",
      title: "Pre-existing pattern injected into this session",
      body: "Reusable PRD guidance.",
      tags: ["tier:S"],
      source: "orchestrator",
      refs: {},
      metrics: { score: 0.4 },
    });
    await getTraceLogger(tmp).log({
      op: "inject",
      layer: "L1",
      kickoffId: sessionId,
      agent: "pm",
      details: { injected: true, activeIds: [injected.id] },
    });

    // ── 5. run attribution ────────────────────────────────────────────
    const attrRes = await attributeHandler(
      (await jsonRequest({ l1Root: tmp })) as never,
    );
    const attrBody = (await attrRes.json()) as {
      ok: boolean;
      applied: number;
      attributions: Array<{ patternId: string; delta: number; approvals: number }>;
      stats: { newlyAttributedPairs: number };
    };
    expect(attrBody.ok).toBe(true);
    const a = attrBody.attributions.find((x) => x.patternId === injected.id);
    expect(a).toBeDefined();
    expect(a!.approvals).toBe(1);
    expect(a!.delta).toBeCloseTo(DEFAULT_DELTA_APPROVAL, 5);
    expect(attrBody.applied).toBeGreaterThanOrEqual(1);
    expect(attrBody.stats.newlyAttributedPairs).toBe(1);

    // ── 6. assert score actually persisted ────────────────────────────
    const reread = await sysMem.get(injected.id);
    expect(reread?.metrics.score).toBeCloseTo(0.4 + DEFAULT_DELTA_APPROVAL, 5);

    // ── 7. cursor blocks duplicate attribution on second run ─────────
    const attrRes2 = await attributeHandler(
      (await jsonRequest({ l1Root: tmp })) as never,
    );
    const attrBody2 = (await attrRes2.json()) as {
      applied: number;
      stats: { newlyAttributedPairs: number; outcomeEventsSkippedAlreadyAttributed: number };
    };
    expect(attrBody2.stats.newlyAttributedPairs).toBe(0);
    expect(attrBody2.stats.outcomeEventsSkippedAlreadyAttributed).toBe(1);
    expect(attrBody2.applied).toBe(0);

    // Score unchanged after no-op second run.
    const reread2 = await sysMem.get(injected.id);
    expect(reread2?.metrics.score).toBeCloseTo(0.4 + DEFAULT_DELTA_APPROVAL, 5);
  });

  it("capture → trace → attribute → score reduced (negative path)", async () => {
    const { POST: captureHandler } = await import(
      "@/app/api/memory/prd/capture/route"
    );
    const { POST: attributeHandler } = await import(
      "@/app/api/memory/attribute/preparation/route"
    );

    const sessionId = "S-e2e-negative";
    const original = "x".repeat(500);
    const final = "y".repeat(800); // 60% length delta → significant edit

    // Pre-inject a pattern so attribution has a target.
    const sysMem = getSystemMemory();
    const injected = await sysMem.save({
      layer: "L1",
      kind: "prd-pattern",
      title: "Pattern that will get blamed",
      body: "Some guidance.",
      tags: ["tier:M"],
      source: "orchestrator",
      refs: {},
      metrics: { score: 0.5 },
    });
    await getTraceLogger(tmp).log({
      op: "inject",
      layer: "L1",
      kickoffId: sessionId,
      agent: "pm",
      details: { injected: true, activeIds: [injected.id] },
    });

    // capture with significant edit
    const res = await captureHandler(
      await jsonRequest({
        sessionId,
        tier: "M",
        projectType: "dashboard",
        originalPrd: original,
        finalPrd: final,
      }),
    );
    const captured = (await res.json()) as { outcome: string };
    expect(captured.outcome).toBe("negative");

    // attribute
    const attrRes = await attributeHandler(
      (await jsonRequest({ l1Root: tmp })) as never,
    );
    const attrBody = (await attrRes.json()) as {
      attributions: Array<{ patternId: string; delta: number; edits: number }>;
    };
    const a = attrBody.attributions.find((x) => x.patternId === injected.id);
    expect(a).toBeDefined();
    expect(a!.edits).toBe(1);
    expect(a!.delta).toBeCloseTo(DEFAULT_DELTA_EDIT, 5);

    const reread = await sysMem.get(injected.id);
    expect(reread?.metrics.score).toBeCloseTo(0.5 + DEFAULT_DELTA_EDIT, 5);
  });

  it("design capture writes design-pattern + prep-outcome with agent='design'", async () => {
    const { POST: captureHandler } = await import(
      "@/app/api/memory/design/capture/route"
    );

    const sessionId = "S-e2e-design";
    const design =
      "<!doctype html><html><head><title>Design</title></head>" +
      `<body>${"x".repeat(700)}</body></html>`;

    const res = await captureHandler(
      await jsonRequest({
        sessionId,
        tier: "S",
        projectType: "dashboard",
        originalDesign: design,
        finalDesign: design,
      }),
    );
    const captured = (await res.json()) as {
      ok: boolean;
      recordId: string;
      outcome: string;
    };
    expect(captured.ok).toBe(true);
    expect(captured.recordId).toMatch(/^DSG-/);
    expect(captured.outcome).toBe("positive");

    const trace = await readTrace();
    const evt = trace.find(
      (e) =>
        e.op === "prep-outcome" &&
        e.kickoffId === sessionId &&
        e.agent === "design",
    );
    expect(evt).toBeDefined();
    expect((evt!.details as { phase: string }).phase).toBe("design");
  });
});
