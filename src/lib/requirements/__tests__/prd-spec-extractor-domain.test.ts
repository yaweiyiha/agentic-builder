/**
 * Tests for the optional `domain` section parsing inside parsePrdSpec.
 * Production callers go through `extractPrdSpec` (LLM-driven); these
 * tests pin the deterministic JSON → typed spec layer.
 */

import { describe, expect, it } from "vitest";
import { parsePrdSpec } from "../prd-spec-extractor";

const MINIMAL_PAGES = `"pages": [
  { "id": "PAGE-001", "name": "Home", "route": "/",
    "layoutRegions": ["body"], "interactiveComponents": [], "staticElements": [], "states": [] }
]`;

function withDomain(domainBody: string): string {
  return `{
    ${MINIMAL_PAGES},
    "domain": ${domainBody}
  }`;
}

describe("parsePrdSpec — no domain", () => {
  it("returns spec without domain when omitted", () => {
    const s = parsePrdSpec(`{ ${MINIMAL_PAGES} }`);
    expect(s).not.toBeNull();
    expect(s?.domain).toBeUndefined();
  });

  it("returns spec without domain when domain is empty object", () => {
    const s = parsePrdSpec(withDomain("{}"));
    expect(s?.domain).toBeUndefined();
  });
});

describe("parsePrdSpec — domain.entities", () => {
  it("extracts entity catalog with instances", () => {
    const s = parsePrdSpec(
      withDomain(`{
        "entities": [
          { "type": "stablecoins", "instances": [
            { "symbol": "USDC", "issuer": "Circle" },
            { "symbol": "USDT", "issuer": "Tether" }
          ]}
        ]
      }`),
    );
    expect(s?.domain?.entities).toHaveLength(1);
    expect(s?.domain?.entities?.[0]?.type).toBe("stablecoins");
    expect(s?.domain?.entities?.[0]?.instances).toHaveLength(2);
  });

  it("drops entities with empty type", () => {
    const s = parsePrdSpec(
      withDomain(`{ "entities": [{ "type": "", "instances": [] }] }`),
    );
    expect(s?.domain).toBeUndefined();
  });
});

describe("parsePrdSpec — domain.rules", () => {
  it("parses piecewise-linear segments verbatim", () => {
    const s = parsePrdSpec(
      withDomain(`{
        "rules": [{
          "id": "RQ-1-NORM",
          "name": "Reserve safety",
          "type": "piecewise-linear",
          "inputVariableId": "RQ-1",
          "segments": [
            { "from": 90, "to": 100, "outputFrom": 0, "outputTo": 0 },
            { "from": 80, "to": 90, "outputFrom": 10, "outputTo": 0 },
            { "from": 25, "to": 40, "outputFrom": 100, "outputTo": 75 }
          ]
        }]
      }`),
    );
    const rule = s?.domain?.rules?.[0];
    expect(rule?.id).toBe("RQ-1-NORM");
    expect(rule?.type).toBe("piecewise-linear");
    expect(rule?.segments).toHaveLength(3);
    expect(rule?.segments?.[1]).toEqual({
      from: 80,
      to: 90,
      outputFrom: 10,
      outputTo: 0,
    });
  });

  it("parses decision-table cases", () => {
    const s = parsePrdSpec(
      withDomain(`{
        "rules": [{
          "id": "ELIG-1", "name": "tier",
          "type": "decision-table",
          "cases": [
            { "when": { "creditScore": ">=750" }, "then": "premium" },
            { "when": {}, "then": "basic" }
          ]
        }]
      }`),
    );
    const rule = s?.domain?.rules?.[0];
    expect(rule?.type).toBe("decision-table");
    expect(rule?.cases).toHaveLength(2);
    expect(rule?.cases?.[1]?.then).toBe("basic");
  });

  it("downgrades unknown rule type to 'other' instead of dropping it", () => {
    const s = parsePrdSpec(
      withDomain(`{
        "rules": [{ "id": "X", "name": "x", "type": "weird-thing", "formula": "x * 2" }]
      }`),
    );
    expect(s?.domain?.rules?.[0]?.type).toBe("other");
    expect(s?.domain?.rules?.[0]?.formula).toBe("x * 2");
  });

  it("filters out segments with non-numeric boundaries", () => {
    const s = parsePrdSpec(
      withDomain(`{
        "rules": [{
          "id": "R", "name": "r", "type": "piecewise-linear",
          "segments": [
            { "from": 0, "to": 10, "outputFrom": 0, "outputTo": 100 },
            { "from": "bad", "to": 20, "outputFrom": 0, "outputTo": 100 }
          ]
        }]
      }`),
    );
    expect(s?.domain?.rules?.[0]?.segments).toHaveLength(1);
  });
});

describe("parsePrdSpec — domain.dataSources auth narrowing", () => {
  it("accepts valid auth values", () => {
    const s = parsePrdSpec(
      withDomain(`{
        "dataSources": [
          { "id": "a", "name": "A", "kind": "http-rest", "auth": "bearer" }
        ]
      }`),
    );
    expect(s?.domain?.dataSources?.[0]?.auth).toBe("bearer");
  });

  it("drops invalid auth values to undefined (keeps source)", () => {
    const s = parsePrdSpec(
      withDomain(`{
        "dataSources": [
          { "id": "a", "name": "A", "kind": "http-rest", "auth": "magic" }
        ]
      }`),
    );
    expect(s?.domain?.dataSources?.[0]?.auth).toBeUndefined();
    expect(s?.domain?.dataSources?.[0]?.id).toBe("a");
  });

  it("requires id and kind, drops sources missing either", () => {
    const s = parsePrdSpec(
      withDomain(`{
        "dataSources": [
          { "id": "", "name": "A", "kind": "http-rest" },
          { "id": "b", "name": "B", "kind": "" }
        ]
      }`),
    );
    expect(s?.domain?.dataSources).toBeUndefined();
  });
});

describe("parsePrdSpec — domain.schedules / workflows / alerts", () => {
  it("parses a schedule with cron", () => {
    const s = parsePrdSpec(
      withDomain(`{
        "schedules": [{
          "id": "cycle", "description": "Every 5 min",
          "cron": "*/5 * * * *", "pipelineId": "scoring-cycle"
        }]
      }`),
    );
    expect(s?.domain?.schedules?.[0]?.cron).toBe("*/5 * * * *");
    expect(s?.domain?.schedules?.[0]?.pipelineId).toBe("scoring-cycle");
  });

  it("parses a workflow FSM with transitions", () => {
    const s = parsePrdSpec(
      withDomain(`{
        "workflows": [{
          "id": "review", "entity": "ReserveReview", "initial": "pending",
          "states": ["pending", "approved", "rejected"],
          "transitions": [
            { "from": "pending", "to": "approved", "action": "approve",
              "requires": ["reviewer_id", "comment"] },
            { "from": "pending", "to": "rejected", "action": "reject" }
          ],
          "auditTrail": true
        }]
      }`),
    );
    const wf = s?.domain?.workflows?.[0];
    expect(wf?.states).toEqual(["pending", "approved", "rejected"]);
    expect(wf?.transitions).toHaveLength(2);
    expect(wf?.transitions?.[0]?.requires).toEqual(["reviewer_id", "comment"]);
    expect(wf?.auditTrail).toBe(true);
  });

  it("drops a transition with empty from/to/action", () => {
    const s = parsePrdSpec(
      withDomain(`{
        "workflows": [{
          "id": "w", "entity": "E", "initial": "a",
          "states": ["a","b"],
          "transitions": [
            { "from": "a", "to": "b", "action": "go" },
            { "from": "", "to": "b", "action": "x" }
          ]
        }]
      }`),
    );
    expect(s?.domain?.workflows?.[0]?.transitions).toHaveLength(1);
  });

  it("parses alerts with severity and channels", () => {
    const s = parsePrdSpec(
      withDomain(`{
        "alerts": [{
          "id": "rapid-mover", "description": "score moved sharply",
          "trigger": "delta >= 25 within 5min",
          "severity": "high", "channels": ["in-app", "email"]
        }]
      }`),
    );
    expect(s?.domain?.alerts?.[0]?.severity).toBe("high");
    expect(s?.domain?.alerts?.[0]?.channels).toEqual(["in-app", "email"]);
  });
});

describe("parsePrdSpec — robustness", () => {
  it("tolerates a code-fenced JSON block", () => {
    const wrapped =
      "```json\n" + `{ ${MINIMAL_PAGES}, "domain": { "rules": [{ "id": "x", "name": "x", "type": "other", "formula": "f" }] } }` + "\n```";
    const s = parsePrdSpec(wrapped);
    expect(s?.domain?.rules?.[0]?.id).toBe("x");
  });

  it("returns null when pages array is absent (no fallback)", () => {
    const s = parsePrdSpec(`{ "domain": { "rules": [] } }`);
    expect(s).toBeNull();
  });

  it("silently drops a malformed sub-field but keeps the rest", () => {
    const s = parsePrdSpec(
      withDomain(`{
        "rules": "not an array",
        "alerts": [{ "id": "a1", "description": "x", "trigger": "y" }]
      }`),
    );
    expect(s?.domain?.rules).toBeUndefined();
    expect(s?.domain?.alerts).toHaveLength(1);
  });
});
