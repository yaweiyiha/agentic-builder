import { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";
import { PipelineEngine } from "@/lib/pipeline/engine";
import type { PipelineEvent } from "@/lib/pipeline/types";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    featureBrief: featureBriefRaw,
    codeOutputDir,
    fastFromPrd,
    pauseAfterPrd,
  } = body as {
    featureBrief?: string;
    codeOutputDir?: string;
    fastFromPrd?: boolean;
    pauseAfterPrd?: boolean;
  };

  const featureBrief =
    typeof featureBriefRaw === "string" && featureBriefRaw.trim()
      ? featureBriefRaw.trim()
      : "PRD-driven code generation.";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: PipelineEvent) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      }

      const engine = new PipelineEngine(send);
      const run = engine.createRun(featureBrief);

      try {
        const result = await engine.executePipeline(run, {
          codeOutputDir:
            typeof codeOutputDir === "string" ? codeOutputDir : undefined,
          fastFromPrd: fastFromPrd === true,
          pauseAfterPrd: pauseAfterPrd === true,
        });

        // Auto-save pipeline snapshot for debug reuse
        if (result.steps.kickoff?.status === "completed") {
          try {
            const snapshotDir = path.resolve(process.cwd(), ".blueprint");
            await fs.mkdir(snapshotDir, { recursive: true });
            const snapshot = {
              savedAt: new Date().toISOString(),
              featureBrief,
              codeOutputDir: codeOutputDir || "",
              totalCostUsd: result.totalCostUsd,
              steps: result.steps,
            };
            await fs.writeFile(
              path.join(snapshotDir, "pipeline-snapshot.json"),
              JSON.stringify(snapshot, null, 2),
              "utf-8",
            );
          } catch {
            /* non-critical */
          }
        }

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "done", run: result })}\n\n`,
          ),
        );
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Pipeline execution failed";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", error: msg })}\n\n`,
          ),
        );
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
