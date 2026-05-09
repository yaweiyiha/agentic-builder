/**
 * Tests for distributeSharedSchema — fans the TRD-frozen schema out
 * into per-tier consumer locations under outputDir.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  distributeSharedSchema,
  plannedSharedSchemaPaths,
} from "../shared-schema-distributor";

let agenticRoot: string;
let outputDir: string;

beforeEach(async () => {
  agenticRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ab-trd-source-"));
  outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "ab-trd-output-"));
});

afterEach(async () => {
  await fs.rm(agenticRoot, { recursive: true, force: true });
  await fs.rm(outputDir, { recursive: true, force: true });
});

async function seedSchema(content: string): Promise<void> {
  const blueprintDir = path.join(agenticRoot, ".blueprint");
  await fs.mkdir(blueprintDir, { recursive: true });
  await fs.writeFile(path.join(blueprintDir, "shared-schema.ts"), content, "utf8");
}

const SCHEMA = `export interface Project { id: string; name: string; }
export interface CreateProjectRequest { name: string; }
`;

describe("plannedSharedSchemaPaths", () => {
  it("S-tier maps to a single src path", () => {
    expect(plannedSharedSchemaPaths("S")).toEqual(["src/shared/schema.ts"]);
  });

  it("M-tier maps to both frontend and backend", () => {
    expect(plannedSharedSchemaPaths("M")).toEqual([
      "frontend/src/shared/schema.ts",
      "backend/src/shared/schema.ts",
    ]);
  });

  it("L-tier maps to packages/shared", () => {
    expect(plannedSharedSchemaPaths("L")).toEqual([
      "packages/shared/src/schema.ts",
    ]);
  });
});

describe("distributeSharedSchema — happy paths", () => {
  it("S-tier writes one file with the schema content", async () => {
    await seedSchema(SCHEMA);
    const r = await distributeSharedSchema("S", outputDir, {
      sourceDir: agenticRoot,
    });
    expect(r.found).toBe(true);
    expect(r.written).toEqual(["src/shared/schema.ts"]);
    const written = await fs.readFile(
      path.join(outputDir, "src/shared/schema.ts"),
      "utf8",
    );
    expect(written).toBe(SCHEMA);
  });

  it("M-tier writes identical copies to frontend and backend", async () => {
    await seedSchema(SCHEMA);
    const r = await distributeSharedSchema("M", outputDir, {
      sourceDir: agenticRoot,
    });
    expect(r.found).toBe(true);
    expect(r.written).toHaveLength(2);
    const fe = await fs.readFile(
      path.join(outputDir, "frontend/src/shared/schema.ts"),
      "utf8",
    );
    const be = await fs.readFile(
      path.join(outputDir, "backend/src/shared/schema.ts"),
      "utf8",
    );
    expect(fe).toBe(SCHEMA);
    expect(be).toBe(SCHEMA);
    expect(fe).toBe(be);
  });

  it("L-tier writes to packages/shared/src/schema.ts", async () => {
    await seedSchema(SCHEMA);
    const r = await distributeSharedSchema("L", outputDir, {
      sourceDir: agenticRoot,
    });
    expect(r.found).toBe(true);
    expect(r.written).toEqual(["packages/shared/src/schema.ts"]);
    const written = await fs.readFile(
      path.join(outputDir, "packages/shared/src/schema.ts"),
      "utf8",
    );
    expect(written).toBe(SCHEMA);
  });

  it("creates intermediate directories if missing", async () => {
    await seedSchema(SCHEMA);
    // outputDir is empty; distributor must mkdir -p
    await distributeSharedSchema("M", outputDir, { sourceDir: agenticRoot });
    const beStat = await fs.stat(
      path.join(outputDir, "backend/src/shared/schema.ts"),
    );
    expect(beStat.isFile()).toBe(true);
  });

  it("is idempotent: calling twice overwrites with same content", async () => {
    await seedSchema(SCHEMA);
    await distributeSharedSchema("S", outputDir, { sourceDir: agenticRoot });
    await distributeSharedSchema("S", outputDir, { sourceDir: agenticRoot });
    const written = await fs.readFile(
      path.join(outputDir, "src/shared/schema.ts"),
      "utf8",
    );
    expect(written).toBe(SCHEMA);
  });
});

describe("distributeSharedSchema — no-op cases", () => {
  it("returns found=false when source file is missing", async () => {
    // Don't seed
    const r = await distributeSharedSchema("M", outputDir, {
      sourceDir: agenticRoot,
    });
    expect(r.found).toBe(false);
    expect(r.written).toEqual([]);
    // No files should have been created
    await expect(
      fs.access(path.join(outputDir, "frontend/src/shared/schema.ts")),
    ).rejects.toThrow();
  });

  it("returns found=false when source file is empty/whitespace", async () => {
    await seedSchema("   \n  \n");
    const r = await distributeSharedSchema("M", outputDir, {
      sourceDir: agenticRoot,
    });
    expect(r.found).toBe(false);
    expect(r.written).toEqual([]);
  });
});
