/**
 * Tests for persistTrdArtifactsFromContent — the side-effecting helper
 * shared between engine.ts and the parallel-generate API route.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { persistTrdArtifactsFromContent } from "../persist-trd-artifacts";

let blueprintDir: string;

beforeEach(async () => {
  blueprintDir = await fs.mkdtemp(path.join(os.tmpdir(), "ab-trd-blue-"));
});

afterEach(async () => {
  await fs.rm(blueprintDir, { recursive: true, force: true });
});

describe("persistTrdArtifactsFromContent", () => {
  it("writes shared-schema.ts when §6 block is present", async () => {
    const content = `# TRD
\`\`\`typescript file:shared/schema.ts
export interface Project { id: string; name: string; }
\`\`\``;
    const r = await persistTrdArtifactsFromContent(content, blueprintDir);
    expect(r.written.schemaTs).toBe(path.join(blueprintDir, "shared-schema.ts"));
    expect(r.written.rulesYaml).toBeUndefined();
    const written = await fs.readFile(r.written.schemaTs!, "utf8");
    expect(written).toContain("export interface Project");
  });

  it("writes business-rules.dsl.yaml + runs validator when §7 block is present", async () => {
    const content = `\`\`\`yaml file:business-rules.dsl.yaml
version: 1
rules:
  - id: SCORE-1
    type: piecewise-linear
\`\`\``;
    const r = await persistTrdArtifactsFromContent(content, blueprintDir);
    expect(r.written.rulesYaml).toBe(
      path.join(blueprintDir, "business-rules.dsl.yaml"),
    );
    expect(r.rulesValidation?.ok).toBe(true);
    expect(r.rulesValidation?.ruleCount).toBe(1);
  });

  it("writes both files when both blocks are present", async () => {
    const content = `## §6
\`\`\`typescript file:shared/schema.ts
export const X = 1;
\`\`\`
## §7
\`\`\`yaml file:business-rules.dsl.yaml
version: 1
rules:
  - id: R-1
    type: decision-table
\`\`\``;
    const r = await persistTrdArtifactsFromContent(content, blueprintDir);
    expect(r.written.schemaTs).toBeDefined();
    expect(r.written.rulesYaml).toBeDefined();
  });

  it("creates the blueprint directory if it does not yet exist", async () => {
    const nested = path.join(blueprintDir, "deep", "nested");
    const content =
      "```typescript file:shared/schema.ts\nexport const X = 1;\n```";
    const r = await persistTrdArtifactsFromContent(content, nested);
    expect(r.written.schemaTs).toBeDefined();
    const stat = await fs.stat(r.written.schemaTs!);
    expect(stat.isFile()).toBe(true);
  });

  it("no-op (no writes) when content has neither §6 nor §7 blocks", async () => {
    const r = await persistTrdArtifactsFromContent(
      "# TRD with prose only",
      blueprintDir,
    );
    expect(r.written.schemaTs).toBeUndefined();
    expect(r.written.rulesYaml).toBeUndefined();
    expect(r.rulesValidation).toBeUndefined();
  });

  it("rulesValidation flags warnings for unsupported rule type", async () => {
    const content = `\`\`\`yaml file:business-rules.dsl.yaml
version: 1
rules:
  - id: WEIRD-1
    type: state-machine
\`\`\``;
    const r = await persistTrdArtifactsFromContent(content, blueprintDir);
    expect(r.rulesValidation?.ok).toBe(false);
    expect(r.rulesValidation?.warnings.map((w) => w.code)).toContain(
      "unknown-rule-type",
    );
  });
});
