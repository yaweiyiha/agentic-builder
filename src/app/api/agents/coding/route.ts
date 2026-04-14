import { NextRequest } from "next/server";
import path from "path";
import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { v4 as uuidv4 } from "uuid";
import { resolveCodeOutputRoot } from "@/lib/pipeline/code-output";
import { createSupervisorGraph } from "@/lib/langgraph/supervisor";
import { EventMapper, type ErrorCategory } from "@/lib/langgraph/event-mapper";
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
} from "@/lib/pipeline/generated-code-env";
import type {
  KickoffWorkItem,
  CodingTask,
  RalphConfig,
} from "@/lib/pipeline/types";
import { stripTestingPhaseTasks } from "@/lib/pipeline/strip-testing-tasks";
import { DEFAULT_RALPH_CONFIG } from "@/lib/pipeline/types";

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

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    runId,
    tasks,
    codeOutputDir,
    projectTier,
    ralph: ralphOverride,
    databaseUrl: databaseUrlBody,
  } = body as {
    runId: string;
    tasks: KickoffWorkItem[];
    codeOutputDir?: string;
    projectTier?: string;
    ralph?: Partial<RalphConfig>;
    /** Optional override; otherwise `BLUEPRINT_GENERATED_DATABASE_URL` (server .env.local). */
    databaseUrl?: string;
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
      { error: "No tasks to run after excluding Testing-phase tasks" },
      { status: 400 },
    );
  }

  const outputRoot = resolveCodeOutputRoot(process.cwd(), codeOutputDir);

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
    await writeScaffoldSpecFile(outputRoot, tier);
  } catch (e) {
    console.warn(
      `[CodingAPI] writeScaffoldSpecFile warning: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const resolvedDbUrl = resolveBlueprintGeneratedDatabaseUrl(databaseUrlBody);
  if (resolvedDbUrl) {
    try {
      await fs.writeFile(
        path.join(outputRoot, ".env"),
        formatGeneratedCodeDotEnv(resolvedDbUrl),
        "utf-8",
      );
      console.log("[CodingAPI] Wrote generated-code .env with DATABASE_URL.");
    } catch (e) {
      console.warn(
        `[CodingAPI] Failed to write .env: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
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

  const prdDoc = await readDoc("PRD.md");
  const trdDoc = await readDoc("TRD.md", 6000);
  const sysDesignDoc = await readDoc("SystemDesign.md", 6000);
  const implGuideDoc = await readDoc("ImplementationGuide.md", 6000);
  const designSpecDoc = await readDoc("DesignSpec.md", 8000);
  const pencilDesignDoc = await readDoc("PencilDesign.md");
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

  const projectContext =
    baseContextParts.length > 0
      ? `${baseContextParts.join("\n\n---\n\n")}\n\n---\n\n${scaffoldContextBlock}`
      : `No project documents found. Generate code based on task description only.\n\n---\n\n${scaffoldContextBlock}`;

  const frontendDesignContext = [
    designSpecDoc ? `## Design Specification\n\n${designSpecDoc}` : "",
    pencilDesignDoc ? `## Pencil Design Tokens\n\n${pencilDesignDoc}` : "",
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  const codingTasks: CodingTask[] = tasksAfterStrip.map((t) => ({
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

          const events = mapper.mapChunk(
            chunk as [string[], Record<string, unknown>],
          );
          for (const event of events) {
            send(event);
          }
        }

        if (!clientAborted) {
          console.log(`[CodingAPI] Session ${sessionId}: stream complete.`);
          send(mapper.buildSessionComplete());
        }
      } catch (error) {
        const classified = classifyError(error, clientAborted);
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
