/**
 * Tests for recallAndPrepareInject — the runtime entry point for the
 * three-layer prompt architecture (active / shadow / deprecated).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { recallAndPrepareInject, ACTIVE_THRESHOLD } from "../recall-context";
import { FileStore } from "../file-store";
import { __resetMemoryRegistry } from "../index";
import type { SaveInput } from "../types";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mem-rc-"));
  __resetMemoryRegistry();
  process.env.MEMORY_L1_ROOT = tmp;
  process.env.MEMORY_ENABLED = "true";
  process.env.MEMORY_INJECT = "true";
});

afterEach(async () => {
  delete process.env.MEMORY_L1_ROOT;
  delete process.env.MEMORY_ENABLED;
  delete process.env.MEMORY_INJECT;
  await fs.rm(tmp, { recursive: true, force: true });
});

function fp(over: Partial<SaveInput> = {}): SaveInput {
  return {
    id: "FP-test-1",
    layer: "L1",
    kind: "failure-pattern",
    title: "test pattern",
    body: "## Symptoms\nplaceholder content",
    tags: [],
    source: "manual",
    refs: {},
    metrics: { score: 0 },
    ...over,
  };
}

async function seedL1(records: SaveInput[]) {
  const store = new FileStore({ layer: "L1", root: tmp });
  for (const r of records) await store.save(r);
}

describe("recallAndPrepareInject — score-based layer split", () => {
  it("score >= ACTIVE_THRESHOLD → active (block injected)", async () => {
    await seedL1([
      fp({
        id: "FP-active",
        title: "active pattern",
        body: "## Symptoms\nactive content",
        metrics: { score: 0.5 },
      }),
    ]);
    const r = await recallAndPrepareInject({ agent: "worker_codegen" });
    expect(r.active.map((x) => x.id)).toEqual(["FP-active"]);
    expect(r.shadow).toEqual([]);
    expect(r.block).toContain("memory-context");
    expect(r.block).toContain("active content");
    expect(r.suppressed).toBe(false);
  });

  it("0 <= score < ACTIVE_THRESHOLD → shadow (no block)", async () => {
    await seedL1([
      fp({ id: "FP-shadow", metrics: { score: 0 } }),
    ]);
    const r = await recallAndPrepareInject({ agent: "worker_codegen" });
    expect(r.active).toEqual([]);
    expect(r.shadow.map((x) => x.id)).toEqual(["FP-shadow"]);
    expect(r.block).toBe("");
  });

  it("score < 0 → deprecated, fully ignored", async () => {
    await seedL1([
      fp({ id: "FP-bad", metrics: { score: -0.5 } }),
    ]);
    const r = await recallAndPrepareInject({ agent: "worker_codegen" });
    expect(r.active).toEqual([]);
    expect(r.shadow).toEqual([]);
  });

  it("manual:approved tag bypasses score threshold", async () => {
    await seedL1([
      fp({
        id: "FP-approved",
        tags: ["manual:approved"],
        metrics: { score: 0 },
      }),
    ]);
    const r = await recallAndPrepareInject({ agent: "worker_codegen" });
    expect(r.active.map((x) => x.id)).toEqual(["FP-approved"]);
    expect(r.shadow).toEqual([]);
  });

  it("mixes active + shadow + deprecated correctly", async () => {
    await seedL1([
      fp({ id: "FP-A1", title: "active 1", metrics: { score: 0.5 } }),
      fp({ id: "FP-A2", title: "active 2", metrics: { score: ACTIVE_THRESHOLD } }),
      fp({ id: "FP-S1", title: "shadow 1", metrics: { score: 0.1 } }),
      fp({ id: "FP-S2", title: "shadow 2", metrics: { score: 0.2 } }),
      fp({ id: "FP-D", title: "dropped", metrics: { score: -0.1 } }),
    ]);
    const r = await recallAndPrepareInject({ agent: "worker_codegen" });
    expect(r.active.map((x) => x.id).sort()).toEqual(["FP-A1", "FP-A2"]);
    expect(r.shadow.map((x) => x.id).sort()).toEqual(["FP-S1", "FP-S2"]);
  });
});

describe("recallAndPrepareInject — MEMORY_INJECT flag", () => {
  it("MEMORY_INJECT=false suppresses block; active still listed", async () => {
    process.env.MEMORY_INJECT = "false";
    await seedL1([
      fp({ id: "FP-A", metrics: { score: 0.5 } }),
    ]);
    const r = await recallAndPrepareInject({ agent: "worker_codegen" });
    expect(r.active.map((x) => x.id)).toEqual(["FP-A"]);
    expect(r.block).toBe("");
    expect(r.suppressed).toBe(true);
  });

  it("MEMORY_ENABLED=false → empty result + no I/O", async () => {
    process.env.MEMORY_ENABLED = "false";
    await seedL1([
      fp({ id: "FP-A", metrics: { score: 0.5 } }),
    ]);
    const r = await recallAndPrepareInject({ agent: "worker_codegen" });
    expect(r.active).toEqual([]);
    expect(r.shadow).toEqual([]);
    expect(r.block).toBe("");
  });
});

describe("recallAndPrepareInject — token budget", () => {
  it("respects tokenBudget when many active records exist", async () => {
    const big = "x".repeat(2000);
    await seedL1([
      fp({ id: "FP-1", body: big, metrics: { score: 0.5 } }),
      fp({ id: "FP-2", body: big, metrics: { score: 0.5 } }),
      fp({ id: "FP-3", body: big, metrics: { score: 0.5 } }),
    ]);
    const r = await recallAndPrepareInject({
      agent: "worker_codegen",
      tokenBudget: 200,
    });
    expect(r.active.length).toBe(3);
    // Block always contains at least one record (per renderer policy:
    // never empty when there are candidates) but is capped well below
    // the sum of all bodies. Three 2000-char bodies = 6000 chars; the
    // budget should hold us to roughly one record's worth.
    expect(r.block.length).toBeGreaterThan(0);
    expect(r.block.length).toBeLessThan(4000);
  });
});

describe("recallAndPrepareInject — query construction", () => {
  it("text from task title prioritises matching patterns", async () => {
    await seedL1([
      fp({
        id: "FP-prisma",
        title: "Prisma migration",
        body: "## Symptoms\nprisma migration conflict",
        metrics: { score: 0.5 },
      }),
      fp({
        id: "FP-other",
        title: "unrelated",
        body: "## Symptoms\nnothing about prisma here",
        metrics: { score: 0.5 },
      }),
    ]);
    const r = await recallAndPrepareInject({
      agent: "worker_codegen",
      // Use a title that's a literal substring of the prisma pattern body
      // so the current substring-match ranking has a clean signal.
      // (Term-level / embedding ranking is Phase D.)
      task: { id: "T-1", title: "prisma migration conflict" },
    });
    // Both active; the prisma-matching record should rank first.
    expect(r.active[0]?.id).toBe("FP-prisma");
  });

  it("file extensions in task become any-tag filters", async () => {
    await seedL1([
      fp({
        id: "FP-tsx",
        tags: ["ext:tsx"],
        metrics: { score: 0.5 },
      }),
      fp({
        id: "FP-prisma",
        tags: ["ext:prisma"],
        metrics: { score: 0.5 },
      }),
    ]);
    const r = await recallAndPrepareInject({
      agent: "worker_codegen",
      task: { id: "T-1", files: ["src/Page.tsx", "src/api.ts"] },
    });
    expect(r.active.map((x) => x.id)).toContain("FP-tsx");
    expect(r.active.map((x) => x.id)).not.toContain("FP-prisma");
  });
});

describe("recallAndPrepareInject — hits accounting", () => {
  it("bumps hits on active records when injection happens", async () => {
    await seedL1([
      fp({ id: "FP-A", metrics: { score: 0.5 } }),
    ]);
    await recallAndPrepareInject({ agent: "worker_codegen" });
    const store = new FileStore({ layer: "L1", root: tmp });
    const r = await store.get("FP-A");
    expect(r?.metrics.hits).toBe(1);
  });

  it("does NOT bump hits when MEMORY_INJECT=false (only candidate)", async () => {
    process.env.MEMORY_INJECT = "false";
    await seedL1([
      fp({ id: "FP-A", metrics: { score: 0.5 } }),
    ]);
    await recallAndPrepareInject({ agent: "worker_codegen" });
    const store = new FileStore({ layer: "L1", root: tmp });
    const r = await store.get("FP-A");
    expect(r?.metrics.hits ?? 0).toBe(0);
  });
});
