/**
 * Tests for the workflow-DAG shape + integrity validator.
 */

import { describe, expect, it } from "vitest";

import {
  validateWorkflowDag,
  extractServicesFromTrd,
} from "../dag-validator";

const HAPPY = `version: 1
pipelines:
  - id: scoring-cycle
    description: "test"
    schedule: { cron: "*/5 * * * *" }
    failure: { strategy: abort, retries: 0 }
    nodes:
      - { id: collect,   service: DataCollectionService, function: collectAll }
      - { id: normalize, service: NormalizationService,  function: run, dependsOn: [collect] }
      - { id: score,     service: ScoringEngine,         function: calc, dependsOn: [normalize] }
`;

describe("validateWorkflowDag — empty / missing structure", () => {
  it("flags empty content", () => {
    const r = validateWorkflowDag("");
    expect(r.ok).toBe(false);
    expect(r.warnings.map((w) => w.code)).toContain("empty-content");
  });

  it("flags missing version + missing pipelines", () => {
    const r = validateWorkflowDag("foo: bar\n");
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain("missing-version");
    expect(codes).toContain("missing-pipelines");
  });

  it("flags missing nodes inside a pipeline", () => {
    const r = validateWorkflowDag(`version: 1
pipelines:
  - id: empty
    description: "no nodes"
`);
    expect(r.warnings.map((w) => w.code)).toContain("pipeline-missing-nodes");
  });
});

describe("validateWorkflowDag — happy path", () => {
  it("accepts a well-formed DAG with no warnings", () => {
    const r = validateWorkflowDag(HAPPY);
    expect(r.ok).toBe(true);
    expect(r.pipelineCount).toBe(1);
    expect(r.nodeCount).toBe(3);
    expect(r.servicesReferenced.sort()).toEqual([
      "DataCollectionService",
      "NormalizationService",
      "ScoringEngine",
    ]);
  });

  it("accepts retry-N failure strategy", () => {
    const yaml = `version: 1
pipelines:
  - id: p1
    failure: { strategy: retry-3 }
    nodes:
      - { id: a, service: SvcA, function: f }
`;
    const r = validateWorkflowDag(yaml);
    expect(r.warnings.find((w) => w.code === "unknown-failure-strategy")).toBeUndefined();
  });
});

describe("validateWorkflowDag — dependsOn integrity", () => {
  it("flags a dangling dependsOn reference", () => {
    const yaml = `version: 1
pipelines:
  - id: p1
    nodes:
      - { id: a, service: SvcA, function: f, dependsOn: [ghost] }
`;
    const r = validateWorkflowDag(yaml);
    expect(r.warnings.map((w) => w.code)).toContain("node-unknown-dependson");
  });

  it("flags a cycle: a→b→a", () => {
    const yaml = `version: 1
pipelines:
  - id: p1
    nodes:
      - { id: a, service: SvcA, function: f, dependsOn: [b] }
      - { id: b, service: SvcB, function: g, dependsOn: [a] }
`;
    const r = validateWorkflowDag(yaml);
    expect(r.warnings.map((w) => w.code)).toContain("cycle-detected");
  });

  it("accepts a diamond dependency (a→b, a→c, b→d, c→d)", () => {
    const yaml = `version: 1
pipelines:
  - id: p1
    nodes:
      - { id: a, service: SvcA, function: f }
      - { id: b, service: SvcB, function: g, dependsOn: [a] }
      - { id: c, service: SvcC, function: h, dependsOn: [a] }
      - { id: d, service: SvcD, function: i, dependsOn: [b, c] }
`;
    const r = validateWorkflowDag(yaml);
    expect(r.warnings.find((w) => w.code === "cycle-detected")).toBeUndefined();
    expect(r.nodeCount).toBe(4);
  });
});

describe("validateWorkflowDag — failure-strategy enum", () => {
  it("flags an unknown failure strategy", () => {
    const yaml = `version: 1
pipelines:
  - id: p1
    failure: { strategy: yolo }
    nodes:
      - { id: a, service: SvcA, function: f }
`;
    const r = validateWorkflowDag(yaml);
    const w = r.warnings.find((w) => w.code === "unknown-failure-strategy");
    expect(w?.message).toContain("yolo");
  });
});

describe("validateWorkflowDag — service-name match against TRD", () => {
  const trdWithServices = `# TRD
## 3. Backend
### 3.1 Services
| Service | Responsibility | Tech |
|---------|---------------|------|
| DataCollectionService | collects raw inputs | Node |
| NormalizationService  | normalises inputs | Node |
| ScoringEngine         | composite scoring | Node |
`;

  it("passes when DAG services all appear in §3.1 table", () => {
    const r = validateWorkflowDag(HAPPY, { trdMarkdown: trdWithServices });
    expect(r.warnings.find((w) => w.code === "service-not-in-trd")).toBeUndefined();
  });

  it("flags a DAG service not declared in §3.1", () => {
    const yaml = `version: 1
pipelines:
  - id: p1
    nodes:
      - { id: a, service: GhostService, function: f }
`;
    const r = validateWorkflowDag(yaml, { trdMarkdown: trdWithServices });
    const w = r.warnings.find((w) => w.code === "service-not-in-trd");
    expect(w?.message).toContain("GhostService");
  });

  it("skips service-name validation when no TRD provided", () => {
    const yaml = `version: 1
pipelines:
  - id: p1
    nodes:
      - { id: a, service: GhostService, function: f }
`;
    const r = validateWorkflowDag(yaml);
    expect(r.warnings.find((w) => w.code === "service-not-in-trd")).toBeUndefined();
  });
});

describe("extractServicesFromTrd", () => {
  it("returns empty when §3.1 heading is absent", () => {
    const out = extractServicesFromTrd("# TRD\n## 1 Tech Stack\n");
    expect(out.size).toBe(0);
  });

  it("extracts column 1 names from a §3.1 markdown table", () => {
    const md = `### 3.1 Services
| Service | Responsibility |
|---------|---------------|
| Auth Service | login |
| Task Service | crud |
`;
    const out = extractServicesFromTrd(md);
    expect(Array.from(out).sort()).toEqual(["Auth Service", "Task Service"]);
  });

  it("stops parsing when next heading appears", () => {
    const md = `### 3.1 Services
| Service | Responsibility |
|---------|---------------|
| Auth Service | login |
### 3.2 Data Models
| Table | x |
|-------|---|
| Users | y |
`;
    const out = extractServicesFromTrd(md);
    expect(out.has("Auth Service")).toBe(true);
    expect(out.has("Users")).toBe(false);
  });
});
