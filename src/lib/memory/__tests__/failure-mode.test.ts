/**
 * Tests for the regex-based failure-mode classifier.
 */

import { describe, expect, it } from "vitest";
import { classifyFailureMode } from "../distill/failure-mode";

describe("classifyFailureMode", () => {
  it("returns 'unknown' when message is missing or empty", () => {
    expect(classifyFailureMode(undefined)).toBe("unknown");
    expect(classifyFailureMode(null)).toBe("unknown");
    expect(classifyFailureMode("")).toBe("unknown");
  });

  it("classifies tsc / TS-code errors as compile-error", () => {
    expect(
      classifyFailureMode(
        "src/app.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      ),
    ).toBe("compile-error");
    expect(classifyFailureMode("SyntaxError: unexpected token")).toBe(
      "compile-error",
    );
    expect(classifyFailureMode("build failed: tsc exited 1")).toBe(
      "compile-error",
    );
  });

  it("classifies type assignment as type-error when no TS-code prefix", () => {
    // 'is not assignable to' alone, no TS code → falls into type-error
    expect(
      classifyFailureMode(
        "Argument of type 'X' is not assignable to parameter of type 'Y'.",
      ),
    ).toBe("type-error");
    expect(
      classifyFailureMode("Property 'foo' does not exist on type 'Bar'."),
    ).toBe("type-error");
    expect(classifyFailureMode("TypeError: x is not a function")).toBe(
      "type-error",
    );
  });

  it("classifies network/HTTP errors as api-error", () => {
    expect(classifyFailureMode("fetch failed")).toBe("api-error");
    expect(classifyFailureMode("ECONNREFUSED 127.0.0.1:5432")).toBe(
      "api-error",
    );
    expect(classifyFailureMode("Request returned HTTP 500 Internal Server Error")).toBe(
      "api-error",
    );
  });

  it("classifies timeouts", () => {
    expect(classifyFailureMode("operation timed out after 30s")).toBe("timeout");
    expect(classifyFailureMode("ETIMEDOUT")).toBe("timeout");
  });

  it("classifies permission errors and not-found", () => {
    expect(classifyFailureMode("EACCES: permission denied")).toBe(
      "permission-error",
    );
    expect(classifyFailureMode("HTTP 403 Forbidden")).toBe("permission-error");
    expect(classifyFailureMode("ENOENT: no such file or directory")).toBe(
      "not-found",
    );
    expect(classifyFailureMode("Cannot find module '@/foo'")).toBe("not-found");
  });

  it("classifies validation errors", () => {
    expect(classifyFailureMode("ZodError: required field missing")).toBe(
      "validation-error",
    );
    expect(classifyFailureMode("Schema mismatch on field user.email")).toBe(
      "validation-error",
    );
  });

  it("classifies plain JS runtime errors", () => {
    expect(classifyFailureMode("ReferenceError: foo is not defined")).toBe(
      "runtime-error",
    );
    expect(
      classifyFailureMode("Cannot read properties of undefined (reading 'x')"),
    ).toBe("runtime-error");
  });

  it("falls through to 'unknown' for unmatched messages", () => {
    expect(classifyFailureMode("something weird happened")).toBe("unknown");
  });
});
