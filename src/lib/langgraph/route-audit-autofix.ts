/**
 * Deterministic route-audit auto-fix.
 *
 * The route audit (`auditApiRouteRegistration` in supervisor.ts) detects
 * a recurring failure pattern that is mechanical, not creative:
 *
 *   **Unregistered modules** — a `*.routes.ts` file exports
 *   `register<X>Routes(apiRouter)` but `backend/src/api/modules/index.ts`
 *   never imports + calls it. Cause: workers split route generation
 *   across roles and the aggregator was someone else's task.
 *
 * Historically the supervisor surfaced these as HARD FAIL findings and let
 * the integration-verify-fix worker iterate to convergence. That cost ~$1
 * per run in LLM tokens. This module patches the aggregator
 * deterministically — same philosophy as `autoAppendMissingScopedEndpoints`
 * (contract holes) and `injectBaselineEndpoints` (implicit /auth, /health).
 * The pure helper is a string→string transform so it unit-tests cleanly
 * without IO.
 *
 * Earlier this module also exported `pinApiRouterPrefix` to rewrite
 * `new Router({ prefix: "/api" })` → `new Router({ prefix: "/api/v1" })`
 * when contracts used the versioned prefix. The replay harness revealed
 * that most real backends inject the `/v1/...` segment via a SUB-router
 * prefix inside the routes file, so blindly bumping the apiRouter prefix
 * produced double-versioned paths like `/api/v1/v1/foo`. The audit
 * parser was fixed instead to recognize sub-router prefixes, removing
 * the phantom findings without the regression risk; that codemod is
 * gone.
 */

import path from "node:path";

export interface RegistrationToWire {
  /** The `register<X>Routes` name exported by the routes.ts file. */
  exportName: string;
  /** Import specifier relative to the index.ts file (no extension). */
  importPath: string;
}

export interface WireResult {
  /** New file content. Same as input when nothing was wired. */
  content: string;
  /** Names successfully wired in. */
  wired: string[];
  /** Skipped entries with reason (e.g. already present, malformed export name). */
  skipped: Array<{ exportName: string; reason: string }>;
}

/**
 * Pure transform: append missing register*Routes imports + calls to an
 * existing api modules `index.ts` content. Idempotent — names already
 * imported/called are skipped.
 *
 * The function appends to the END of the import group (after the last
 * `import ... from "..."` line) and inserts calls right BEFORE the first
 * `return apiRouter;` line (or before the final `}` of the function if
 * no return is found). The exact insertion point matches the scaffold's
 * `createApiRouter()` template so the generated diff stays readable.
 */
export function wireRegistrationsIntoIndex(
  indexContent: string,
  registrations: RegistrationToWire[],
): WireResult {
  if (registrations.length === 0) {
    return { content: indexContent, wired: [], skipped: [] };
  }

  // Skip empty / malformed names defensively.
  const valid: RegistrationToWire[] = [];
  const skipped: WireResult["skipped"] = [];
  for (const r of registrations) {
    if (!/^register[A-Z]\w*Routes$/.test(r.exportName)) {
      skipped.push({
        exportName: r.exportName,
        reason: "exportName does not match register<X>Routes pattern",
      });
      continue;
    }
    if (!r.importPath || /[\s'"`]/.test(r.importPath)) {
      skipped.push({
        exportName: r.exportName,
        reason: "importPath is empty or contains whitespace/quotes",
      });
      continue;
    }
    valid.push(r);
  }
  if (valid.length === 0) {
    return { content: indexContent, wired: [], skipped };
  }

  // Detect existing imports + calls so we stay idempotent.
  const callRe = /(register[A-Z]\w*Routes)\s*\(/g;
  const calledNames = new Set<string>();
  let cm: RegExpExecArray | null;
  while ((cm = callRe.exec(indexContent)) !== null) {
    calledNames.add(cm[1]);
  }
  const importedNames = new Set<string>();
  const importRe = /import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g;
  let im: RegExpExecArray | null;
  while ((im = importRe.exec(indexContent)) !== null) {
    for (const piece of im[1].split(",")) {
      const name = piece.trim().split(/\s+as\s+/)[0].trim();
      if (name) importedNames.add(name);
    }
  }

  const toWire: RegistrationToWire[] = [];
  for (const r of valid) {
    if (calledNames.has(r.exportName)) {
      skipped.push({
        exportName: r.exportName,
        reason: "already called in index.ts",
      });
      continue;
    }
    toWire.push(r);
  }
  if (toWire.length === 0) {
    return { content: indexContent, wired: [], skipped };
  }

  // Determine which calls use as their argument by sampling the first
  // existing register*Routes call. Default to `apiRouter` (scaffold default)
  // when no prior call exists.
  const sampleCallMatch = indexContent.match(
    /register[A-Z]\w*Routes\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/,
  );
  const routerArg = sampleCallMatch?.[1] ?? "apiRouter";

  // Build import lines (skip ones already imported by name).
  const importLines: string[] = [];
  for (const r of toWire) {
    if (importedNames.has(r.exportName)) continue;
    importLines.push(
      `import { ${r.exportName} } from "${r.importPath}";`,
    );
  }
  // Build call lines.
  const callLines = toWire.map((r) => `  ${r.exportName}(${routerArg});`);

  // Insert imports after the last existing import line.
  let content = indexContent;
  const importBlockRe = /(?:^|\n)import [^;]+;\s*/g;
  let lastImportEnd = -1;
  let mLast: RegExpExecArray | null;
  while ((mLast = importBlockRe.exec(content)) !== null) {
    lastImportEnd = mLast.index + mLast[0].length;
  }
  if (importLines.length > 0) {
    if (lastImportEnd >= 0) {
      content =
        content.slice(0, lastImportEnd) +
        importLines.join("\n") +
        "\n" +
        content.slice(lastImportEnd);
    } else {
      // No imports at all — prepend.
      content = importLines.join("\n") + "\n\n" + content;
    }
  }

  // Insert call lines before `return apiRouter;` (preferred) or before
  // the closing brace of the function that contains the apiRouter var.
  const returnRe = /\n([ \t]*)return\s+apiRouter\s*;/;
  const returnMatch = content.match(returnRe);
  if (returnMatch && returnMatch.index !== undefined) {
    const indent = returnMatch[1] ?? "  ";
    const insertion =
      callLines.map((l) => l.replace(/^ {2}/, indent)).join("\n") + "\n";
    content =
      content.slice(0, returnMatch.index + 1) +
      insertion +
      content.slice(returnMatch.index + 1);
  } else {
    // Fall back: append before the last `}` that closes the createApiRouter
    // function. We do a conservative regex — if the function isn't found,
    // we skip the calls so we never produce broken code.
    const fnEndRe = /\n(\}\s*)$/;
    if (fnEndRe.test(content)) {
      content = content.replace(fnEndRe, `\n${callLines.join("\n")}\n$1`);
    } else {
      for (const r of toWire) {
        skipped.push({
          exportName: r.exportName,
          reason:
            "could not find `return apiRouter;` or function close brace — skipped to avoid corrupting file",
        });
      }
      return {
        content: indexContent,
        wired: [],
        skipped,
      };
    }
  }

  return {
    content,
    wired: toWire.map((r) => r.exportName),
    skipped,
  };
}

/**
 * Compute the import specifier relative to the index.ts file for a given
 * routes.ts path. Both paths are relative to outputDir. Returns the
 * extensionless module specifier.
 *
 *   indexFile:  backend/src/api/modules/index.ts
 *   routesFile: backend/src/api/modules/auth/auth.routes.ts
 *   → "./auth/auth.routes"
 *
 *   indexFile:  backend/src/api/modules/index.ts
 *   routesFile: backend/src/api/modules/analytics/analytics.routes.ts
 *   → "./analytics/analytics.routes"
 */
export function computeRelativeImportPath(
  indexFile: string,
  routesFile: string,
): string {
  const indexDir = path.posix.dirname(indexFile.split(path.sep).join("/"));
  const routesPosix = routesFile.split(path.sep).join("/");
  const noExt = routesPosix.replace(/\.[tj]sx?$/, "");
  const rel = path.posix.relative(indexDir, noExt);
  return rel.startsWith(".") ? rel : `./${rel}`;
}
