/**
 * Tests for baseline endpoint injection — covers prefix detection,
 * auth-surface gating, dedup, and the actual baseline contents.
 */

import { describe, expect, it } from "vitest";
import {
  injectBaselineEndpoints,
  detectContractPrefix,
  type ApiContractEntry,
} from "../baseline-endpoints";

function contract(
  partial: Partial<ApiContractEntry> & {
    method: string;
    endpoint: string;
  },
): ApiContractEntry {
  return {
    service: partial.service ?? "x",
    description: "test",
    prdJustification: "test",
    audience: "user",
    requestSchema: "none",
    responseSchema: "none",
    auth: "none",
    ...partial,
  };
}

describe("detectContractPrefix", () => {
  it("defaults to /api when contracts are empty", () => {
    expect(detectContractPrefix([])).toBe("/api");
  });

  it("detects /api/v1 when most contracts use it", () => {
    const cs = [
      contract({ method: "GET", endpoint: "/api/v1/monitor/summary" }),
      contract({ method: "GET", endpoint: "/api/v1/stablecoins/:id" }),
      contract({ method: "POST", endpoint: "/api/v1/auth/refresh" }),
    ];
    expect(detectContractPrefix(cs)).toBe("/api/v1");
  });

  it("detects bare /api when no version segment is present", () => {
    const cs = [
      contract({ method: "GET", endpoint: "/api/users" }),
      contract({ method: "POST", endpoint: "/api/posts" }),
    ];
    expect(detectContractPrefix(cs)).toBe("/api");
  });

  it("handles mixed prefixes by taking the dominant one", () => {
    const cs = [
      contract({ method: "GET", endpoint: "/api/v1/a" }),
      contract({ method: "GET", endpoint: "/api/v1/b" }),
      contract({ method: "GET", endpoint: "/api/v1/c" }),
      contract({ method: "GET", endpoint: "/api/legacy" }), // outlier
    ];
    // 3/4 = 75% with v1 → exceeds 60% threshold
    expect(detectContractPrefix(cs)).toBe("/api/v1");
  });

  it("falls back to /api when no prefix exceeds the 60% threshold", () => {
    const cs = [
      contract({ method: "GET", endpoint: "/api/v1/a" }),
      contract({ method: "GET", endpoint: "/api/v2/b" }),
      contract({ method: "GET", endpoint: "/api/v3/c" }),
    ];
    expect(detectContractPrefix(cs)).toBe("/api");
  });
});

describe("injectBaselineEndpoints — auth surface gating", () => {
  it("injects auth baselines when LLM emitted any auth contract", () => {
    const r = injectBaselineEndpoints({
      contracts: [
        contract({
          service: "auth",
          method: "POST",
          endpoint: "/api/v1/auth/refresh",
        }),
      ],
      hasAuthRoutes: false,
    });
    expect(r.added).toContain("POST /api/v1/auth/login");
    expect(r.added).toContain("GET /api/v1/auth/me");
    expect(r.added).toContain("POST /api/v1/auth/logout");
    expect(r.added).not.toContain("POST /api/v1/auth/refresh"); // dedup
  });

  it("injects auth baselines when scaffold ships auth.routes.ts", () => {
    const r = injectBaselineEndpoints({
      contracts: [
        contract({ method: "GET", endpoint: "/api/v1/monitor/summary" }),
      ],
      hasAuthRoutes: true,
    });
    expect(r.added).toContain("POST /api/v1/auth/login");
  });

  it("skips auth baselines when neither contracts nor scaffold mention auth", () => {
    const r = injectBaselineEndpoints({
      contracts: [
        contract({ method: "GET", endpoint: "/api/items" }),
      ],
      hasAuthRoutes: false,
    });
    expect(r.added.filter((s) => s.includes("auth"))).toEqual([]);
    expect(r.skipped.length).toBeGreaterThan(0);
    expect(
      r.skipped.every((s) => s.reason === "no auth surface detected"),
    ).toBe(true);
  });
});

describe("injectBaselineEndpoints — health always", () => {
  it("injects /health regardless of auth state", () => {
    const r = injectBaselineEndpoints({
      contracts: [contract({ method: "GET", endpoint: "/api/items" })],
      hasAuthRoutes: false,
    });
    expect(r.added).toContain("GET /api/health");
  });

  it("skips /health when LLM already emitted it", () => {
    const r = injectBaselineEndpoints({
      contracts: [contract({ method: "GET", endpoint: "/api/health" })],
      hasAuthRoutes: false,
    });
    expect(r.added).not.toContain("GET /api/health");
    expect(r.skipped.find((s) => s.id === "GET /api/health")).toBeDefined();
  });
});

describe("injectBaselineEndpoints — content correctness", () => {
  it("login has email/password request and token+user response", () => {
    const r = injectBaselineEndpoints({
      contracts: [contract({ service: "auth", method: "POST", endpoint: "/api/auth/refresh" })],
      hasAuthRoutes: false,
    });
    const login = r.contracts.find(
      (c) => c.endpoint === "/api/auth/login" && c.method === "POST",
    );
    expect(login).toBeDefined();
    expect(login?.requestSchema).toContain("email");
    expect(login?.requestSchema).toContain("password");
    expect(login?.responseSchema).toContain("accessToken");
    expect(login?.responseSchema).toContain("refreshToken");
    expect(login?.auth).toBe("none");
    expect(login?.prdJustification).toMatch(/BASELINE/);
  });

  it("logout requires bearer auth", () => {
    const r = injectBaselineEndpoints({
      contracts: [contract({ service: "auth", method: "POST", endpoint: "/api/auth/refresh" })],
      hasAuthRoutes: false,
    });
    const logout = r.contracts.find((c) => c.endpoint === "/api/auth/logout");
    expect(logout?.auth).toBe("bearer");
  });

  it("/auth/me requires bearer auth and returns user", () => {
    const r = injectBaselineEndpoints({
      contracts: [contract({ service: "auth", method: "POST", endpoint: "/api/auth/refresh" })],
      hasAuthRoutes: false,
    });
    const me = r.contracts.find((c) => c.endpoint === "/api/auth/me");
    expect(me?.auth).toBe("bearer");
    expect(me?.method).toBe("GET");
    expect(me?.responseSchema).toContain("user");
  });

  it("prefix tracking: with /api/v1 contracts, login endpoint is /api/v1/auth/login", () => {
    const r = injectBaselineEndpoints({
      contracts: [
        contract({ service: "auth", method: "POST", endpoint: "/api/v1/auth/refresh" }),
        contract({ method: "GET", endpoint: "/api/v1/monitor/summary" }),
      ],
      hasAuthRoutes: false,
    });
    const login = r.contracts.find((c) => c.endpoint.includes("/auth/login"));
    expect(login?.endpoint).toBe("/api/v1/auth/login");
  });
});

describe("injectBaselineEndpoints — preserves originals", () => {
  it("returns all original LLM contracts unchanged", () => {
    const orig = [
      contract({ service: "auth", method: "POST", endpoint: "/api/v1/auth/refresh" }),
      contract({ method: "GET", endpoint: "/api/v1/monitor/summary" }),
    ];
    const r = injectBaselineEndpoints({
      contracts: orig,
      hasAuthRoutes: false,
    });
    for (const orig_c of orig) {
      const found = r.contracts.find(
        (c) => c.method === orig_c.method && c.endpoint === orig_c.endpoint,
      );
      expect(found).toEqual(orig_c);
    }
  });

  it("idempotent: running twice produces the same result", () => {
    const orig = [
      contract({ service: "auth", method: "POST", endpoint: "/api/v1/auth/refresh" }),
    ];
    const first = injectBaselineEndpoints({
      contracts: orig,
      hasAuthRoutes: false,
    });
    const second = injectBaselineEndpoints({
      contracts: first.contracts,
      hasAuthRoutes: false,
    });
    expect(second.added).toEqual([]);
    expect(second.contracts.length).toBe(first.contracts.length);
  });
});
