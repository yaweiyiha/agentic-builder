import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FileStore } from "../file-store";
import type { SaveInput } from "../types";

let tmp: string;
let store: FileStore;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mem-test-"));
  store = new FileStore({ layer: "L2", root: tmp });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function thInput(over: Partial<SaveInput> = {}): SaveInput {
  return {
    id: "",
    layer: "L2",
    kind: "task-history",
    title: "Add JWT auth",
    body: JSON.stringify({
      status: "completed",
      attempts: 1,
      files: ["src/auth.ts"],
    }),
    tags: ["taskType:auth", "agent:codegen"],
    source: "orchestrator",
    refs: { kickoffId: "K-1", taskId: "T-1" },
    ...over,
  };
}

describe("FileStore CRUD", () => {
  it("saves and reads a record", async () => {
    const saved = await store.save(thInput());
    expect(saved.id).toMatch(/^TH-/);
    expect(saved.createdAt).toBeGreaterThan(0);

    const got = await store.get(saved.id);
    expect(got).toEqual(saved);
  });

  it("rejects records from the wrong layer", async () => {
    await expect(store.save(thInput({ layer: "L1" }))).rejects.toThrow(/refused/);
  });

  it("rejects body that fails schema", async () => {
    await expect(
      store.save(thInput({ body: JSON.stringify({ status: "bogus" }) })),
    ).rejects.toThrow(/schema/i);
  });

  it("update preserves createdAt + hits", async () => {
    const a = await store.save(thInput());
    await store.bumpHit(a.id);
    const b = await store.update(a.id, { tags: ["x"] });
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.metrics.hits).toBe(1);
    expect(b.tags).toEqual(["x"]);
  });

  it("delete removes record + record file", async () => {
    const a = await store.save(thInput());
    await store.delete(a.id);
    expect(await store.get(a.id)).toBeNull();
    const dir = path.join(tmp, ".memory", "records", "task-history");
    const list = await fs.readdir(dir).catch(() => []);
    expect(list.find((f) => f.startsWith(a.id))).toBeUndefined();
  });

  it("idempotent save on same id updates in place", async () => {
    const a = await store.save(thInput({ id: "TH-FIXED" }));
    const b = await store.save(thInput({ id: "TH-FIXED", title: "renamed" }));
    expect(b.id).toBe("TH-FIXED");
    expect(b.title).toBe("renamed");
    expect(b.createdAt).toBe(a.createdAt);
    const all = await store.list();
    expect(all.length).toBe(1);
  });
});

describe("FileStore.recall", () => {
  beforeEach(async () => {
    await store.save(
      thInput({
        id: "TH-A",
        title: "auth task",
        tags: ["taskType:auth", "stack:prisma"],
      }),
    );
    await store.save(
      thInput({
        id: "TH-B",
        title: "ui task",
        tags: ["taskType:ui", "stack:react"],
      }),
    );
    await store.save(
      thInput({
        id: "TH-C",
        title: "auth refresh",
        tags: ["taskType:auth", "stack:react"],
      }),
    );
  });

  it("filters by tags.all", async () => {
    const rs = await store.recall({ tags: { all: ["taskType:auth"] } });
    const ids = rs.map((r) => r.id).sort();
    expect(ids).toEqual(["TH-A", "TH-C"]);
  });

  it("filters by tags.any", async () => {
    const rs = await store.recall({ tags: { any: ["stack:prisma", "stack:react"] } });
    expect(rs.length).toBe(3);
  });

  it("excludes via tags.none", async () => {
    const rs = await store.recall({
      tags: { all: ["taskType:auth"], none: ["stack:prisma"] },
    });
    expect(rs.map((r) => r.id)).toEqual(["TH-C"]);
  });

  it("respects kinds filter", async () => {
    const rs = await store.recall({ kinds: ["failure-pattern"] });
    expect(rs.length).toBe(0);
  });

  it("text search ranks matching records first", async () => {
    const rs = await store.recall({ text: "refresh", limit: 3 });
    expect(rs[0]?.id).toBe("TH-C");
  });

  it("limit caps results", async () => {
    const rs = await store.recall({ tags: { any: ["taskType:auth", "taskType:ui"] }, limit: 2 });
    expect(rs.length).toBe(2);
  });
});

describe("FileStore concurrency", () => {
  it("survives 20 concurrent saves with no loss", async () => {
    const inputs = Array.from({ length: 20 }, (_, i) =>
      thInput({ id: `TH-X-${i}`, title: `t-${i}` }),
    );
    await Promise.all(inputs.map((x) => store.save(x)));
    const all = await store.list({ limit: 100 });
    expect(all.length).toBe(20);
    const ids = new Set(all.map((r) => r.id));
    expect(ids.size).toBe(20);
  });
});

describe("per-record file format + fresh-clone recovery", () => {
  it("writes one file per record under records/<kind>/<id>.<ext>", async () => {
    await store.save(thInput({ id: "TH-A" })); // json
    await store.save({
      id: "PC-A",
      layer: "L2",
      kind: "project-card",
      title: "card",
      body: "# Project Card\n\nbrief here",
      tags: ["t"],
      source: "orchestrator",
      refs: { kickoffId: "K1" },
    }); // markdown

    const thPath = path.join(tmp, ".memory", "records", "task-history", "TH-A.json");
    const pcPath = path.join(tmp, ".memory", "records", "project-card", "PC-A.md");
    const thRaw = await fs.readFile(thPath, "utf8");
    const pcRaw = await fs.readFile(pcPath, "utf8");

    // task-history is a JSON envelope with body as object
    const thParsed = JSON.parse(thRaw);
    expect(thParsed.id).toBe("TH-A");
    expect(thParsed.kind).toBe("task-history");
    expect(thParsed.body.status).toBe("completed");
    expect(thParsed.metrics).toBeUndefined(); // metrics not in body file

    // project-card markdown has JSON-in-frontmatter and clean body below
    expect(pcRaw.startsWith("---\n")).toBe(true);
    expect(pcRaw).toContain("# Project Card");
    const fmMatch = pcRaw.match(/^---\n([\s\S]*?)\n---/);
    const fm = JSON.parse(fmMatch![1]!);
    expect(fm.id).toBe("PC-A");
    expect(fm.kind).toBe("project-card");
    expect(fm.metrics).toBeUndefined();
  });

  it("a fresh FileStore reads back records from disk (clone-survival)", async () => {
    await store.save(thInput({ id: "TH-X", title: "from-disk" }));
    await store.save({
      id: "PC-X",
      layer: "L2",
      kind: "project-card",
      title: "card",
      body: "# Project Card\n\nfrom-disk body",
      tags: ["t"],
      source: "orchestrator",
      refs: {},
    });

    // Simulate a fresh process by constructing a new FileStore on the
    // same directory.
    const fresh = new FileStore({ layer: "L2", root: tmp });
    const all = await fresh.list({ limit: 100 });
    expect(all.length).toBe(2);

    const th = await fresh.get("TH-X");
    expect(th?.title).toBe("from-disk");
    expect(JSON.parse(th!.body).status).toBe("completed");

    const pc = await fresh.get("PC-X");
    expect(pc?.body).toContain("from-disk body");
    // body should NOT include frontmatter
    expect(pc?.body.startsWith("---")).toBe(false);
  });

  it("metrics live in metrics.json (not in record files); survives reload", async () => {
    const a = await store.save(thInput());
    await store.bumpHit(a.id);
    await store.bumpHit(a.id);

    // metrics.json exists and contains the hits
    const metricsPath = path.join(tmp, ".memory", "metrics.json");
    const metrics = JSON.parse(await fs.readFile(metricsPath, "utf8"));
    expect(metrics[a.id].hits).toBe(2);

    // record file does NOT contain metrics
    const recordPath = path.join(tmp, ".memory", "records", "task-history", `${a.id}.json`);
    const rec = JSON.parse(await fs.readFile(recordPath, "utf8"));
    expect(rec.metrics).toBeUndefined();

    // Fresh FileStore picks up metrics from metrics.json
    const fresh = new FileStore({ layer: "L2", root: tmp });
    const r = await fresh.get(a.id);
    expect(r?.metrics.hits).toBe(2);
  });

  it("missing metrics.json starts hits fresh without losing records", async () => {
    const a = await store.save(thInput());
    await store.bumpHit(a.id);
    await fs.rm(path.join(tmp, ".memory", "metrics.json"), { force: true });

    const fresh = new FileStore({ layer: "L2", root: tmp });
    const r = await fresh.get(a.id);
    expect(r).toBeTruthy();
    expect(r!.title).toBe("Add JWT auth");
    // hits reset to 0 (or undefined-ish), record itself preserved
    expect(r!.metrics.hits ?? 0).toBe(0);
  });
});

describe("FileStore.bumpHit + setScore", () => {
  it("bumpHit increments + records lastHitAt", async () => {
    const a = await store.save(thInput());
    await store.bumpHit(a.id);
    await store.bumpHit(a.id);
    const r = await store.get(a.id);
    expect(r?.metrics.hits).toBe(2);
    expect(r?.metrics.lastHitAt).toBeGreaterThan(0);
  });

  it("setScore validates range", async () => {
    const a = await store.save(thInput());
    await expect(store.setScore(a.id, 1.5)).rejects.toThrow();
    await store.setScore(a.id, -0.5);
    const r = await store.get(a.id);
    expect(r?.metrics.score).toBe(-0.5);
  });

  it("negative score depresses recall ranking", async () => {
    const good = await store.save(thInput({ id: "TH-G", title: "good", tags: ["x"] }));
    const bad = await store.save(thInput({ id: "TH-B", title: "bad", tags: ["x"] }));
    await store.setScore(bad.id, -1);
    const rs = await store.recall({ tags: { all: ["x"] }, limit: 2 });
    expect(rs[0]?.id).toBe(good.id);
  });
});
