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
import type { KickoffWorkItem, CodingTask } from "@/lib/pipeline/types";

const execFileAsync = promisify(execFile);

export const maxDuration = 600;

function classifyError(error: unknown, clientAborted: boolean): {
  category: ErrorCategory;
  message: string;
} {
  if (clientAborted) {
    return { category: "client_disconnect", message: "Client disconnected (SSE closed)" };
  }

  if (!(error instanceof Error)) {
    return { category: "unknown", message: String(error) };
  }

  const msg = error.message.toLowerCase();
  const name = error.name;

  if (name === "AbortError" || msg.includes("aborted") || msg.includes("cancelled")) {
    return { category: "client_disconnect", message: `Client aborted: ${error.message}` };
  }

  if (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("terminated") ||
    msg.includes("exceeded") ||
    name === "TimeoutError"
  ) {
    return { category: "timeout", message: `Timeout/terminated: ${error.message}` };
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
  } = body as {
    runId: string;
    tasks: KickoffWorkItem[];
    codeOutputDir?: string;
    projectTier?: string;
  };

  if (!runId || !Array.isArray(tasks) || tasks.length === 0) {
    return Response.json(
      { error: "runId and non-empty tasks array are required" },
      { status: 400 },
    );
  }

  const outputRoot = resolveCodeOutputRoot(process.cwd(), codeOutputDir);

  try {
    const entries = await fs.readdir(outputRoot).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(outputRoot, entry);
      const stat = await fs.stat(entryPath).catch(() => null);
      if (!stat) continue;
      if (
        entry.endsWith(".md") &&
        ["PRD.md", "TRD.md", "SystemDesign.md", "ImplementationGuide.md", "DesignSpec.md", "PencilDesign.md"].includes(entry)
      ) {
        continue;
      }
      await fs.rm(entryPath, { recursive: true, force: true });
    }
    console.log(`[CodingAPI] Cleaned output directory: ${outputRoot} (kept doc .md files)`);
  } catch {
    await fs.mkdir(outputRoot, { recursive: true });
  }

  const tier = ((projectTier ?? "M").toUpperCase()) as ScaffoldTier;
  const { copied: scaffoldCopied } = await copyScaffold(tier, outputRoot);
  const scaffoldProtectedPaths =
    await listScaffoldTemplateRelativePaths(tier);
  if (scaffoldCopied.length > 0) {
    console.log(
      `[CodingAPI] Scaffold (${tier} tier): copied ${scaffoldCopied.length} file(s) to ${outputRoot}`,
    );
    try {
      console.log("[CodingAPI] Running pnpm install for scaffold...");
      await execFileAsync("pnpm", ["install", "--prefer-offline"], {
        cwd: outputRoot,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 120_000,
      });
      console.log("[CodingAPI] pnpm install OK.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[CodingAPI] pnpm install warning: ${msg.slice(0, 200)}`);
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

  const baseContextParts: string[] = [];
  if (prdDoc) baseContextParts.push(`## PRD\n\n${prdDoc}`);
  if (trdDoc) baseContextParts.push(`## TRD\n\n${trdDoc}`);
  if (sysDesignDoc)
    baseContextParts.push(`## System Design\n\n${sysDesignDoc}`);
  if (implGuideDoc)
    baseContextParts.push(`## Implementation Guide\n\n${implGuideDoc}`);

  const projectContext =
    baseContextParts.length > 0
      ? baseContextParts.join("\n\n---\n\n")
      : "No project documents found. Generate code based on task description only.";

  const frontendDesignContext = [
    designSpecDoc ? `## Design Specification\n\n${designSpecDoc}` : "",
    pencilDesignDoc
      ? `## Pencil Design Tokens\n\n${pencilDesignDoc}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  const codingTasks: CodingTask[] = tasks.map((t) => ({
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
    console.warn(`[CodingAPI] Session ${sessionId}: client disconnected (signal aborted)`);
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

      console.log(`[CodingAPI] Session ${sessionId}: starting with ${codingTasks.length} tasks, output: ${outputRoot}`);

      send(mapper.buildSessionStart(
        codingTasks.map((t) => ({
          ...t,
          assignedAgentId: null,
        })),
      ));

      const graph = createSupervisorGraph();

      try {
        const prebuiltScaffold = scaffoldCopied.length > 0;
        if (prebuiltScaffold) {
          console.log(
            `[CodingAPI] prebuiltScaffold=true — architect tasks will skip LLM (${scaffoldCopied.length} template file(s) copied).`,
          );
        }

        const streamIterator = await graph.stream(
          {
            tasks: codingTasks,
            outputDir: outputRoot,
            projectContext,
            frontendDesignContext,
            prebuiltScaffold,
            scaffoldProtectedPaths,
          },
          { subgraphs: true, streamMode: "updates", recursionLimit: 100 },
        );

        for await (const chunk of streamIterator) {
          if (clientAborted) {
            console.warn(`[CodingAPI] Session ${sessionId}: stopping iteration — client disconnected`);
            break;
          }

          const [ns, updates] = chunk as [string[], Record<string, unknown>];
          const nodeNames = Object.keys(updates);
          console.log(`[CodingAPI] Stream chunk: ns=[${ns.join(",")}] nodes=[${nodeNames.join(",")}]`);

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
