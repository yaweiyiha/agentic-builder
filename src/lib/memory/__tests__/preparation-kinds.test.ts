/**
 * Smoke tests for the Phase D preparation-phase memory kinds.
 *
 * Verifies that:
 *   - `prd-pattern` and `design-pattern` records can round-trip through
 *     FileStore (save → recall → file on disk with the right id prefix).
 *   - The 4KB body cap declared in `schemas/index.ts` is enforced.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FileStore } from "../file-store";
import type { SaveInput } from "../types";

let tmp: string;
let store: FileStore;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mem-prep-"));
  store = new FileStore({ layer: "L1", root: tmp });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function prdInput(over: Partial<SaveInput> = {}): SaveInput {
  return {
    id: "",
    layer: "L1",
    kind: "prd-pattern",
    title: "S-tier calculator PRD template",
    body: "Calculator PRDs should always include explicit keyboard mapping.",
    tags: ["tier:S", "projectType:calculator", "phase:prd", "outcome:positive"],
    source: "orchestrator",
    refs: {},
    metrics: { score: 0.4 },
    ...over,
  };
}

function designInput(over: Partial<SaveInput> = {}): SaveInput {
  return {
    id: "",
    layer: "L1",
    kind: "design-pattern",
    title: "S-tier dashboard dark palette",
    body: "Use #0f0f1a background with #ff5470 accent for dark dashboards.",
    tags: ["tier:S", "projectType:dashboard", "phase:design", "outcome:positive"],
    source: "orchestrator",
    refs: {},
    metrics: { score: 0.4 },
    ...over,
  };
}

describe("preparation-phase kinds", () => {
  it("saves prd-pattern records with PRD- id prefix", async () => {
    const saved = await store.save(prdInput());
    expect(saved.id).toMatch(/^PRD-/);
    const got = await store.get(saved.id);
    expect(got?.body).toContain("keyboard mapping");
    const onDisk = path.join(tmp, ".memory/records/prd-pattern", `${saved.id}.md`);
    await expect(fs.access(onDisk)).resolves.toBeUndefined();
  });

  it("saves design-pattern records with DSG- id prefix", async () => {
    const saved = await store.save(designInput());
    expect(saved.id).toMatch(/^DSG-/);
    const onDisk = path.join(tmp, ".memory/records/design-pattern", `${saved.id}.md`);
    await expect(fs.access(onDisk)).resolves.toBeUndefined();
  });

  it("recalls preparation-phase records by kind", async () => {
    await store.save(prdInput());
    await store.save(designInput());
    const prdHits = await store.recall({ layer: "L1", kinds: ["prd-pattern"] });
    expect(prdHits).toHaveLength(1);
    expect(prdHits[0]!.kind).toBe("prd-pattern");
    const designHits = await store.recall({ layer: "L1", kinds: ["design-pattern"] });
    expect(designHits).toHaveLength(1);
    expect(designHits[0]!.kind).toBe("design-pattern");
  });

  it("enforces the 4KB body cap for prd-pattern", async () => {
    const oversize = "x".repeat(4 * 1024 + 1);
    await expect(store.save(prdInput({ body: oversize }))).rejects.toThrow(
      /body exceeds/,
    );
  });

  it("enforces the 4KB body cap for design-pattern", async () => {
    const oversize = "x".repeat(4 * 1024 + 1);
    await expect(store.save(designInput({ body: oversize }))).rejects.toThrow(
      /body exceeds/,
    );
  });
});
