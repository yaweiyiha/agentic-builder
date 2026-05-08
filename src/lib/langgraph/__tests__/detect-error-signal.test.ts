/**
 * Tests for detectErrorSignalForRecall — the lightweight scanner that
 * decides whether the worker loop should fire a second-pass memory recall.
 */

import { describe, expect, it } from "vitest";

import { detectErrorSignalForRecall } from "../agent-subgraph";

describe("detectErrorSignalForRecall", () => {
  it("returns null when neither model nor tool output looks like an error", () => {
    expect(detectErrorSignalForRecall("Plan: 1. read 2. write", [])).toBeNull();
    expect(
      detectErrorSignalForRecall(
        "I'll proceed to implement the feature.",
        ["src/index.ts\nsrc/app.ts"],
      ),
    ).toBeNull();
  });

  it("classifies a TS compile error in tool output", () => {
    const r = detectErrorSignalForRecall("", [
      "src/app.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
    ]);
    expect(r).not.toBeNull();
    expect(r?.mode).toBe("compile-error");
    expect(r?.snippet).toMatch(/TS2322/);
  });

  it("classifies a TypeError in model content", () => {
    const r = detectErrorSignalForRecall(
      "I see this throws TypeError: x is not a function on line 12.",
      [],
    );
    expect(r).not.toBeNull();
    expect(r?.mode).toBe("type-error");
  });

  it("model content takes precedence over tool output when both have signals", () => {
    const r = detectErrorSignalForRecall(
      "TypeError detected in handler.",
      ["fetch failed: ECONNREFUSED"],
    );
    expect(r?.mode).toBe("type-error");
  });

  it("snippet is bounded to 400 chars", () => {
    const long = "x".repeat(2000) + " TypeError: oops";
    const r = detectErrorSignalForRecall("", [long]);
    expect(r?.snippet.length).toBeLessThanOrEqual(400);
  });
});
