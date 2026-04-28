/**
 * Tests for `memory approve` / `memory disapprove` CLI commands.
 *
 * Approve = adds `manual:approved` tag + bumps score (default 0.5) so the
 * pattern enters Layer 2 active without waiting for outcome attribution.
 * Disapprove = removes the tag + resets score to 0 (back to shadow).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { cmdApprove, cmdDisapprove, parseArgs } from "../cli";
import { FileStore } from "../file-store";
import { __resetMemoryRegistry } from "../index";
import type { SaveInput } from "../types";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mem-ap-"));
  __resetMemoryRegistry();
  process.env.MEMORY_L1_ROOT = tmp;
  process.env.MEMORY_ENABLED = "true";
});

afterEach(async () => {
  delete process.env.MEMORY_L1_ROOT;
  delete process.env.MEMORY_ENABLED;
  await fs.rm(tmp, { recursive: true, force: true });
});

async function seed(input: Partial<SaveInput> = {}): Promise<string> {
  const store = new FileStore({ layer: "L1", root: tmp });
  const r = await store.save({
    id: input.id ?? "FP-test",
    layer: "L1",
    kind: "failure-pattern",
    title: input.title ?? "test pattern",
    body: input.body ?? "## Symptoms\nplaceholder",
    tags: input.tags ?? ["mined"],
    source: input.source ?? "distill",
    refs: {},
    metrics: input.metrics ?? { score: 0 },
  });
  return r.id;
}

describe("memory approve", () => {
  it("adds manual:approved tag + sets score to 0.5 by default", async () => {
    const id = await seed();
    await cmdApprove(parseArgs(["approve", id]));

    const store = new FileStore({ layer: "L1", root: tmp });
    const r = await store.get(id);
    expect(r?.tags).toContain("manual:approved");
    expect(r?.metrics.score).toBe(0.5);
  });

  it("respects custom --score", async () => {
    const id = await seed();
    await cmdApprove(parseArgs(["approve", id, "--score=0.9"]));

    const store = new FileStore({ layer: "L1", root: tmp });
    const r = await store.get(id);
    expect(r?.metrics.score).toBe(0.9);
  });

  it("preserves existing tags", async () => {
    const id = await seed({ tags: ["mined", "stage:coverage-gate"] });
    await cmdApprove(parseArgs(["approve", id]));

    const store = new FileStore({ layer: "L1", root: tmp });
    const r = await store.get(id);
    expect(r?.tags).toEqual(
      expect.arrayContaining(["mined", "stage:coverage-gate", "manual:approved"]),
    );
  });

  it("is idempotent — second approve does not duplicate the tag", async () => {
    const id = await seed();
    await cmdApprove(parseArgs(["approve", id]));
    await cmdApprove(parseArgs(["approve", id]));

    const store = new FileStore({ layer: "L1", root: tmp });
    const r = await store.get(id);
    const approvedTags = r?.tags.filter((t) => t === "manual:approved") ?? [];
    expect(approvedTags.length).toBe(1);
  });

  it("sets exitCode=1 when id missing", async () => {
    process.exitCode = 0;
    await cmdApprove(parseArgs(["approve", "nope-not-here"]));
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe("memory disapprove", () => {
  it("removes manual:approved tag + resets score to 0", async () => {
    const id = await seed({
      tags: ["mined", "manual:approved"],
      metrics: { score: 0.5 },
    });
    await cmdDisapprove(parseArgs(["disapprove", id]));

    const store = new FileStore({ layer: "L1", root: tmp });
    const r = await store.get(id);
    expect(r?.tags).not.toContain("manual:approved");
    expect(r?.tags).toContain("mined");
    expect(r?.metrics.score).toBe(0);
  });

  it("respects custom --score for partial demotion", async () => {
    const id = await seed({
      tags: ["manual:approved"],
      metrics: { score: 0.5 },
    });
    await cmdDisapprove(parseArgs(["disapprove", id, "--score=-0.3"]));

    const store = new FileStore({ layer: "L1", root: tmp });
    const r = await store.get(id);
    expect(r?.metrics.score).toBe(-0.3);
  });

  it("is safe on a non-approved record", async () => {
    const id = await seed({ tags: ["mined"] });
    await cmdDisapprove(parseArgs(["disapprove", id]));

    const store = new FileStore({ layer: "L1", root: tmp });
    const r = await store.get(id);
    expect(r?.tags).toEqual(["mined"]);
  });
});

describe("approve / disapprove round-trip", () => {
  it("approve → disapprove returns to original state", async () => {
    const id = await seed({
      tags: ["mined", "stage:foo"],
      metrics: { score: 0 },
    });
    await cmdApprove(parseArgs(["approve", id]));
    await cmdDisapprove(parseArgs(["disapprove", id]));

    const store = new FileStore({ layer: "L1", root: tmp });
    const r = await store.get(id);
    expect(r?.tags).toEqual(expect.arrayContaining(["mined", "stage:foo"]));
    expect(r?.tags).not.toContain("manual:approved");
    expect(r?.metrics.score).toBe(0);
  });
});
