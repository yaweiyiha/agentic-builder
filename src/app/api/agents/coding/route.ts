import { NextRequest } from "next/server";
import path from "path";
import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { v4 as uuidv4 } from "uuid";
import { resolveCodeOutputRoot } from "@/lib/pipeline/code-output";
import { createSupervisorGraph } from "@/lib/langgraph/supervisor";
import { EventMapper, type ErrorCategory } from "@/lib/langgraph/event-mapper";
import { prepareE2eArtifacts } from "@/lib/e2e/e2e-artifacts";
import {
  copyScaffold,
  listScaffoldTemplateRelativePaths,
  type ScaffoldTier,
} from "@/lib/pipeline/scaffold-copy";
import {
  getTierScaffoldSpecForCodingContext,
  writeScaffoldSpecFile,
} from "@/lib/pipeline/scaffold-spec";
import {
  formatGeneratedCodeDotEnv,
  resolveBlueprintGeneratedDatabaseUrl,
  upsertDatabaseUrlEnv,
  upsertJwtEnvVars,
} from "@/lib/pipeline/generated-code-env";
import type {
  KickoffWorkItem,
  CodingTask,
  RalphConfig,
} from "@/lib/pipeline/types";
import { stripTestingPhaseTasks } from "@/lib/pipeline/strip-testing-tasks";
import {
  readDesignReferencesFromOutput,
  formatDesignReferencesPromptBlock,
} from "@/lib/pipeline/design-references";
import { DEFAULT_RALPH_CONFIG } from "@/lib/pipeline/types";
import {
  buildFrontendDesignContextForCodegen,
  readPencilDesignDoc,
} from "@/lib/pipeline/frontend-design-context";
import {
  createRepairEmitter,
  createJsonlRepairSink,
  consoleRepairSink,
  registerRepairEmitter,
  unregisterRepairEmitter,
  runFeatureChecklistAudit,
  dispatchAuditRepair,
  type RepairEmitter,
  type RepairEvent,
  type AuditTaskSummary,
  type FeatureChecklistAuditResult,
} from "@/lib/pipeline/self-heal";
import { extractPrdRequirementIndex } from "@/lib/requirements/extract-prd-spec";
import type { PrdSpec } from "@/lib/requirements/prd-spec-types";
import type { ApiContract, GeneratedFile } from "@/lib/langgraph/state";
import {
  writeCodingSessionReport,
  clearCodingSessionLlmUsage,
} from "@/lib/pipeline/coding-session-report";

const execFileAsync = promisify(execFile);

export const maxDuration = 600;

function classifyError(
  error: unknown,
  clientAborted: boolean,
): {
  category: ErrorCategory;
  message: string;
} {
  if (clientAborted) {
    return {
      category: "client_disconnect",
      message: "Client disconnected (SSE closed)",
    };
  }

  if (!(error instanceof Error)) {
    return { category: "unknown", message: String(error) };
  }

  const msg = error.message.toLowerCase();
  const name = error.name;

  if (
    name === "AbortError" ||
    msg.includes("aborted") ||
    msg.includes("cancelled")
  ) {
    return {
      category: "client_disconnect",
      message: `Client aborted: ${error.message}`,
    };
  }

  if (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("terminated") ||
    msg.includes("exceeded") ||
    name === "TimeoutError"
  ) {
    return {
      category: "timeout",
      message: `Timeout/terminated: ${error.message}`,
    };
  }

  if (
    msg.includes("openrouter") ||
    msg.includes("api error") ||
    msg.includes("rate limit") ||
    msg.includes("model") ||
    msg.includes("codegen api") ||
    msg.includes("empty content") ||
    msg.includes("non-json response")
  ) {
    return { category: "llm_error", message: `LLM error: ${error.message}` };
  }

  return { category: "graph_error", message: error.message };
}

/**
 * Walk a LangGraph stream chunk and extract any {taskId, status, generatedFiles}
 * triples. Used to build `AuditTaskSummary[]` for the feature-checklist audit.
 * Robust to both top-level `taskResults` arrays (worker output) and nested
 * `phaseResults[].taskResults[]` shapes (supervisor output).
 */
function collectTaskResultsFromChunk(
  updates: Record<string, unknown>,
  codingTasks: CodingTask[],
  out: Map<string, AuditTaskSummary>,
): void {
  const taskMeta = new Map(codingTasks.map((t) => [t.id, t] as const));

  const ingest = (rec: Record<string, unknown>): void => {
    const taskId = typeof rec.taskId === "string" ? rec.taskId : null;
    if (!taskId) return;
    const files = Array.isArray(rec.generatedFiles)
      ? (rec.generatedFiles as unknown[]).filter(
          (f): f is string => typeof f === "string",
        )
      : [];
    const status =
      rec.status === "completed" ||
      rec.status === "completed_with_warnings" ||
      rec.status === "failed"
        ? (rec.status as AuditTaskSummary["status"])
        : ("unknown" as const);
    const meta = taskMeta.get(taskId);
    const prev = out.get(taskId);
    const mergedFiles = prev
      ? [...new Set([...prev.generatedFiles, ...files])]
      : files;
    out.set(taskId, {
      id: taskId,
      title: meta?.title ?? (typeof rec.title === "string" ? rec.title : taskId),
      coversRequirementIds: meta?.coversRequirementIds ?? [],
      generatedFiles: mergedFiles,
      status,
    });
  };

  for (const node of Object.keys(updates)) {
    const payload = updates[node];
    if (!payload || typeof payload !== "object") continue;
    const rec = payload as Record<string, unknown>;

    if (Array.isArray(rec.taskResults)) {
      for (const tr of rec.taskResults) {
        if (tr && typeof tr === "object") ingest(tr as Record<string, unknown>);
      }
    }
    if (Array.isArray(rec.phaseResults)) {
      for (const pr of rec.phaseResults) {
        if (!pr || typeof pr !== "object") continue;
        const phase = pr as Record<string, unknown>;
        if (Array.isArray(phase.taskResults)) {
          for (const tr of phase.taskResults) {
            if (tr && typeof tr === "object") {
              ingest(tr as Record<string, unknown>);
            }
          }
        }
      }
    }
  }
}

function collectWorkerContextFromChunk(
  updates: Record<string, unknown>,
  fileRegistryOut: Map<string, GeneratedFile>,
  apiContractsOut: Map<string, ApiContract>,
): void {
  const ingestGeneratedFile = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const rec = value as Record<string, unknown>;
    if (
      typeof rec.path !== "string" ||
      typeof rec.role !== "string" ||
      typeof rec.summary !== "string"
    ) {
      return;
    }
    const exports = Array.isArray(rec.exports)
      ? rec.exports.filter((item): item is string => typeof item === "string")
      : undefined;
    fileRegistryOut.set(rec.path, {
      path: rec.path,
      role: rec.role as GeneratedFile["role"],
      summary: rec.summary,
      exports,
    });
  };

  const ingestApiContract = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const rec = value as Record<string, unknown>;
    if (
      typeof rec.service !== "string" ||
      typeof rec.endpoint !== "string" ||
      typeof rec.method !== "string" ||
      typeof rec.authType !== "string" ||
      typeof rec.schema !== "string" ||
      typeof rec.generatedBy !== "string"
    ) {
      return;
    }
    const key = [
      rec.service,
      rec.method.toUpperCase(),
      rec.endpoint,
      rec.generatedBy,
    ].join("::");
    apiContractsOut.set(key, {
      service: rec.service,
      endpoint: rec.endpoint,
      method: rec.method,
      requestFields:
        typeof rec.requestFields === "string" ? rec.requestFields : undefined,
      responseFields:
        typeof rec.responseFields === "string" ? rec.responseFields : undefined,
      authType: rec.authType,
      description:
        typeof rec.description === "string" ? rec.description : undefined,
      schema: rec.schema,
      generatedBy: rec.generatedBy,
    });
  };

  for (const payload of Object.values(updates)) {
    if (!payload || typeof payload !== "object") continue;
    const rec = payload as Record<string, unknown>;

    if (Array.isArray(rec.fileRegistry)) {
      for (const item of rec.fileRegistry) ingestGeneratedFile(item);
    }
    if (Array.isArray(rec.apiContracts)) {
      for (const item of rec.apiContracts) ingestApiContract(item);
    }
  }
}

interface SupervisorGateSnapshot {
  integrationErrors: string;
  runtimeVerifyErrors: string;
  e2eVerifyErrors: string;
  /**
   * Highest observed `scaffoldFixAttempts` across all phase-verify runs.
   * Surfaced in the session report so the user can tell whether scaffold
   * fix phases converged quickly or bumped the iteration ceiling.
   */
  scaffoldFixAttempts: number;
  /** Same for `integrationFixAttempts` from integration verify/fix. */
  integrationFixAttempts: number;
  /**
   * Tracks which gate actually ran — used by the report to render
   * SKIPPED vs PASS/FAIL instead of treating "no error string" as a pass.
   */
  gatesExecuted: {
    integrationVerify: boolean;
    runtimeVerify: boolean;
    e2eVerify: boolean;
  };
}

function collectSupervisorGateStateFromChunk(
  updates: Record<string, unknown>,
  snapshot: SupervisorGateSnapshot,
): void {
  for (const payload of Object.values(updates)) {
    if (!payload || typeof payload !== "object") continue;
    const rec = payload as Record<string, unknown>;
    if (typeof rec.integrationErrors === "string") {
      snapshot.integrationErrors = rec.integrationErrors;
      snapshot.gatesExecuted.integrationVerify = true;
    }
    if (typeof rec.runtimeVerifyErrors === "string") {
      snapshot.runtimeVerifyErrors = rec.runtimeVerifyErrors;
      snapshot.gatesExecuted.runtimeVerify = true;
    }
    if (typeof rec.e2eVerifyErrors === "string") {
      snapshot.e2eVerifyErrors = rec.e2eVerifyErrors;
      snapshot.gatesExecuted.e2eVerify = true;
    }
    if (typeof rec.scaffoldFixAttempts === "number") {
      snapshot.scaffoldFixAttempts = Math.max(
        snapshot.scaffoldFixAttempts,
        rec.scaffoldFixAttempts,
      );
    }
    if (typeof rec.integrationFixAttempts === "number") {
      snapshot.integrationFixAttempts = Math.max(
        snapshot.integrationFixAttempts,
        rec.integrationFixAttempts,
      );
    }
  }
}

function summarizeBlockingGateErrors(snapshot: SupervisorGateSnapshot): string[] {
  const failures: string[] = [];
  if (snapshot.integrationErrors.trim()) {
    failures.push(
      [
        "Integration verify gate failed.",
        snapshot.integrationErrors.trim().slice(0, 3000),
      ].join("\n"),
    );
  }
  if (snapshot.runtimeVerifyErrors.trim()) {
    failures.push(
      [
        "Runtime verify gate failed.",
        snapshot.runtimeVerifyErrors.trim().slice(0, 3000),
      ].join("\n"),
    );
  }
  if (snapshot.e2eVerifyErrors.trim()) {
    failures.push(
      [
        "E2E verify gate failed.",
        snapshot.e2eVerifyErrors.trim().slice(0, 3000),
      ].join("\n"),
    );
  }
  return failures;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    runId,
    tasks,
    codeOutputDir,
    projectTier,
    ralph: ralphOverride,
    databaseUrl: databaseUrlBody,
    prd: prdBody,
  } = body as {
    runId: string;
    tasks: KickoffWorkItem[];
    codeOutputDir?: string;
    projectTier?: string;
    ralph?: Partial<RalphConfig>;
    /** Optional override; otherwise `BLUEPRINT_GENERATED_DATABASE_URL` (server .env.local). */
    databaseUrl?: string;
    /** PRD content passed from the UI to guarantee the correct project PRD is used. */
    prd?: string;
  };

  const ralphConfig: RalphConfig = {
    ...DEFAULT_RALPH_CONFIG,
    ...(ralphOverride ?? {}),
  };

  if (!runId || !Array.isArray(tasks) || tasks.length === 0) {
    return Response.json(
      { error: "runId and non-empty tasks array are required" },
      { status: 400 },
    );
  }

  const tasksAfterStrip = stripTestingPhaseTasks(tasks);
  if (tasksAfterStrip.length === 0) {
    return Response.json(
      { error: "No tasks to run after task normalization" },
      { status: 400 },
    );
  }

  const outputRoot = resolveCodeOutputRoot(process.cwd(), codeOutputDir);

  // Pencil exports live under frontend/public/design; cleanup removes `frontend/`. Stash PNGs
  // so they survive scaffold refresh (markdown stays at repo root via KEEP_MD).
  const pencilDesignStash = path.join(outputRoot, ".agentic-pencil-design-stash");
  const pencilDesignSrc = path.join(outputRoot, "frontend", "public", "design");
  try {
    await fs.rm(pencilDesignStash, { recursive: true, force: true });
    await fs.access(pencilDesignSrc);
    await fs.cp(pencilDesignSrc, pencilDesignStash, { recursive: true });
    console.log(
      "[CodingAPI] Stashed frontend/public/design (Pencil exports) before cleanup.",
    );
  } catch {
    /* no prior exports */
  }

  // Robust cleanup: handle each entry individually so one failure doesn't stop the rest.
  // Keep .git (RALPH commits), specific doc .md files, and .ralph tracking dir.
  const KEEP_ENTRIES = new Set([".git", ".ralph"]);
  const KEEP_MD = new Set([
    "PRD.md",
    "TRD.md",
    "SystemDesign.md",
    "ImplementationGuide.md",
    "DesignSpec.md",
    "PencilDesign.md",
    "PRD_E2E_SPEC.md",
    "E2E_COVERAGE.md",
  ]);
  await fs.mkdir(outputRoot, { recursive: true });
  const entries = await fs.readdir(outputRoot).catch(() => [] as string[]);
  let removedCount = 0;
  for (const entry of entries) {
    if (KEEP_ENTRIES.has(entry)) continue;
    if (entry.endsWith(".md") && KEEP_MD.has(entry)) continue;
    const entryPath = path.join(outputRoot, entry);
    try {
      await fs.rm(entryPath, { recursive: true, force: true });
      removedCount++;
    } catch (e) {
      console.warn(
        `[CodingAPI] Could not remove ${entry}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  console.log(
    `[CodingAPI] Cleaned output directory: ${outputRoot} (removed ${removedCount} entries)`,
  );

  const tier = (projectTier ?? "M").toUpperCase() as ScaffoldTier;

  // Always overwrite scaffold files so fresh copies are guaranteed even if cleanup was partial.
  let scaffoldCopied: string[] = [];
  try {
    const result = await copyScaffold(tier, outputRoot, {
      forceOverwrite: true,
    });
    scaffoldCopied = result.copied;
    console.log(
      `[CodingAPI] Scaffold (${tier} tier): wrote ${scaffoldCopied.length} file(s) to ${outputRoot}`,
    );
  } catch (e) {
    console.warn(
      `[CodingAPI] Scaffold copy warning: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  try {
    await fs.access(pencilDesignStash);
    await fs.mkdir(pencilDesignSrc, { recursive: true });
    await fs.cp(pencilDesignStash, pencilDesignSrc, { recursive: true });
    await fs.rm(pencilDesignStash, { recursive: true, force: true });
    console.log(
      "[CodingAPI] Restored frontend/public/design after scaffold (Pencil PNG exports).",
    );
  } catch {
    /* nothing stashed */
  }

  try {
    await writeScaffoldSpecFile(outputRoot, tier);
  } catch (e) {
    console.warn(
      `[CodingAPI] writeScaffoldSpecFile warning: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const resolvedDbUrl = resolveBlueprintGeneratedDatabaseUrl(databaseUrlBody);
  if (resolvedDbUrl) {
    try {
      await fs.writeFile(path.join(outputRoot, ".env"), formatGeneratedCodeDotEnv(resolvedDbUrl), "utf-8");
      console.log("[CodingAPI] Wrote generated-code .env with DATABASE_URL.");
    } catch (e) {
      console.warn(
        `[CodingAPI] Failed to write .env: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Always ensure backend/.env has JWT_SECRET (and DATABASE_URL if available).
  const backendEnvPath = path.join(outputRoot, "backend", ".env");
  try {
    const existingBackendEnv = await fs.readFile(backendEnvPath, "utf-8").catch(() => "");
    const withDbUrl = resolvedDbUrl
      ? upsertDatabaseUrlEnv(existingBackendEnv, resolvedDbUrl)
      : existingBackendEnv;
    const mergedBackendEnv = upsertJwtEnvVars(withDbUrl);
    await fs.writeFile(backendEnvPath, mergedBackendEnv, "utf-8");
    console.log("[CodingAPI] Synced backend/.env (DATABASE_URL + JWT vars).");
  } catch (e) {
    console.warn(
      `[CodingAPI] Failed to sync backend/.env: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const scaffoldProtectedPaths = await listScaffoldTemplateRelativePaths(tier);

  // Run installs for every package root present in the scaffold.
  const installTargets = tier === "M" ? ["frontend", "backend"] : [""];
  for (const relTarget of installTargets) {
    const targetDir = relTarget ? path.join(outputRoot, relTarget) : outputRoot;
    const hasPkg = await fs
      .access(path.join(targetDir, "package.json"))
      .then(() => true)
      .catch(() => false);
    if (!hasPkg) continue;
    try {
      console.log(
        `[CodingAPI] Running pnpm install for scaffold at ${relTarget || "."}...`,
      );
      await execFileAsync("pnpm", ["install", "--no-frozen-lockfile"], {
        cwd: targetDir,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 180_000,
      });
      console.log(`[CodingAPI] pnpm install OK at ${relTarget || "."}.`);
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      const detail = (
        err.stderr ||
        err.stdout ||
        err.message ||
        String(e)
      ).slice(0, 400);
      console.warn(
        `[CodingAPI] pnpm install warning at ${relTarget || "."}: ${detail}`,
      );
    }
  }

  const readDoc = async (name: string, limit?: number): Promise<string> => {
    try {
      const raw = await fs.readFile(path.join(outputRoot, name), "utf-8");
      if (!raw.trim()) return "";
      return limit && raw.length > limit
        ? `${raw.slice(0, limit)}\n\n[${name} truncated]`
        : raw;
    } catch {
      return "";
    }
  };

  // If the caller passed PRD content directly, write it to disk before reading.
  // This guarantees the correct project PRD is used even when the file on disk
  // belongs to a previous session (e.g. after a retry without a fresh kickoff).
  if (prdBody && prdBody.trim().length > 0) {
    try {
      await fs.writeFile(path.join(outputRoot, "PRD.md"), prdBody, "utf-8");
      console.log("[CodingAPI] PRD.md overwritten from request body (session PRD pinning).");
    } catch (e) {
      console.warn(
        `[CodingAPI] Failed to write PRD.md from request body: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Docs are passed through to the supervisor/worker graph as-is; the
  // downstream `pickRelevantSections` helper trims per-task. Keep a
  // generous safety cap here purely to protect against runaway docs.
  const DOC_HARD_CAP = 60_000;
  const prdDoc = await readDoc("PRD.md");
  const trdDoc = await readDoc("TRD.md", DOC_HARD_CAP);
  const sysDesignDoc = await readDoc("SystemDesign.md", DOC_HARD_CAP);
  const implGuideDoc = await readDoc("ImplementationGuide.md", DOC_HARD_CAP);
  const designSpecDoc = await readDoc("DesignSpec.md", DOC_HARD_CAP);

  // Read the structured PRD spec sidecar written by the kickoff engine.
  // Non-fatal: if absent or unparseable, frontend workers just won't get
  // PAGE-*/CMP-* context (the pre-existing behaviour).
  let prdSpec: PrdSpec | null = null;
  try {
    const raw = await fs.readFile(
      path.join(outputRoot, ".blueprint", "PRD_SPEC.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw) as PrdSpec;
    if (parsed && Array.isArray(parsed.pages)) prdSpec = parsed;
  } catch {
    /* sidecar missing — proceed without it */
  }
  const pencilDesignDoc = await readPencilDesignDoc(outputRoot);
  const scaffoldReadmePath = path.resolve(
    process.cwd(),
    "scaffolds",
    "m-tier",
    "README.md",
  );
  const scaffoldReadmeDoc =
    tier === "M"
      ? await fs
          .readFile(scaffoldReadmePath, "utf-8")
          .then((raw) =>
            raw.length > 12000
              ? `${raw.slice(0, 12000)}\n\n[m-tier README truncated]`
              : raw,
          )
          .catch(() => "")
      : "";

  const baseContextParts: string[] = [];
  if (prdDoc) baseContextParts.push(`## PRD\n\n${prdDoc}`);
  if (trdDoc) baseContextParts.push(`## TRD\n\n${trdDoc}`);
  if (sysDesignDoc)
    baseContextParts.push(`## System Design\n\n${sysDesignDoc}`);
  if (implGuideDoc)
    baseContextParts.push(`## Implementation Guide\n\n${implGuideDoc}`);

  const designReferenceEntries =
    await readDesignReferencesFromOutput(outputRoot);
  const designReferencesBlock = formatDesignReferencesPromptBlock(
    designReferenceEntries,
  );
  if (designReferencesBlock) {
    baseContextParts.push(designReferencesBlock);
    console.log(
      `[CodingAPI] Injected ${designReferenceEntries.length} design reference(s) into projectContext.`,
    );
  }

  const scaffoldContextBlock = [
    "## Scaffold specification",
    "",
    "The repository includes **SCAFFOLD_SPEC.md** (tier layout, commands, where to implement).",
    "Follow that layout; extend the prebuilt scaffold structure instead of replacing it wholesale.",
    "",
    ...(scaffoldReadmeDoc
      ? [
          `## Scaffold README Reference (${scaffoldReadmePath})`,
          "",
          scaffoldReadmeDoc,
          "",
        ]
      : []),
    getTierScaffoldSpecForCodingContext(tier),
  ].join("\n");

  const preparedE2e = await prepareE2eArtifacts({
    outputRoot,
    prdDoc,
    tasks: tasksAfterStrip,
  });

  const projectContext =
    baseContextParts.length > 0
      ? [
          baseContextParts.join("\n\n---\n\n"),
          scaffoldContextBlock,
          preparedE2e.e2eContextBlock,
        ]
          .filter(Boolean)
          .join("\n\n---\n\n")
      : [
          "No project documents found. Generate code based on task description only.",
          scaffoldContextBlock,
          preparedE2e.e2eContextBlock,
        ]
          .filter(Boolean)
          .join("\n\n---\n\n");

  const frontendDesignContext = await buildFrontendDesignContextForCodegen(
    outputRoot,
    designSpecDoc,
    pencilDesignDoc,
  );

  const normalizedTasks = [...tasksAfterStrip, ...preparedE2e.extraTasks];
  const codingTasks: CodingTask[] = normalizedTasks.map((t) => ({
    ...t,
    assignedAgentId: null,
    codingStatus: "pending" as const,
  }));

  const sessionId = uuidv4();
  const mapper = new EventMapper(sessionId);
  const encoder = new TextEncoder();

  let clientAborted = false;
  request.signal.addEventListener("abort", () => {
    clientAborted = true;
    console.warn(
      `[CodingAPI] Session ${sessionId}: client disconnected (signal aborted)`,
    );
  });

  const stream = new ReadableStream({
    async start(controller) {
      const startedAt = new Date().toISOString();
      function send(data: unknown) {
        if (clientAborted) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          clientAborted = true;
        }
      }

      // ── Self-heal telemetry ────────────────────────────────────────────────
      // Fan out repair events to: (1) SSE channel (front-end log panel),
      // (2) .ralph/repair-log.jsonl on disk, (3) stdout for dev observability.
      const sseRepairSink: RepairEmitter = (event) => {
        send(mapper.buildRepairEvent(event as RepairEvent));
      };
      const repairEmitter = createRepairEmitter([
        sseRepairSink,
        createJsonlRepairSink(outputRoot),
        consoleRepairSink,
      ]);
      registerRepairEmitter(sessionId, repairEmitter);
      const collectedTaskResults = new Map<string, AuditTaskSummary>();
      const collectedFileRegistry = new Map<string, GeneratedFile>();
      const collectedApiContracts = new Map<string, ApiContract>();
      const collectedGateSnapshot: SupervisorGateSnapshot = {
        integrationErrors: "",
        runtimeVerifyErrors: "",
        e2eVerifyErrors: "",
        scaffoldFixAttempts: 0,
        integrationFixAttempts: 0,
        gatesExecuted: {
          integrationVerify: false,
          runtimeVerify: false,
          e2eVerify: false,
        },
      };
      let reportTaskResults: AuditTaskSummary[] = [];
      let finalAuditResult: FeatureChecklistAuditResult | null = null;
      let reportStatus: "pass" | "fail" | "aborted" = "fail";
      let terminalSummary = "";
      let fatalError = "";

      console.log(
        `[CodingAPI] Session ${sessionId}: starting with ${codingTasks.length} tasks, output: ${outputRoot}`,
      );

      send(
        mapper.buildSessionStart(
          codingTasks.map((t) => ({
            ...t,
            assignedAgentId: null,
          })),
        ),
      );

      const graph = createSupervisorGraph();

      try {
        const prebuiltScaffold = scaffoldCopied.length > 0;
        if (prebuiltScaffold) {
          console.log(
            `[CodingAPI] prebuiltScaffold=true — architect tasks will skip LLM (${scaffoldCopied.length} template file(s) copied).`,
          );
        }

        // RALPH Phase 1+3: initialise progress tracker and write IMPLEMENTATION_PLAN.md
        if (ralphConfig.enabled) {
          try {
            const { ProgressTracker } = await import("@/lib/ralph");
            const tracker = new ProgressTracker(outputRoot);
            await tracker.init(codingTasks, sessionId);
            console.log(
              `[CodingAPI] RALPH enabled — progress tracker initialised at ${outputRoot}/.ralph/`,
            );
          } catch (e) {
            console.warn(
              `[CodingAPI] RALPH progress tracker init failed: ${e}`,
            );
          }
        }

        const streamIterator = await graph.stream(
          {
            tasks: codingTasks,
            outputDir: outputRoot,
            projectContext,
            frontendDesignContext,
            prebuiltScaffold,
            scaffoldProtectedPaths,
            ralphConfig,
            sessionId,
            prdSpec,
          },
          { subgraphs: true, streamMode: "updates", recursionLimit: 100 },
        );

        for await (const chunk of streamIterator) {
          if (clientAborted) {
            console.warn(
              `[CodingAPI] Session ${sessionId}: stopping iteration — client disconnected`,
            );
            break;
          }

          const [ns, updates] = chunk as [string[], Record<string, unknown>];
          const nodeNames = Object.keys(updates);
          console.log(
            `[CodingAPI] Stream chunk: ns=[${ns.join(",")}] nodes=[${nodeNames.join(",")}]`,
          );

          collectTaskResultsFromChunk(
            updates,
            codingTasks,
            collectedTaskResults,
          );
          collectWorkerContextFromChunk(
            updates,
            collectedFileRegistry,
            collectedApiContracts,
          );
          collectSupervisorGateStateFromChunk(updates, collectedGateSnapshot);

          const events = mapper.mapChunk(
            chunk as [string[], Record<string, unknown>],
          );
          for (const event of events) {
            send(event);
          }
        }

        if (!clientAborted) {
          console.log(`[CodingAPI] Session ${sessionId}: stream complete.`);

          const prdIndex = extractPrdRequirementIndex(prdDoc ?? "");
          const auditTaskResults: AuditTaskSummary[] = codingTasks.map(
            (t) =>
              collectedTaskResults.get(t.id) ?? {
                id: t.id,
                title: t.title,
                coversRequirementIds: t.coversRequirementIds ?? [],
                generatedFiles: [],
                status: "unknown" as const,
              },
          );
          reportTaskResults = auditTaskResults;
          let finalAudit = await runFeatureChecklistAudit({
            prdIndex,
            prdSpec,
            tasks: codingTasks,
            taskResults: auditTaskResults,
            outputDir: outputRoot,
            sessionId,
            emitter: repairEmitter,
          });

          if (finalAudit.uncovered.length > 0) {
            const dispatchResult = await dispatchAuditRepair({
              uncovered: finalAudit.uncovered,
              outputDir: outputRoot,
              projectContext,
              fileRegistrySnapshot: [...collectedFileRegistry.values()],
              apiContractsSnapshot: [...collectedApiContracts.values()],
              scaffoldProtectedPaths,
              ralphConfig,
              sessionId,
              emitter: repairEmitter,
            });

            if (
              dispatchResult.backendGeneratedFiles.length +
                dispatchResult.frontendGeneratedFiles.length >
              0
            ) {
              // Backfill wrote something — re-run the audit to see what
              // actually got closed. We intentionally do NOT loop again;
              // one repair round is the hard upper bound.
              finalAudit = await runFeatureChecklistAudit({
                prdIndex,
                prdSpec,
                tasks: [...codingTasks, ...dispatchResult.repairTasks],
                taskResults: [
                  ...auditTaskResults,
                  ...dispatchResult.repairTaskResults,
                ],
                outputDir: outputRoot,
                sessionId,
                emitter: repairEmitter,
              });
              reportTaskResults = [
                ...auditTaskResults,
                ...dispatchResult.repairTaskResults,
              ];
            }
          }
          finalAuditResult = finalAudit;

          const blockingFailures = summarizeBlockingGateErrors(
            collectedGateSnapshot,
          );
          if (!finalAudit.passed) {
            const remainingIds = finalAudit.uncovered.map((entry) => entry.id);
            blockingFailures.push(
              [
                `Feature audit gate failed: ${remainingIds.length} requirement id(s) still unresolved.`,
                remainingIds.slice(0, 40).join(", "),
              ]
                .filter(Boolean)
                .join("\n"),
            );
          }
          if (blockingFailures.length > 0) {
            throw new Error(blockingFailures.join("\n\n"));
          }

          reportStatus = "pass";
          terminalSummary =
            "Coding session completed with integration, runtime/E2E, and feature-audit gates passing.";
          send(mapper.buildSessionComplete());
        }
      } catch (error) {
        const classified = classifyError(error, clientAborted);
        reportStatus = clientAborted ? "aborted" : "fail";
        terminalSummary = classified.message;
        fatalError = classified.message;
        console.error(
          `[CodingAPI] Session ${sessionId} error [${classified.category}]:`,
          classified.message,
          error instanceof Error ? `\n  name=${error.name}` : "",
          error instanceof Error && error.stack
            ? `\n  stack=${error.stack.split("\n").slice(0, 4).join("\n  ")}`
            : "",
        );
        send(mapper.buildSessionError(classified.message, classified.category));
      } finally {
        if (clientAborted && reportStatus === "fail" && !fatalError) {
          reportStatus = "aborted";
          terminalSummary = "Client disconnected before the coding session completed.";
          fatalError = terminalSummary;
        }
        try {
          await writeCodingSessionReport({
            sessionId,
            outputDir: outputRoot,
            startedAt,
            endedAt: new Date().toISOString(),
            status: reportStatus,
            terminalSummary:
              terminalSummary || "Coding session ended without an explicit summary.",
            integrationErrors: collectedGateSnapshot.integrationErrors,
            runtimeVerifyErrors: collectedGateSnapshot.runtimeVerifyErrors,
            e2eVerifyErrors: collectedGateSnapshot.e2eVerifyErrors,
            scaffoldFixAttempts: collectedGateSnapshot.scaffoldFixAttempts,
            integrationFixAttempts:
              collectedGateSnapshot.integrationFixAttempts,
            gatesExecuted: collectedGateSnapshot.gatesExecuted,
            finalAudit: finalAuditResult,
            taskResults:
              reportTaskResults.length > 0
                ? reportTaskResults
                : codingTasks.map((task) => ({
                    id: task.id,
                    title: task.title,
                    coversRequirementIds: task.coversRequirementIds ?? [],
                    generatedFiles:
                      collectedTaskResults.get(task.id)?.generatedFiles ?? [],
                    status:
                      collectedTaskResults.get(task.id)?.status ?? "unknown",
                  })),
            fileRegistry: [...collectedFileRegistry.values()],
            fatalError,
          });
        } catch (reportErr) {
          console.warn(
            `[CodingAPI] Failed to write coding session report (ignored):`,
            reportErr instanceof Error ? reportErr.message : reportErr,
          );
        }
        clearCodingSessionLlmUsage(sessionId);
        unregisterRepairEmitter(sessionId);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
