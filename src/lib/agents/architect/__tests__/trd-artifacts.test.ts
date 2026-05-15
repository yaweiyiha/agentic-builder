/**
 * Tests for extractTrdArtifacts — pulls fenced code blocks tagged
 * `file:<path>` out of the TRD agent's Markdown response.
 */

import { describe, expect, it } from "vitest";
import { extractTrdArtifacts } from "../trd-artifacts";

describe("extractTrdArtifacts — empty / no blocks", () => {
  it("returns empty arrays when content is empty", () => {
    const r = extractTrdArtifacts("");
    expect(r.schemaTs).toBeUndefined();
    expect(r.rulesYaml).toBeUndefined();
    expect(r.malformed).toEqual([]);
    expect(r.unknown).toEqual([]);
  });

  it("returns empty arrays when there are no fenced blocks", () => {
    const r = extractTrdArtifacts("# TRD\n\nJust prose, no code blocks.");
    expect(r.schemaTs).toBeUndefined();
    expect(r.rulesYaml).toBeUndefined();
  });

  it("ignores fenced blocks without a file: header", () => {
    const r = extractTrdArtifacts(
      "Inline example:\n```ts\nexport type X = string;\n```\n",
    );
    expect(r.schemaTs).toBeUndefined();
  });
});

describe("extractTrdArtifacts — shared schema", () => {
  it("extracts shared/schema.ts with typescript language tag", () => {
    const content = `# TRD

## 6. Shared Schema

\`\`\`typescript file:shared/schema.ts
export type ProjectId = string;
export interface Project { id: ProjectId; name: string; }
\`\`\`
`;
    const r = extractTrdArtifacts(content);
    expect(r.schemaTs).toBe(
      "export type ProjectId = string;\nexport interface Project { id: ProjectId; name: string; }",
    );
    expect(r.malformed).toEqual([]);
  });

  it("accepts ts shorthand language tag", () => {
    const content = "```ts file:shared/schema.ts\nexport const X = 1;\n```";
    const r = extractTrdArtifacts(content);
    expect(r.schemaTs).toBe("export const X = 1;");
  });

  it("accepts no language tag", () => {
    const content = "```file:shared/schema.ts\nexport const X = 1;\n```";
    const r = extractTrdArtifacts(content);
    expect(r.schemaTs).toBe("export const X = 1;");
  });

  it("accepts 4+ backticks (allows nested triple-backtick in body)", () => {
    const content = `\`\`\`\`typescript file:shared/schema.ts
// Example showing how to use:
//   \`\`\`ts
//   import { X } from "shared/schema";
//   \`\`\`
export const X = 1;
\`\`\`\`
`;
    const r = extractTrdArtifacts(content);
    expect(r.schemaTs).toContain("export const X = 1;");
    expect(r.schemaTs).toContain("import { X }");
  });
});

describe("extractTrdArtifacts — business rules DSL", () => {
  it("extracts business-rules.dsl.yaml with yaml tag", () => {
    const content = `\`\`\`yaml file:business-rules.dsl.yaml
version: 1
rules:
  - id: SCORE-1
    type: piecewise-linear
\`\`\``;
    const r = extractTrdArtifacts(content);
    expect(r.rulesYaml).toContain("version: 1");
    expect(r.rulesYaml).toContain("piecewise-linear");
  });

  it("schema and rules can coexist in a single TRD output", () => {
    const content = `## 6
\`\`\`typescript file:shared/schema.ts
export type X = 1;
\`\`\`

## 7
\`\`\`yaml file:business-rules.dsl.yaml
version: 1
\`\`\``;
    const r = extractTrdArtifacts(content);
    expect(r.schemaTs).toBe("export type X = 1;");
    expect(r.rulesYaml).toBe("version: 1");
  });
});

describe("extractTrdArtifacts — error handling", () => {
  it("records malformed entry when fence is unclosed", () => {
    const content = `\`\`\`typescript file:shared/schema.ts
export type X = 1;
(no closing fence)`;
    const r = extractTrdArtifacts(content);
    expect(r.schemaTs).toBeUndefined();
    expect(r.malformed).toHaveLength(1);
    expect(r.malformed[0]?.path).toBe("shared/schema.ts");
    expect(r.malformed[0]?.reason).toMatch(/unclosed/i);
  });

  it("records unknown path under unknown[]", () => {
    const content = `\`\`\`typescript file:weird/path/file.ts
const x = 1;
\`\`\``;
    const r = extractTrdArtifacts(content);
    expect(r.schemaTs).toBeUndefined();
    expect(r.unknown).toHaveLength(1);
    expect(r.unknown[0]?.path).toBe("weird/path/file.ts");
    expect(r.unknown[0]?.body).toBe("const x = 1;");
  });

  it("continues scanning after a malformed/unknown block", () => {
    const content = `\`\`\`typescript file:weird/file.ts
const x = 1;
\`\`\`

\`\`\`typescript file:shared/schema.ts
export const Y = 2;
\`\`\``;
    const r = extractTrdArtifacts(content);
    expect(r.unknown).toHaveLength(1);
    expect(r.schemaTs).toBe("export const Y = 2;");
  });
});
