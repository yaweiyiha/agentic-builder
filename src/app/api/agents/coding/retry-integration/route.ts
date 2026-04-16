import { NextRequest } from "next/server";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { resolveCodeOutputRoot } from "@/lib/pipeline/code-output";
import { prepareE2eArtifacts } from "@/lib/e2e/e2e-artifacts";
import { createIntegrationRetryGraph } from "@/lib/langgraph/supervisor";
import { EventMapper, type ErrorCategory } from "@/lib/langgraph/event-mapper";
import {
  listScaffoldTemplateRelativePaths,
  type ScaffoldTier,
} from "@/lib/pipeline/scaffold-copy";
import {
  getTierScaffoldSpecForCodingContext,
  writeScaffoldSpecFile,
} from "@/lib/pipeline/scaffold-spec";
import type {
  CodingTask,
  KickoffWorkItem,
  RalphConfig,
} from "@/lib/pipeline/types";
import { stripTestingPhaseTasks } from "@/lib/pipeline/strip-testing-tasks";
import { DEFAULT_RALPH_CONFIG } from "@/lib/pipeline/types";

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
    runId: runIdRaw,
    tasks,
    codeOutputDir,
    projectTier,
    ralph: ralphOverride,
  } = body as {
    runId?: string;
    tasks?: KickoffWorkItem[];
    codeOutputDir?: string;
    projectTier?: string;
    ralph?: Partial<RalphConfig>;
  };

  if (!codeOutputDir || !String(codeOutputDir).trim()) {
    return Response.json(
      { error: "codeOutputDir is required for integration retry" },
      { status: 400 },
    );
  }

  const runId =
    typeof runIdRaw === "string" && runIdRaw.trim()
      ? runIdRaw.trim()
      : `integration-retry-${Date.now()}`;

  const inputTasks = Array.isArray(tasks) ? tasks : [];
  const tasksAfterStrip = stripTestingPhaseTasks(inputTasks);
  const ralphConfig: RalphConfig = {
    ...DEFAULT_RALPH_CONFIG,
    ...(ralphOverride ?? {}),
  };

  const outputRoot = resolveCodeOutputRoot(process.cwd(), codeOutputDir);
  const tier = (projectTier ?? "M").toUpperCase() as ScaffoldTier;
  const scaffoldProtectedPaths = await listScaffoldTemplateRelativePaths(tier);

  try {
    await writeScaffoldSpecFile(outputRoot, tier);
  } catch (e) {
    console.warn(
      `[CodingAPI][retry-integration] writeScaffoldSpecFile warning: ${e instanceof Error ? e.message : String(e)}`,
    );
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

  const scaffoldContextBlock = [
    "## Scaffold specification",
    "",
    "The repository includes **SCAFFOLD_SPEC.md** (tier layout, commands, where to implement).",
    "Follow that layout; extend the prebuilt scaffold structure instead of replacing it wholesale.",
    "",
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

  const frontendDesignContext = [
    designSpecDoc ? `## Design Specification\n\n${designSpecDoc}` : "",
    pencilDesignDoc ? `## Pencil Design Tokens\n\n${pencilDesignDoc}` : "",
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  const normalizedTasks = [...tasksAfterStrip, ...preparedE2e.extraTasks];
  const codingTasks: CodingTask[] = normalizedTasks.map((t) => ({
    ...t,
    assignedAgentId: null,
    codingStatus: "pending" as const,
  }));

  const sessionId = uuidv4();
  const mapper = new EventMapper(sessionId, {
    emitGapAnalysisAfterIntegration: false,
  });
  const encoder = new TextEncoder();

  let clientAborted = false;
  request.signal.addEventListener("abort", () => {
    clientAborted = true;
    console.warn(
      `[CodingAPI][retry-integration] Session ${sessionId}: client disconnected`,
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
        `[CodingAPI][retry-integration] Session ${sessionId}: runId=${runId}, output=${outputRoot}`,
      );

      send(mapper.buildSessionStart(codingTasks));

      const graph = createIntegrationRetryGraph();

      try {
        const streamIterator = await graph.stream(
          {
            tasks: codingTasks,
            outputDir: outputRoot,
            projectContext,
            frontendDesignContext,
            scaffoldProtectedPaths,
            ralphConfig,
          },
          { subgraphs: true, streamMode: "updates", recursionLimit: 100 },
        );

        for await (const chunk of streamIterator) {
          if (clientAborted) break;
          const events = mapper.mapChunk(
            chunk as [string[], Record<string, unknown>],
          );
          for (const event of events) {
            send(event);
          }
        }

        if (!clientAborted) {
          send(mapper.buildSessionComplete());
        }
      } catch (error) {
        const classified = classifyError(error, clientAborted);
        console.error(
          `[CodingAPI][retry-integration] Session ${sessionId} error [${classified.category}]: ${classified.message}`,
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
