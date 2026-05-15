/**
 * Structured verify/fix tools. Encapsulates common repair actions so the LLM
 * does not need to infer JSON artifacts or validation command sequences.
 */
import fs from "fs/promises";
import path from "path";
import type { OpenRouterToolDefinition } from "@/lib/openrouter";
import { readTddEvidenceSummary } from "@/lib/pipeline/tdd-evidence";
import { runTddRuntimePhase } from "@/lib/pipeline/tdd-runtime-executor";
import {
  detectPackageManager,
  fsRead,
  fsWrite,
  shellExec,
} from "./tools";

const MAX_TOOL_OUTPUT_CHARS = 6000;

const ARTIFACT_PATHS: Record<string, string> = {
  tdd_status: ".ralph/tdd-evidence.jsonl",
  tdd_review: ".ralph/tdd-review.json",
  tdd_evidence: ".ralph/tdd-evidence.jsonl",
  test_manifest: ".ralph/test-manifest.json",
  route_audit: ".ralph/route-audit.json",
  runtime_smoke: ".ralph/runtime-smoke.json",
  runtime_integration_audit: ".ralph/runtime-integration-audit.json",
  tsc_diagnostics: ".ralph/tsc-diagnostics.json",
  migration_coverage: ".ralph/migration-coverage.json",
  contract_usage_coverage: ".ralph/contract-usage-coverage.json",
};

export const STRUCTURED_SUPERVISOR_TOOLS: OpenRouterToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_artifact",
      description:
        "Read a known diagnostic artifact from .ralph and return raw or summarized content.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            enum: Object.keys(ARTIFACT_PATHS),
          },
          format: {
            type: "string",
            enum: ["summary", "raw"],
            description: "summary is preferred for large JSON/JSONL files.",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_validation_suite",
      description:
        "Run structured validation gates without manually composing bash commands.",
      parameters: {
        type: "object",
        properties: {
          suites: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "frontend_tsc",
                "frontend_build",
                "backend_tsc",
                "backend_smoke",
                "tdd_green",
              ],
            },
            description: "Omit to run all available suites.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_patch",
      description:
        "Safely replace an exact text snippet inside one generated-project file. Prefer this over write_file for small edits.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          oldText: { type: "string" },
          newText: { type: "string" },
          replaceAll: { type: "boolean" },
        },
        required: ["path", "oldText", "newText"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description:
        "Delete one generated-project file with path traversal protection. Use only for duplicate or obsolete generated files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_file",
      description:
        "Move or rename one generated-project file with path traversal protection.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          overwrite: { type: "boolean" },
        },
        required: ["from", "to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_many_files",
      description:
        "Read multiple generated-project files in one call, with per-file and total output caps.",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
          },
          maxCharsPerFile: { type: "number" },
        },
        required: ["paths"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tdd_status",
      description:
        "Return structured TDD status: P0/P1/P2 RED/GREEN, reviewer errors, failed commands and evidence excerpts.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

export async function executeStructuredSupervisorTool(input: {
  name: string;
  args: Record<string, unknown>;
  outputDir: string;
}): Promise<string | null> {
  switch (input.name) {
    case "read_artifact":
      return readArtifact(input.outputDir, input.args);
    case "run_validation_suite":
      return runValidationSuite(input.outputDir, input.args);
    case "apply_patch":
      return applyTextPatch(input.outputDir, input.args);
    case "delete_file":
      return deleteFile(input.outputDir, input.args);
    case "move_file":
      return moveFile(input.outputDir, input.args);
    case "read_many_files":
      return readManyFiles(input.outputDir, input.args);
    case "tdd_status":
      return JSON.stringify(await readTddEvidenceSummary(input.outputDir), null, 2).slice(
        0,
        MAX_TOOL_OUTPUT_CHARS,
      );
    default:
      return null;
  }
}

function safePath(outputDir: string, relPath: string): string | null {
  const normalized = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = path.resolve(path.join(outputDir, normalized));
  const root = path.resolve(outputDir);
  if (!abs.startsWith(root + path.sep) && abs !== root) return null;
  return abs;
}

async function readArtifact(
  outputDir: string,
  args: Record<string, unknown>,
): Promise<string> {
  const name = String(args.name ?? "");
  const relPath = ARTIFACT_PATHS[name];
  if (!relPath) return `Error: unknown artifact "${name}"`;
  if (name === "tdd_status" || args.format === "summary") {
    if (name.startsWith("tdd")) {
      return JSON.stringify(await readTddEvidenceSummary(outputDir), null, 2).slice(
        0,
        MAX_TOOL_OUTPUT_CHARS,
      );
    }
  }
  const raw = await fsRead(relPath, outputDir);
  return raw.slice(0, MAX_TOOL_OUTPUT_CHARS);
}

async function runValidationSuite(
  outputDir: string,
  args: Record<string, unknown>,
): Promise<string> {
  const requested = Array.isArray(args.suites)
    ? args.suites.map(String)
    : [
        "frontend_tsc",
        "frontend_build",
        "backend_tsc",
        "backend_smoke",
        "tdd_green",
      ];
  const results: Array<{
    suite: string;
    pass: boolean;
    skipped?: boolean;
    output?: string;
  }> = [];

  const run = async (suite: string, command: string, cwd: string) => {
    const result = await shellExec(command, cwd, { timeout: 120_000 });
    const output = `${result.stdout}${result.stderr}`.trim();
    results.push({
      suite,
      pass: result.exitCode === 0,
      output: output.slice(-1200) || `exit_code=${result.exitCode}`,
    });
  };

  const frontendDir = path.join(outputDir, "frontend");
  const backendDir = path.join(outputDir, "backend");
  const hasFrontend = !(await fsRead("frontend/package.json", outputDir)).startsWith(
    "FILE_NOT_FOUND",
  );
  const hasBackend = !(await fsRead("backend/package.json", outputDir)).startsWith(
    "FILE_NOT_FOUND",
  );

  if (requested.includes("frontend_tsc")) {
    if (hasFrontend) {
      const hasAppTsconfig = !(await fsRead("frontend/tsconfig.app.json", outputDir)).startsWith(
        "FILE_NOT_FOUND",
      );
      await run(
        "frontend_tsc",
        hasAppTsconfig
          ? "npx tsc -p tsconfig.app.json --pretty false 2>&1"
          : "npx tsc --noEmit --pretty false 2>&1",
        frontendDir,
      );
    } else {
      results.push({ suite: "frontend_tsc", pass: true, skipped: true });
    }
  }

  if (requested.includes("frontend_build")) {
    if (hasFrontend) {
      const pm = await detectPackageManager(frontendDir);
      await run(
        "frontend_build",
        pm === "yarn"
          ? "yarn run build 2>&1"
          : pm === "npm"
            ? "npm run build 2>&1"
            : "pnpm run build 2>&1",
        frontendDir,
      );
    } else {
      results.push({ suite: "frontend_build", pass: true, skipped: true });
    }
  }

  if (requested.includes("backend_tsc")) {
    if (hasBackend) {
      await run(
        "backend_tsc",
        "npx tsc --noEmit --pretty false 2>&1",
        backendDir,
      );
    } else {
      results.push({ suite: "backend_tsc", pass: true, skipped: true });
    }
  }

  if (requested.includes("backend_smoke")) {
    if (hasBackend) {
      await run(
        "backend_smoke",
        'npx tsx --eval "(async()=>{const m=await import(\'./src/app.ts\');const f=m.createApp??m.default?.createApp??m.default;if(typeof f!==\'function\')throw new Error(\'createApp missing\');const a=await f();if(!a||typeof a.callback!==\'function\')throw new Error(\'not a Koa app\');console.log(\'backend_smoke_ok\');})()" 2>&1',
        backendDir,
      );
    } else {
      results.push({ suite: "backend_smoke", pass: true, skipped: true });
    }
  }

  if (requested.includes("tdd_green")) {
    const tdd = await runTddRuntimePhase({ outputDir, phase: "green" });
    results.push({
      suite: "tdd_green",
      pass: tdd.p0Failures.length === 0,
      output: tdd.summary,
    });
  }

  return JSON.stringify(
    {
      pass: results.every((result) => result.pass),
      results,
    },
    null,
    2,
  ).slice(0, MAX_TOOL_OUTPUT_CHARS);
}

async function applyTextPatch(
  outputDir: string,
  args: Record<string, unknown>,
): Promise<string> {
  const relPath = String(args.path ?? "");
  const oldText = String(args.oldText ?? "");
  const newText = String(args.newText ?? "");
  const replaceAll = args.replaceAll === true;
  if (!relPath || !oldText) return "Error: path and oldText are required.";
  const existing = await fsRead(relPath, outputDir);
  if (existing.startsWith("FILE_NOT_FOUND") || existing.startsWith("REJECTED")) {
    return existing;
  }
  const count = existing.split(oldText).length - 1;
  if (count === 0) return "Error: oldText not found.";
  if (count > 1 && !replaceAll) {
    return `Error: oldText matched ${count} times; set replaceAll=true or provide a more specific snippet.`;
  }
  const next = replaceAll
    ? existing.split(oldText).join(newText)
    : existing.replace(oldText, newText);
  await fsWrite(relPath, next, outputDir, { forceProtectedOverwrite: true });
  return `OK: patched ${relPath} (${replaceAll ? count : 1} replacement(s)).`;
}

async function deleteFile(
  outputDir: string,
  args: Record<string, unknown>,
): Promise<string> {
  const relPath = String(args.path ?? "");
  const abs = safePath(outputDir, relPath);
  if (!abs) return `REJECTED: path traversal detected for "${relPath}"`;
  try {
    await fs.unlink(abs);
    return `OK: deleted ${relPath}`;
  } catch (error) {
    return `Error: delete failed for ${relPath}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function moveFile(
  outputDir: string,
  args: Record<string, unknown>,
): Promise<string> {
  const from = String(args.from ?? "");
  const to = String(args.to ?? "");
  const fromAbs = safePath(outputDir, from);
  const toAbs = safePath(outputDir, to);
  if (!fromAbs || !toAbs) return "REJECTED: path traversal detected.";
  try {
    if (args.overwrite !== true) {
      try {
        await fs.access(toAbs);
        return `Error: destination exists: ${to}`;
      } catch {
        // destination is available
      }
    }
    await fs.mkdir(path.dirname(toAbs), { recursive: true });
    await fs.rename(fromAbs, toAbs);
    return `OK: moved ${from} -> ${to}`;
  } catch (error) {
    return `Error: move failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function readManyFiles(
  outputDir: string,
  args: Record<string, unknown>,
): Promise<string> {
  const paths = Array.isArray(args.paths) ? args.paths.map(String).slice(0, 20) : [];
  const maxCharsPerFile =
    typeof args.maxCharsPerFile === "number"
      ? Math.max(200, Math.min(Math.floor(args.maxCharsPerFile), 4000))
      : 2000;
  const chunks: string[] = [];
  for (const relPath of paths) {
    const content = await fsRead(relPath, outputDir);
    chunks.push(
      `--- ${relPath} ---\n${content.slice(0, maxCharsPerFile)}`,
    );
  }
  return chunks.join("\n\n").slice(0, MAX_TOOL_OUTPUT_CHARS);
}
