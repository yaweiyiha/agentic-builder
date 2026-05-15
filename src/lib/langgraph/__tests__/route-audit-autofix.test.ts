/**
 * Tests for route-audit-autofix — the pure transforms that wire missing
 * register*Routes into index.ts and pin the apiRouter prefix to match the
 * contract.
 */

import { describe, expect, it } from "vitest";
import {
  computeRelativeImportPath,
  wireRegistrationsIntoIndex,
} from "../route-audit-autofix";

const SCAFFOLD_INDEX = `import Router from "@koa/router";
import { registerHealthRoutes } from "./health/health.routes";
import { registerAuthRoutes } from "./auth/auth.routes";

export function createApiRouter(): Router {
  const apiRouter = new Router({ prefix: "/api" });

  registerHealthRoutes(apiRouter);
  registerAuthRoutes(apiRouter);

  return apiRouter;
}
`;

describe("wireRegistrationsIntoIndex", () => {
  it("appends import + call for an unregistered module", () => {
    const r = wireRegistrationsIntoIndex(SCAFFOLD_INDEX, [
      {
        exportName: "registerAnalyticsRoutes",
        importPath: "./analytics/analytics.routes",
      },
    ]);
    expect(r.wired).toEqual(["registerAnalyticsRoutes"]);
    expect(r.skipped).toEqual([]);
    expect(r.content).toContain(
      `import { registerAnalyticsRoutes } from "./analytics/analytics.routes";`,
    );
    expect(r.content).toContain("registerAnalyticsRoutes(apiRouter);");
  });

  it("places the new call BEFORE `return apiRouter;`", () => {
    const r = wireRegistrationsIntoIndex(SCAFFOLD_INDEX, [
      {
        exportName: "registerMonitorRoutes",
        importPath: "./monitor/monitor.routes",
      },
    ]);
    const callIdx = r.content.indexOf("registerMonitorRoutes(apiRouter);");
    const returnIdx = r.content.indexOf("return apiRouter;");
    expect(callIdx).toBeGreaterThan(-1);
    expect(returnIdx).toBeGreaterThan(callIdx);
  });

  it("wires multiple registrations in one pass", () => {
    const r = wireRegistrationsIntoIndex(SCAFFOLD_INDEX, [
      {
        exportName: "registerMonitorRoutes",
        importPath: "./monitor/monitor.routes",
      },
      {
        exportName: "registerStablecoinsRoutes",
        importPath: "./stablecoins/stablecoins.routes",
      },
    ]);
    expect(r.wired).toEqual([
      "registerMonitorRoutes",
      "registerStablecoinsRoutes",
    ]);
    expect(r.content).toContain("registerMonitorRoutes(apiRouter);");
    expect(r.content).toContain("registerStablecoinsRoutes(apiRouter);");
  });

  it("is idempotent — re-running wires nothing new", () => {
    const first = wireRegistrationsIntoIndex(SCAFFOLD_INDEX, [
      {
        exportName: "registerMonitorRoutes",
        importPath: "./monitor/monitor.routes",
      },
    ]);
    const second = wireRegistrationsIntoIndex(first.content, [
      {
        exportName: "registerMonitorRoutes",
        importPath: "./monitor/monitor.routes",
      },
    ]);
    expect(second.wired).toEqual([]);
    expect(second.skipped[0]?.reason).toMatch(/already called/);
    expect(second.content).toBe(first.content);
  });

  it("skips an empty registration list", () => {
    const r = wireRegistrationsIntoIndex(SCAFFOLD_INDEX, []);
    expect(r.wired).toEqual([]);
    expect(r.content).toBe(SCAFFOLD_INDEX);
  });

  it("rejects malformed export names", () => {
    const r = wireRegistrationsIntoIndex(SCAFFOLD_INDEX, [
      { exportName: "notRegisterFoo", importPath: "./foo/foo.routes" },
    ]);
    expect(r.wired).toEqual([]);
    expect(r.skipped[0]?.reason).toMatch(/register<X>Routes pattern/);
  });

  it("rejects import paths with whitespace or quotes", () => {
    const r = wireRegistrationsIntoIndex(SCAFFOLD_INDEX, [
      {
        exportName: "registerFooRoutes",
        importPath: './foo/foo".routes',
      },
    ]);
    expect(r.wired).toEqual([]);
    expect(r.skipped[0]?.reason).toMatch(/whitespace|quotes/);
  });

  it("uses the same router arg as existing calls", () => {
    const customIndex = `import Router from "@koa/router";
import { registerHealthRoutes } from "./health/health.routes";

export function createApiRouter(): Router {
  const v1Router = new Router({ prefix: "/api/v1" });

  registerHealthRoutes(v1Router);

  return v1Router;
}
`;
    const r = wireRegistrationsIntoIndex(customIndex, [
      { exportName: "registerAuthRoutes", importPath: "./auth/auth.routes" },
    ]);
    // The function returns `v1Router` (not `apiRouter`), so the fallback
    // insertion point ("before `return apiRouter;`") doesn't match; the
    // safety net should kick in and skip rather than produce broken code.
    // The exact behaviour: register call uses the same arg as the sample
    // (`v1Router`), even though we couldn't find the conventional return.
    expect(r.content).toContain("registerAuthRoutes(v1Router);");
  });

  it("does not produce duplicate imports if name already imported", () => {
    // Edge case: import line present but call line missing (e.g. someone
    // partially wired it). We should add the call without re-importing.
    const partial = `import Router from "@koa/router";
import { registerHealthRoutes } from "./health/health.routes";
import { registerMonitorRoutes } from "./monitor/monitor.routes";

export function createApiRouter(): Router {
  const apiRouter = new Router({ prefix: "/api" });

  registerHealthRoutes(apiRouter);

  return apiRouter;
}
`;
    const r = wireRegistrationsIntoIndex(partial, [
      {
        exportName: "registerMonitorRoutes",
        importPath: "./monitor/monitor.routes",
      },
    ]);
    expect(r.wired).toEqual(["registerMonitorRoutes"]);
    expect(r.content.match(/import \{ registerMonitorRoutes \}/g) ?? []).toHaveLength(1);
    expect(r.content).toContain("registerMonitorRoutes(apiRouter);");
  });
});

describe("computeRelativeImportPath", () => {
  it("returns ./<dir>/<name>.routes for a sibling module", () => {
    expect(
      computeRelativeImportPath(
        "backend/src/api/modules/index.ts",
        "backend/src/api/modules/analytics/analytics.routes.ts",
      ),
    ).toBe("./analytics/analytics.routes");
  });

  it("works for flat modules without a subdirectory", () => {
    expect(
      computeRelativeImportPath(
        "backend/src/api/modules/index.ts",
        "backend/src/api/modules/health.routes.ts",
      ),
    ).toBe("./health.routes");
  });

  it("strips .ts and .tsx extensions", () => {
    expect(
      computeRelativeImportPath(
        "backend/src/api/modules/index.ts",
        "backend/src/api/modules/foo/foo.routes.tsx",
      ),
    ).toBe("./foo/foo.routes");
  });
});
