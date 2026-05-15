/**
 * Tests for renderAuthoritativeRulesBlock — converts PRD-extracted
 * rules into the YAML block injected into TRDAgent's prompt.
 */

import { describe, expect, it } from "vitest";
import { renderAuthoritativeRulesBlock } from "../trd-agent";
import type { PrdRuleSpec } from "@/lib/requirements/prd-spec-types";

describe("renderAuthoritativeRulesBlock", () => {
  it("returns empty string when rules array is undefined or empty", () => {
    expect(renderAuthoritativeRulesBlock(undefined)).toBe("");
    expect(renderAuthoritativeRulesBlock([])).toBe("");
  });

  it("renders the header + AUTHORITATIVE warning", () => {
    const rules: PrdRuleSpec[] = [
      {
        id: "R1",
        name: "Test",
        type: "piecewise-linear",
        segments: [{ from: 0, to: 10, outputFrom: 0, outputTo: 100 }],
      },
    ];
    const out = renderAuthoritativeRulesBlock(rules);
    expect(out).toContain("## PRD-provided domain rules");
    expect(out).toMatch(/AUTHORITATIVE/);
    expect(out).toContain("Do NOT");
  });

  it("renders piecewise-linear segments with exact boundary values", () => {
    const rules: PrdRuleSpec[] = [
      {
        id: "RQ-1-NORM",
        name: "Reserve safety",
        type: "piecewise-linear",
        inputVariableId: "RQ-1",
        segments: [
          { from: 90, to: 100, outputFrom: 0, outputTo: 0 },
          { from: 80, to: 90, outputFrom: 10, outputTo: 0 },
          { from: 25, to: 40, outputFrom: 100, outputTo: 75 },
        ],
      },
    ];
    const out = renderAuthoritativeRulesBlock(rules);
    expect(out).toContain("id: RQ-1-NORM");
    expect(out).toContain("inputVariableId: RQ-1");
    expect(out).toContain("from: 90, to: 100, outputFrom: 0, outputTo: 0");
    expect(out).toContain("from: 25, to: 40, outputFrom: 100, outputTo: 75");
  });

  it("renders decision-table cases with empty default fallback", () => {
    const rules: PrdRuleSpec[] = [
      {
        id: "ELIG-1",
        name: "Eligibility tier",
        type: "decision-table",
        cases: [
          { when: { creditScore: ">=750" }, then: "premium" },
          { when: {}, then: "basic" },
        ],
      },
    ];
    const out = renderAuthoritativeRulesBlock(rules);
    expect(out).toContain("id: ELIG-1");
    expect(out).toContain('{ creditScore: ">=750" }');
    expect(out).toContain('when: {}, then: "basic"');
  });

  it("renders 'other' rules with formula but no segments/cases", () => {
    const rules: PrdRuleSpec[] = [
      {
        id: "COMP-1",
        name: "Composite",
        type: "other",
        formula: "0.4 * RQ + 0.3 * MC + 0.3 * SE",
      },
    ];
    const out = renderAuthoritativeRulesBlock(rules);
    expect(out).toContain("type: other");
    expect(out).toContain('formula: "0.4 * RQ + 0.3 * MC + 0.3 * SE"');
    expect(out).not.toContain("segments:");
    expect(out).not.toContain("cases:");
  });

  it("renders multiple rules in order", () => {
    const rules: PrdRuleSpec[] = [
      {
        id: "A",
        name: "First",
        type: "piecewise-linear",
        segments: [{ from: 0, to: 1, outputFrom: 0, outputTo: 1 }],
      },
      {
        id: "B",
        name: "Second",
        type: "piecewise-linear",
        segments: [{ from: 1, to: 2, outputFrom: 1, outputTo: 0 }],
      },
    ];
    const out = renderAuthoritativeRulesBlock(rules);
    const aIdx = out.indexOf("id: A");
    const bIdx = out.indexOf("id: B");
    expect(aIdx).toBeGreaterThan(0);
    expect(bIdx).toBeGreaterThan(aIdx);
  });

  it("escapes id values that aren't safe yaml identifiers", () => {
    const rules: PrdRuleSpec[] = [
      {
        id: "rule with spaces",
        name: "x",
        type: "piecewise-linear",
        segments: [{ from: 0, to: 1, outputFrom: 0, outputTo: 0 }],
      },
    ];
    const out = renderAuthoritativeRulesBlock(rules);
    expect(out).toContain('id: "rule with spaces"');
  });
});
