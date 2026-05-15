/**
 * Tests for memory citation parsing + recording.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  parseMemoryCites,
  recordMemoryCites,
  stripMemoryCites,
} from "../cite";

describe("parseMemoryCites", () => {
  it("returns [] for empty / missing input", () => {
    expect(parseMemoryCites("")).toEqual([]);
    expect(parseMemoryCites("no cites here")).toEqual([]);
  });

  it("extracts a single comma-separated cite", () => {
    const out = '<memory-cite ids="FP-a,FP-b" />\n<plan>...</plan>';
    expect(parseMemoryCites(out).sort()).toEqual(["FP-a", "FP-b"]);
  });

  it("extracts a single space-separated cite", () => {
    const out = '<memory-cite ids="FP-a FP-b   FP-c" />';
    expect(parseMemoryCites(out).sort()).toEqual(["FP-a", "FP-b", "FP-c"]);
  });

  it("merges multiple cite tags into a deduped union", () => {
    const out = `
      <memory-cite ids="FP-a,FP-b" />
      ...
      <memory-cite ids="FP-b,FP-c" />
    `;
    expect(parseMemoryCites(out).sort()).toEqual(["FP-a", "FP-b", "FP-c"]);
  });

  it("handles self-closing and bracket-closed forms", () => {
    expect(parseMemoryCites('<memory-cite ids="FP-a"/>')).toEqual(["FP-a"]);
    expect(parseMemoryCites('<memory-cite ids="FP-a">')).toEqual(["FP-a"]);
  });

  it("ignores empty ids attribute", () => {
    expect(parseMemoryCites('<memory-cite ids="" />')).toEqual([]);
  });
});

describe("stripMemoryCites", () => {
  it("removes cite tags but leaves the rest of the output intact", () => {
    const out =
      '<memory-cite ids="FP-a" />\n<plan>1. step one</plan>\nrest of code';
    const stripped = stripMemoryCites(out);
    expect(stripped).not.toMatch(/memory-cite/);
    expect(stripped).toMatch(/<plan>1\. step one<\/plan>/);
    expect(stripped).toMatch(/rest of code/);
  });
});

describe("recordMemoryCites", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mem-cite-"));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("logs a cite trace event partitioning valid vs invalid ids", async () => {
    const r = await recordMemoryCites({
      traceRoot: tmp,
      agent: "worker_codegen",
      kickoffId: "k1",
      taskId: "T-1",
      citedIds: ["FP-real", "FP-hallucinated"],
      injectedIds: ["FP-real", "FP-other"],
    });
    expect(r.valid).toEqual(["FP-real"]);
    expect(r.invalid).toEqual(["FP-hallucinated"]);

    const tracePath = path.join(tmp, ".memory", "trace.jsonl");
    const lines = (await fs.readFile(tracePath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0]!);
    expect(event.op).toBe("cite");
    expect(event.details.validIds).toEqual(["FP-real"]);
    expect(event.details.invalidIds).toEqual(["FP-hallucinated"]);
  });

  it("returns an empty result and writes nothing when citedIds is empty", async () => {
    const r = await recordMemoryCites({
      traceRoot: tmp,
      agent: "worker_codegen",
      citedIds: [],
      injectedIds: ["FP-a"],
    });
    expect(r.valid).toEqual([]);
    expect(r.invalid).toEqual([]);
    await expect(
      fs.access(path.join(tmp, ".memory", "trace.jsonl")),
    ).rejects.toThrow();
  });

  it("logs even when ALL cites are invalid (signal worth investigating)", async () => {
    await recordMemoryCites({
      traceRoot: tmp,
      agent: "worker_codegen",
      kickoffId: "k1",
      taskId: "T-1",
      citedIds: ["FP-fake"],
      injectedIds: ["FP-real"],
    });
    const tracePath = path.join(tmp, ".memory", "trace.jsonl");
    const content = await fs.readFile(tracePath, "utf8");
    expect(content).toContain('"op":"cite"');
    expect(content).toContain('"validCount":0');
    expect(content).toContain('"invalidCount":1');
  });
});
