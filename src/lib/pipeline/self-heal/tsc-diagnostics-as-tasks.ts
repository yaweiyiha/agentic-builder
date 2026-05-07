/**
 * tsc-diagnostics-as-tasks (CODEGEN_HARDENING_PLAN.md §4.x — P5 from FIX_PLAN).
 *
 * Runs `tsc --noEmit` against the generated backend/frontend workspaces and
 * translates each diagnostic line into a deterministic repair task so the
 * verify-fix worker can act on them without re-deriving the error from
 * raw output.
 *
 * Why this exists:
 *   - The verify-fix worker tends to spend turns "reading the file to
 *     reconstruct the type error". `tsc` already knows the file, line,
 *     column, and exact diagnostic — feed that in pre-cooked.
 *   - In the previous run, the `scanOrchestrator.ts` cluster had ~11 TS
 *     errors that were all DTO-field-shape mismatches; with this module
 *     each one becomes a single line of `pendingRepairTasks`.
 *
 * Output:
 *   - In-memory `TscDiagnosticsResult` returned to the caller.
 *   - `<outputDir>/.ralph/tsc-diagnostics.json` for the next worker turn.
 *
 * Cost: ~5–15s per workspace. Skip when `BLUEPRINT_DISABLE_TSC_DIAGNOSTICS=1`.
 */

import path from "path";
import { fsRead, fsWrite, shellExec } from "@/lib/langgraph/tools";
import type { RepairEmitter } from "./events";

export interface TscDiagnosticTask {
  /** Stable id so the verify-fix worker can dedupe across turns. */
  id: string;
  workspace: "backend" | "frontend";
  /** Path relative to the workspace root (e.g. `src/services/foo.ts`). */
  file: string;
  line: number;
  column: number;
  /** Raw TS error code, e.g. "TS2554". */
  code: string;
  /** Original tsc message. */
  message: string;
  /** Imperative directive for the worker. */
  directive: string;
}

export interface TscDiagnosticsResult {
  ran: boolean;
  workspaces: Array<{
    workspace: "backend" | "frontend";
    skipped: boolean;
    skipReason?: string;
    exitCode: number;
    diagnosticCount: number;
  }>;
  tasks: TscDiagnosticTask[];
}

export interface TscDiagnosticsInput {
  outputDir: string;
  emitter?: RepairEmitter;
  sessionId?: string;
  /** Override workspaces to scan. Defaults to ["backend", "frontend"] (skipping the ones without package.json). */
  workspaces?: Array<"backend" | "frontend">;
}

const PERSIST_REL = path.join(".ralph", "tsc-diagnostics.json");
const TSC_TIMEOUT_MS = 90_000;

// Groups: 1=file, 2=line, 3=col, 4=code, 5=message. (Numeric captures so the
// regex stays compatible with this project's older TS target — named groups
// require ES2018+.)
const TSC_LINE_RE =
  /^([^()]+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/;

/**
 * Per-error-code repair directives. Mapped to the most common cause we've
 * seen in generator runs. The default fallback re-states the message so
 * the worker still has something concrete.
 */
function directiveFor(code: string, message: string): string {
  switch (code) {
    case "TS2554":
      return (
        "Function called with the wrong number of arguments. EITHER (a) update " +
        "the call site to match the declared signature exactly, OR (b) widen " +
        "the function declaration to accept the new positional arguments. Pick " +
        "ONE — do not rely on `as any`. Original: " +
        message
      );
    case "TS2305":
      return (
        "Module is missing the named export. EITHER add the export to the " +
        "source module, OR remove/rename the import. If this is a re-exported " +
        "type from `types/shared.ts`, also confirm the file has a local " +
        "`import type { ... }` so the symbol is in scope (re-exporting alone " +
        "does NOT make the type visible inside the file). Original: " +
        message
      );
    case "TS2304":
      return (
        "Symbol referenced but not imported. Add the missing `import` " +
        "statement. Common case: a `export type { Foo }` re-export at the top " +
        "of `types/shared.ts` does NOT bring `Foo` into the file's scope — " +
        "add `import type { Foo } from '../models/Whatever'` alongside. " +
        "Original: " +
        message
      );
    case "TS2353":
      return (
        "Object literal contains a property the target type does not declare. " +
        "EITHER remove the surplus property, OR add the property to the type " +
        "(after confirming API_CONTRACTS.json wants it). Never silence with " +
        "`as any`. Original: " +
        message
      );
    case "TS2322":
      return (
        "Type assignment mismatch. Walk through the source and target types " +
        "field-by-field — most often a DTO factory built `{ a, b, c }` but " +
        "the typed target requires `{ a, b, c, d }` (one missing field) or " +
        "named the field differently (`expiration_date` vs `expiry`). Map " +
        "field names against the canonical interface in `types/api.ts` (or " +
        "the equivalent contract type) and patch the factory. Original: " +
        message
      );
    case "TS2741":
      return (
        "Property required by the target type is missing on the source. " +
        "Add the field to the source factory, using the canonical DTO in " +
        "`types/api.ts` as the source of truth. Original: " +
        message
      );
    case "TS2345":
      return (
        "Argument type does not match the parameter type. Two common causes: " +
        "(a) you passed an object where the API expects a sub-property of it " +
        "(e.g. `getMetaAndAssetCtxs()` returns `{ universe }`, but " +
        "`fuzzyMatchEntity` expects the bare array — pass `.universe`); " +
        "(b) the function returns `Promise<T>` and you forgot `await`, so a " +
        "promise lands where `T` was wanted. Inspect the call site. Original: " +
        message
      );
    case "TS2488":
      return (
        "Tried to iterate (`for…of`) something that is not iterable. Almost " +
        "always a missing `await` on a function that returns `Promise<T[]>`. " +
        "Add the `await`. Original: " +
        message
      );
    case "TS2339":
      return (
        "Property does not exist on the type. Either fix the typo, or — if " +
        "you see something like `result.length` on a `Promise<T[]>` — add " +
        "the missing `await`. Original: " +
        message
      );
    default:
      return `tsc reported \`${code}\`. Original: ${message}`;
  }
}

function makeTaskId(
  workspace: string,
  file: string,
  line: number,
  code: string,
): string {
  return `${workspace}|${file}|${line}|${code}`;
}

async function workspaceHasTypescript(
  outputDir: string,
  workspace: "backend" | "frontend",
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const pkg = await fsRead(`${workspace}/package.json`, outputDir);
  if (pkg.startsWith("FILE_NOT_FOUND") || pkg.startsWith("REJECTED")) {
    return { ok: false, reason: `${workspace}/package.json not present` };
  }
  if (!/"typescript"\s*:/.test(pkg)) {
    return { ok: false, reason: `${workspace} has no typescript devDep` };
  }
  const tsconfig = await fsRead(`${workspace}/tsconfig.json`, outputDir);
  if (tsconfig.startsWith("FILE_NOT_FOUND") || tsconfig.startsWith("REJECTED")) {
    return { ok: false, reason: `${workspace}/tsconfig.json not present` };
  }
  return { ok: true };
}

/**
 * Run `tsc --noEmit` in a workspace. Tries `pnpm exec tsc --noEmit` first,
 * falls back to `npx tsc --noEmit` if pnpm isn't around.
 */
async function runTscInWorkspace(
  outputDir: string,
  workspace: "backend" | "frontend",
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cwd = path.join(outputDir, workspace);
  const cmds = ["pnpm exec tsc --noEmit", "npx tsc --noEmit"];
  let last: { stdout: string; stderr: string; exitCode: number } = {
    stdout: "",
    stderr: "tsc not invoked",
    exitCode: -1,
  };
  for (const cmd of cmds) {
    last = await shellExec(cmd, cwd, { timeout: TSC_TIMEOUT_MS });
    if (!last.stderr.startsWith("REJECTED:")) return last;
  }
  return last;
}

function parseDiagnostics(
  workspace: "backend" | "frontend",
  output: string,
): TscDiagnosticTask[] {
  const lines = output.split(/\r?\n/);
  const out: TscDiagnosticTask[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const m = TSC_LINE_RE.exec(line);
    if (!m) continue;
    const file = m[1].trim();
    const lineNo = Number(m[2]);
    const colNo = Number(m[3]);
    const code = m[4];
    const message = m[5].trim();
    if (!Number.isFinite(lineNo) || !Number.isFinite(colNo)) continue;
    out.push({
      id: makeTaskId(workspace, file, lineNo, code),
      workspace,
      file,
      line: lineNo,
      column: colNo,
      code,
      message,
      directive: directiveFor(code, message),
    });
  }
  // Dedupe by stable id (some tsc versions print continuation lines).
  const seen = new Set<string>();
  return out.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

export async function runTscDiagnosticsAsTasks(
  input: TscDiagnosticsInput,
): Promise<TscDiagnosticsResult> {
  const { outputDir, emitter, sessionId } = input;
  const targets = input.workspaces ?? ["backend", "frontend"];

  const workspaces: TscDiagnosticsResult["workspaces"] = [];
  const tasks: TscDiagnosticTask[] = [];

  for (const workspace of targets) {
    const eligibility = await workspaceHasTypescript(outputDir, workspace);
    if (!eligibility.ok) {
      workspaces.push({
        workspace,
        skipped: true,
        skipReason: eligibility.reason,
        exitCode: 0,
        diagnosticCount: 0,
      });
      continue;
    }

    const result = await runTscInWorkspace(outputDir, workspace);
    const combined = `${result.stdout}\n${result.stderr}`;
    const diagnostics = parseDiagnostics(workspace, combined);
    tasks.push(...diagnostics);
    workspaces.push({
      workspace,
      skipped: false,
      exitCode: result.exitCode,
      diagnosticCount: diagnostics.length,
    });
  }

  const result: TscDiagnosticsResult = {
    ran: true,
    workspaces,
    tasks,
  };

  try {
    const persistRel = PERSIST_REL.split(path.sep).join("/");
    await fsWrite(
      persistRel,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          sessionId,
          ...result,
        },
        null,
        2,
      ),
      outputDir,
    );
  } catch (err) {
    console.warn(
      `[tsc-diagnostics-as-tasks] failed to persist report: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (emitter) {
    emitter({
      stage: "preflight-route-audit",
      sessionId,
      event: "tsc_diagnostics_snapshot",
      details: {
        workspaces: workspaces.map((w) => ({
          workspace: w.workspace,
          skipped: w.skipped,
          diagnosticCount: w.diagnosticCount,
        })),
        totalDiagnostics: tasks.length,
        byCode: tasks.reduce<Record<string, number>>((acc, t) => {
          acc[t.code] = (acc[t.code] ?? 0) + 1;
          return acc;
        }, {}),
      },
    });
  }

  return result;
}
