/**
 * Tests for AttemptTracker — the cross-stage repair counter that powers
 * the 3-strike circuit breaker.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  AttemptTracker,
  missingIdsScopeKey,
  type AttemptScope,
} from "../attempt-tracker";

async function mkTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "attempt-tracker-"));
}

async function rmDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

const activeTrackers: AttemptTracker[] = [];
function trackedTracker(opts: ConstructorParameters<typeof AttemptTracker>[0]): AttemptTracker {
  const t = new AttemptTracker(opts);
  activeTrackers.push(t);
  return t;
}
async function flushAllTrackers(): Promise<void> {
  await Promise.all(activeTrackers.map((t) => t.flush()));
  activeTrackers.length = 0;
}

const phaseScope: AttemptScope = {
  stage: "phase-gate",
  scopeKey: "backend",
};
const coverageScope: AttemptScope = {
  stage: "coverage-gate",
  scopeKey: "AC-001,AC-002",
};

describe("AttemptTracker — counting", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkTempDir();
  });
  afterEach(async () => {
    await flushAllTrackers();
    await rmDir(dir);
  });

  it("noteStart returns 1, 2, 3 for the same scope", async () => {
    const t = trackedTracker({ outputDir: dir });
    expect(await t.noteStart(phaseScope)).toBe(1);
    expect(await t.noteStart(phaseScope)).toBe(2);
    expect(await t.noteStart(phaseScope)).toBe(3);
  });

  it("tracks independent counters for different scopes", async () => {
    const t = trackedTracker({ outputDir: dir });
    await t.noteStart(phaseScope);
    await t.noteStart(phaseScope);
    expect(await t.noteStart(coverageScope)).toBe(1);
    expect(t.getRecord(phaseScope)?.attempts).toBe(2);
    expect(t.getRecord(coverageScope)?.attempts).toBe(1);
  });

  it("distinguishes scopes that share scopeKey but differ in stage", async () => {
    const t = trackedTracker({ outputDir: dir });
    const a: AttemptScope = { stage: "phase-gate", scopeKey: "x" };
    const b: AttemptScope = { stage: "coverage-gate", scopeKey: "x" };
    await t.noteStart(a);
    await t.noteStart(a);
    await t.noteStart(b);
    expect(t.getRecord(a)?.attempts).toBe(2);
    expect(t.getRecord(b)?.attempts).toBe(1);
  });
});

describe("AttemptTracker — circuit breaker", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkTempDir();
  });
  afterEach(async () => {
    await flushAllTrackers();
    await rmDir(dir);
  });

  it("isCircuitOpen is false before threshold", async () => {
    const t = trackedTracker({ outputDir: dir });
    await t.noteStart(phaseScope);
    expect(t.isCircuitOpen(phaseScope)).toBe(false);
    await t.noteStart(phaseScope);
    expect(t.isCircuitOpen(phaseScope)).toBe(false);
  });

  it("isCircuitOpen flips to true at the 3rd attempt (default threshold)", async () => {
    const t = trackedTracker({ outputDir: dir });
    await t.noteStart(phaseScope);
    await t.noteStart(phaseScope);
    await t.noteStart(phaseScope);
    expect(t.isCircuitOpen(phaseScope)).toBe(true);
  });

  it("respects custom threshold from constructor", async () => {
    const t = trackedTracker({ outputDir: dir, threshold: 5 });
    for (let i = 0; i < 4; i++) await t.noteStart(phaseScope);
    expect(t.isCircuitOpen(phaseScope)).toBe(false);
    await t.noteStart(phaseScope);
    expect(t.isCircuitOpen(phaseScope)).toBe(true);
  });

  it("respects per-call threshold override", async () => {
    const t = trackedTracker({ outputDir: dir });
    await t.noteStart(phaseScope);
    await t.noteStart(phaseScope);
    expect(t.isCircuitOpen(phaseScope, 2)).toBe(true);
    expect(t.isCircuitOpen(phaseScope, 5)).toBe(false);
  });

  it("returns false for scopes never observed", () => {
    const t = trackedTracker({ outputDir: dir });
    expect(t.isCircuitOpen(phaseScope)).toBe(false);
  });
});

describe("AttemptTracker — outcome + reset semantics", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkTempDir();
  });
  afterEach(async () => {
    await flushAllTrackers();
    await rmDir(dir);
  });

  it("noteOutcome('repaired', [ids]) resets the counter", async () => {
    const t = trackedTracker({ outputDir: dir });
    await t.noteStart(phaseScope);
    await t.noteStart(phaseScope);
    await t.noteOutcome(phaseScope, "repaired", ["AC-001"]);
    expect(t.getRecord(phaseScope)).toBeUndefined();
    expect(t.isCircuitOpen(phaseScope)).toBe(false);
    expect(await t.noteStart(phaseScope)).toBe(1);
  });

  it("noteOutcome('repaired') with empty ids does NOT reset", async () => {
    const t = trackedTracker({ outputDir: dir });
    await t.noteStart(phaseScope);
    await t.noteStart(phaseScope);
    await t.noteOutcome(phaseScope, "repaired", []);
    expect(t.getRecord(phaseScope)?.attempts).toBe(2);
  });

  it("noteOutcome('still_missing') keeps the counter and updates history", async () => {
    const t = trackedTracker({ outputDir: dir });
    await t.noteStart(phaseScope);
    await t.noteOutcome(phaseScope, "still_missing");
    const rec = t.getRecord(phaseScope);
    expect(rec?.attempts).toBe(1);
    expect(rec?.lastOutcome).toBe("still_missing");
    expect(rec?.history.at(-1)?.outcome).toBe("still_missing");
  });

  it("explicit reset() clears the scope", async () => {
    const t = trackedTracker({ outputDir: dir });
    await t.noteStart(phaseScope);
    await t.noteStart(phaseScope);
    t.reset(phaseScope);
    expect(t.getRecord(phaseScope)).toBeUndefined();
  });

  it("history is capped at historyLimit", async () => {
    const t = trackedTracker({ outputDir: dir, historyLimit: 3 });
    for (let i = 0; i < 6; i++) await t.noteStart(phaseScope);
    const rec = t.getRecord(phaseScope);
    expect(rec?.attempts).toBe(6);
    expect(rec?.history.length).toBe(3);
  });
});

describe("AttemptTracker — persistence", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkTempDir();
  });
  afterEach(async () => {
    await flushAllTrackers();
    await rmDir(dir);
  });

  it("survives a load() roundtrip", async () => {
    const a = trackedTracker({ outputDir: dir });
    await a.noteStart(phaseScope);
    await a.noteStart(phaseScope);
    await a.flush();

    const b = trackedTracker({ outputDir: dir });
    await b.load();
    expect(b.getRecord(phaseScope)?.attempts).toBe(2);
    expect(b.isCircuitOpen(phaseScope, 2)).toBe(true);
  });

  it("writes to .ralph/repair-attempts.json by default", async () => {
    const t = trackedTracker({ outputDir: dir });
    await t.noteStart(phaseScope);
    await t.flush();
    const raw = await fs.readFile(
      path.join(dir, ".ralph/repair-attempts.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    expect(parsed["phase-gate:backend"].attempts).toBe(1);
  });

  it("first load on a fresh directory does not throw (ENOENT)", async () => {
    const t = trackedTracker({ outputDir: dir });
    await expect(t.load()).resolves.toBeUndefined();
    expect(t.isCircuitOpen(phaseScope)).toBe(false);
  });

  it("corrupted persistence file starts fresh without throwing", async () => {
    await fs.mkdir(path.join(dir, ".ralph"), { recursive: true });
    await fs.writeFile(
      path.join(dir, ".ralph/repair-attempts.json"),
      "{not json",
      "utf-8",
    );
    const t = trackedTracker({ outputDir: dir });
    await expect(t.load()).resolves.toBeUndefined();
    expect(await t.noteStart(phaseScope)).toBe(1);
  });

  it("ignores malformed record entries in the file", async () => {
    await fs.mkdir(path.join(dir, ".ralph"), { recursive: true });
    await fs.writeFile(
      path.join(dir, ".ralph/repair-attempts.json"),
      JSON.stringify({
        "phase-gate:backend": { attempts: 2, history: [], firstAttemptAt: "x", lastAttemptAt: "y", lastOutcome: "in_progress" },
        "bogus:entry": { not: "valid" },
      }),
      "utf-8",
    );
    const t = trackedTracker({ outputDir: dir });
    await t.load();
    expect(t.getRecord(phaseScope)?.attempts).toBe(2);
    expect(t.getRecord({ stage: "phase-gate", scopeKey: "entry" })).toBeUndefined();
  });
});

describe("missingIdsScopeKey", () => {
  it("normalises order — same ids in different order produce same key", () => {
    expect(missingIdsScopeKey(["AC-002", "AC-001"])).toBe(
      missingIdsScopeKey(["AC-001", "AC-002"]),
    );
  });

  it("uppercases ids", () => {
    expect(missingIdsScopeKey(["ac-001"])).toBe("AC-001");
  });

  it("returns empty string for empty input", () => {
    expect(missingIdsScopeKey([])).toBe("");
  });
});
