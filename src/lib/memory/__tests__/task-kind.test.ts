/**
 * Tests for inferTaskKind — stepId → coarse task kind mapping.
 */

import { describe, expect, it } from "vitest";
import { bucketKey, inferTaskKind } from "../distill/task-kind";

describe("inferTaskKind", () => {
  it("returns 'other' for missing/empty input", () => {
    expect(inferTaskKind(undefined)).toBe("other");
    expect(inferTaskKind(null)).toBe("other");
    expect(inferTaskKind("")).toBe("other");
  });

  it("maps intent / classification stepIds", () => {
    expect(inferTaskKind("intent")).toBe("intent");
    expect(inferTaskKind("brief")).toBe("intent");
    expect(inferTaskKind("classification")).toBe("intent");
  });

  it("maps PRD / TRD / design stepIds", () => {
    expect(inferTaskKind("prd")).toBe("prd");
    expect(inferTaskKind("requirements-review")).toBe("prd");
    expect(inferTaskKind("trd")).toBe("trd");
    expect(inferTaskKind("system-design")).toBe("trd");
    expect(inferTaskKind("design-tokens")).toBe("design");
    expect(inferTaskKind("pencil-sync")).toBe("design");
  });

  it("maps qa / verify / kickoff stepIds", () => {
    expect(inferTaskKind("qa")).toBe("qa");
    expect(inferTaskKind("verify")).toBe("verify");
    expect(inferTaskKind("verifier-pass")).toBe("verify");
    expect(inferTaskKind("kickoff")).toBe("kickoff");
    expect(inferTaskKind("task-breakdown")).toBe("kickoff");
    expect(inferTaskKind("scaffold-copy")).toBe("kickoff");
  });

  it("maps codegen / self-heal / test stepIds", () => {
    expect(inferTaskKind("coding")).toBe("codegen");
    expect(inferTaskKind("worker-frontend-task-3")).toBe("codegen");
    expect(inferTaskKind("self-heal-tsc")).toBe("self-heal");
    expect(inferTaskKind("tsc-fix-attempt-2")).toBe("self-heal");
    expect(inferTaskKind("smoke-gate")).toBe("self-heal");
    expect(inferTaskKind("e2e-suite")).toBe("test");
    expect(inferTaskKind("playwright-run")).toBe("test");
  });

  it("maps report stepIds", () => {
    expect(inferTaskKind("report-summary")).toBe("report");
    expect(inferTaskKind("model-leaderboard")).toBe("report");
  });

  it("falls through to 'other' for unrecognised stepIds", () => {
    expect(inferTaskKind("random-thing-42")).toBe("other");
  });
});

describe("bucketKey", () => {
  it("produces stable, deterministic keys", () => {
    expect(bucketKey("codegen", "type-error", "on")).toBe(
      "codegen|type-error|on",
    );
    expect(bucketKey("qa", "none", "off")).toBe("qa|none|off");
  });
});
