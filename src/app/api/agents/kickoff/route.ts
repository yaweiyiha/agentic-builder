import { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import { PipelineEngine } from "@/lib/pipeline/engine";
import { resolveCodeOutputRoot } from "@/lib/pipeline/code-output";
import type { PipelineEvent, PipelineStepId, StepResult } from "@/lib/pipeline/types";
import { wrapPipelineEventHandler } from "@/lib/memory/event-bridge";
import { fetchStitchScreenHtml } from "@/lib/stitch-api";
import {
  classifyProject,
  normalizeProjectTier,
} from "@/lib/agents/shared/project-classifier";

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
    pencil,
    sessionId,
    stitchProjectId,
    stitchScreenId,
  } = body as {
    featureBrief: string;
    codeOutputDir?: string;
    prd: string;
    trd?: string;
    sysdesign?: string;
    implguide?: string;
    design?: string;
    pencil?: string;
    /** Stable client-generated id that links memory records from the
     *  originating pipeline run + this kickoff into one logical session. */
    sessionId?: string;
    /** Stitch screen identifiers — when present, the kickoff fetches the
     *  exported HTML and writes it to StitchDesign.html in the output root
     *  so coding workers can read it as a UI design reference. */
    stitchProjectId?: string | null;
    stitchScreenId?: string | null;
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

      const projectRoot = process.cwd();
      const memoryAwareSend = wrapPipelineEventHandler(send, {
        projectRoot,
        codeOutputDir:
          typeof codeOutputDir === "string" ? codeOutputDir : undefined,
        featureBrief: featureBrief || "PRD-driven code generation.",
        kickoffIdOverride:
          typeof sessionId === "string" && sessionId.length > 0
            ? sessionId
            : undefined,
      });
      const engine = new PipelineEngine(memoryAwareSend, projectRoot);
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

      // Classify the project from the PRD tier badge (zero extra LLM cost) or
      // fall back to classifyProject so that executeKickoffOnly always has the
      // correct tier and needsBackend flag. Without this, executeKickoffOnly
      // defaults to tier "M" which triggers repairMissingBackendPhase for
      // frontend-only projects and causes spurious backend code generation.
      try {
        let classification = extractClassificationFromPrd(prd);
        if (!classification) {
          classification = await classifyProject(featureBrief);
        }
        run.steps.intent = {
          ...run.steps.intent,
          metadata: {
            ...(run.steps.intent?.metadata ?? {}),
            classification: {
              tier: classification.tier,
              type: classification.type,
              needsBackend: classification.needsBackend,
              needsDatabase: classification.needsDatabase,
              reasoning: classification.reasoning,
            },
          },
        };
      } catch (e) {
        console.warn(
          "[KickoffAPI] classification failed (ignored, will default to M-tier):",
          e instanceof Error ? e.message : e,
        );
      }
      run.steps.prd = buildStep("prd", prd);
      run.steps.trd = buildStep("trd", trd);
      run.steps.sysdesign = buildStep("sysdesign", sysdesign);
      run.steps.implguide = buildStep("implguide", implguide);
      run.steps.design = buildStep("design", design);

      const pencilTrimmed = pencil?.trim() ?? "";
      const isPencilReal =
        pencilTrimmed.length > 0 &&
        !pencilTrimmed.includes("step disabled") &&
        !pencilTrimmed.includes("was not selected");
      run.steps.pencil = {
        ...buildStep("pencil", isPencilReal ? pencilTrimmed : ""),
        metadata: { skipped: !isPencilReal },
      };

      run.steps.mockup = buildStep("mockup", "Mockup step disabled.");
      run.steps.qa = buildStep("qa", "");
      run.steps.verify = buildStep("verify", "");

      // Fetch and persist Stitch design HTML if provided. Non-fatal if fetch fails.
      if (stitchProjectId && stitchScreenId) {
        try {
          const html = await fetchStitchScreenHtml(stitchProjectId, stitchScreenId);
          if (html) {
            await fs.writeFile(path.join(outputRoot, "StitchDesign.html"), html, "utf-8");
            console.log("[KickoffAPI] StitchDesign.html written to output root.");
          } else {
            console.warn("[KickoffAPI] Stitch HTML fetch returned empty — skipping StitchDesign.html.");
          }
        } catch (e) {
          console.warn("[KickoffAPI] Failed to fetch/write StitchDesign.html:", e instanceof Error ? e.message : String(e));
        }
      }

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

/**
 * Extract project classification from the PRD tier badge line.
 * The PM agent injects a line like:
 *   > **Project Tier: S** — Simple (single-page / micro-tool)
 * This lets us recover the correct tier without an additional LLM call.
 * Returns null when the badge is absent or unrecognised.
 */
function extractClassificationFromPrd(
  prd: string,
): { tier: ReturnType<typeof normalizeProjectTier>; type: string; needsBackend: boolean; needsDatabase: boolean; reasoning: string } | null {
  const match = prd.match(/\*\*Project Tier:\s*([SML])\*\*/i);
  if (!match) return null;
  const tier = normalizeProjectTier(match[1]);
  const needsBackend = tier === "M" || tier === "L";
  return {
    tier,
    type: "app",
    needsBackend,
    needsDatabase: tier === "L",
    reasoning: `Extracted from PRD tier badge: tier ${tier}`,
  };
}
