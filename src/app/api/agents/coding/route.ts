import { NextRequest } from "next/server";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { resolveCodeOutputRoot } from "@/lib/pipeline/code-output";
import { createSupervisorGraph } from "@/lib/langgraph/supervisor";
import { EventMapper } from "@/lib/langgraph/event-mapper";
import type { KickoffWorkItem, CodingTask } from "@/lib/pipeline/types";

export const maxDuration = 600;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    runId,
    tasks,
    codeOutputDir,
  } = body as {
    runId: string;
    tasks: KickoffWorkItem[];
    codeOutputDir?: string;
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

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: unknown) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
        );
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
        const streamIterator = await graph.stream(
          {
            tasks: codingTasks,
            outputDir: outputRoot,
            projectContext,
            frontendDesignContext,
          },
          { subgraphs: true, streamMode: "updates", recursionLimit: 100 },
        );

        for await (const chunk of streamIterator) {
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

        console.log(`[CodingAPI] Session ${sessionId}: stream complete.`);
        send(mapper.buildSessionComplete());
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Coding session failed";
        console.error(`[CodingAPI] Session ${sessionId} error:`, msg);
        send(mapper.buildSessionError(msg));
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
