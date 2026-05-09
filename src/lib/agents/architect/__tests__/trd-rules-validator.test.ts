/**
 * Tests for the regex-based business-rules DSL shape validator.
 */

import { describe, expect, it } from "vitest";
import { validateRulesDsl } from "../trd-rules-validator";

describe("validateRulesDsl — empty / trivial input", () => {
  it("flags empty content", () => {
    const r = validateRulesDsl("");
    expect(r.ok).toBe(false);
    expect(r.warnings.map((w) => w.code)).toContain("empty-content");
  });

  it("whitespace-only content treated as empty", () => {
    const r = validateRulesDsl("   \n\n  ");
    expect(r.warnings.map((w) => w.code)).toContain("empty-content");
  });
});

describe("validateRulesDsl — happy path", () => {
  it("accepts a well-formed piecewise-linear rule", () => {
    const yaml = `version: 1
rules:
  - id: SCORE-1
    type: piecewise-linear
    segments:
      - { from: 0, to: 5, outputFrom: 0, outputTo: 100 }
`;
    const r = validateRulesDsl(yaml);
    expect(r.ok).toBe(true);
    expect(r.ruleCount).toBe(1);
    expect(r.ruleTypes).toEqual(["piecewise-linear"]);
    expect(r.warnings).toEqual([]);
  });

  it("accepts a well-formed decision-table rule", () => {
    const yaml = `version: 1
rules:
  - id: ELIG-1
    type: decision-table
    inputs: [...]
    cases: [...]
`;
    const r = validateRulesDsl(yaml);
    expect(r.ok).toBe(true);
    expect(r.ruleTypes).toEqual(["decision-table"]);
  });

  it("accepts multiple rules of mixed supported types", () => {
    const yaml = `version: 1
rules:
  - id: SCORE-1
    type: piecewise-linear
  - id: ELIG-1
    type: decision-table
  - id: SCORE-2
    type: piecewise-linear
`;
    const r = validateRulesDsl(yaml);
    expect(r.ok).toBe(true);
    expect(r.ruleCount).toBe(3);
    expect(r.ruleTypes.sort()).toEqual(["decision-table", "piecewise-linear"]);
  });
});

describe("validateRulesDsl — missing required structure", () => {
  it("flags missing version line", () => {
    const yaml = `rules:
  - id: SCORE-1
    type: piecewise-linear
`;
    const r = validateRulesDsl(yaml);
    expect(r.warnings.map((w) => w.code)).toContain("missing-version");
  });

  it("flags missing rules array", () => {
    const yaml = `version: 1
something_else: true
`;
    const r = validateRulesDsl(yaml);
    expect(r.warnings.map((w) => w.code)).toContain("missing-rules");
  });

  it("flags rules array with no entries", () => {
    const yaml = `version: 1
rules:
`;
    const r = validateRulesDsl(yaml);
    expect(r.warnings.map((w) => w.code)).toContain("no-rules");
    expect(r.ruleCount).toBe(0);
  });
});

describe("validateRulesDsl — unsupported rule types", () => {
  it("flags unknown rule type with explanatory message", () => {
    const yaml = `version: 1
rules:
  - id: STATE-1
    type: state-machine
`;
    const r = validateRulesDsl(yaml);
    expect(r.warnings.map((w) => w.code)).toContain("unknown-rule-type");
    const msg = r.warnings.find((w) => w.code === "unknown-rule-type")?.message ?? "";
    expect(msg).toContain("state-machine");
    expect(msg).toContain("piecewise-linear");
  });

  it("mixed supported and unsupported types: only unsupported flagged", () => {
    const yaml = `version: 1
rules:
  - id: SCORE-1
    type: piecewise-linear
  - id: WEIRD-1
    type: composite-formula
`;
    const r = validateRulesDsl(yaml);
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain("unknown-rule-type");
    expect(r.ruleTypes.sort()).toEqual(["composite-formula", "piecewise-linear"]);
  });
});

describe("validateRulesDsl — rule-missing-type", () => {
  it("flags when rule count exceeds type count", () => {
    const yaml = `version: 1
rules:
  - id: SCORE-1
    type: piecewise-linear
  - id: SCORE-2
    name: forgot the type
`;
    const r = validateRulesDsl(yaml);
    expect(r.warnings.map((w) => w.code)).toContain("rule-missing-type");
    expect(r.ruleCount).toBe(2);
  });
});
