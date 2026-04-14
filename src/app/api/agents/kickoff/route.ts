import { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import { PipelineEngine } from "@/lib/pipeline/engine";
import { resolveCodeOutputRoot } from "@/lib/pipeline/code-output";
import type { PipelineEvent, PipelineStepId, StepResult } from "@/lib/pipeline/types";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    featureBrief,
    codeOutputDir,
    prd,
    trd,
    sysdesign,
    implguide,
    design,
  } = body as {
    featureBrief: string;
    codeOutputDir?: string;
    prd: string;
    trd?: string;
    sysdesign?: string;
    implguide?: string;
    design?: string;
  };

  if (!prd) {
    return Response.json({ error: "PRD content is required" }, { status: 400 });
  }

  const outputRoot = resolveCodeOutputRoot(
    process.cwd(),
    typeof codeOutputDir === "string" ? codeOutputDir : undefined,
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: PipelineEvent) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      }

      const engine = new PipelineEngine(send);
      const run = engine.createRun(featureBrief || "PRD-driven code generation.");

      const now = new Date().toISOString();
      const buildStep = (
        stepId: PipelineStepId,
        content: string | undefined,
      ): StepResult => ({
        stepId,
        status: "completed",
        content: content ?? "",
        timestamp: now,
        costUsd: 0,
        durationMs: 0,
      });

      run.steps.intent = buildStep("intent", featureBrief);
      run.steps.prd = buildStep("prd", prd);
      run.steps.trd = buildStep("trd", trd);
      run.steps.sysdesign = buildStep("sysdesign", sysdesign);
      run.steps.implguide = buildStep("implguide", implguide);
      run.steps.design = buildStep("design", design);
      run.steps.pencil = buildStep("pencil", "Pencil step disabled.");
      run.steps.mockup = buildStep("mockup", "Mockup step disabled.");
      run.steps.qa = buildStep("qa", "");
      run.steps.verify = buildStep("verify", "");

      try {
        const result = await engine.executeKickoffOnly(run, outputRoot);

        // Auto-save pipeline snapshot for debug reuse
        try {
          const snapshotDir = path.resolve(process.cwd(), ".blueprint");
          await fs.mkdir(snapshotDir, { recursive: true });
          const snapshot = {
            savedAt: new Date().toISOString(),
            featureBrief: featureBrief || "",
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
          /* non-critical: skip if write fails */
        }

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "done", run: result })}\n\n`,
          ),
        );
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Kick-off failed";
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
