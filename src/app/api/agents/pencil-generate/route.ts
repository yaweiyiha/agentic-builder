import { NextRequest } from "next/server";
import { resolveCodeOutputRoot } from "@/lib/pipeline/code-output";
import { getDesignStylePreset } from "@/lib/pipeline/design-style-presets";
import { runPencilLiveSession } from "@/lib/pencil-host/live-runner";

/** Pencil MCP sessions can take several minutes. */
export const maxDuration = 600;

/**
 * POST /api/agents/pencil-generate
 *
 * Launches a full Pencil MCP live session from a confirmed Design Spec.
 * Streams PencilLiveEvent SSE events back to the client.
 *
 * Body:
 *   prdContent       — PRD markdown (required)
 *   designSpecContent — confirmed Design Spec markdown (required)
 *   designStyleId    — selected style preset id
 *   codeOutputDir    — output root (default "generated-code")
 *   sessionId        — optional trace id
 *   editInstruction  — optional user instruction for revising an existing design
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    prdContent,
    designSpecContent,
    designStyleId,
    codeOutputDir,
    sessionId,
    editInstruction,
  } = body as {
    prdContent?: string;
    designSpecContent?: string;
    designStyleId?: string;
    codeOutputDir?: string;
    sessionId?: string;
    editInstruction?: string;
  };

  if (!prdContent?.trim()) {
    return Response.json({ error: "prdContent is required" }, { status: 400 });
  }
  if (!designSpecContent?.trim()) {
    return Response.json(
      { error: "designSpecContent is required" },
      { status: 400 },
    );
  }

  const outputRoot = resolveCodeOutputRoot(process.cwd(), codeOutputDir);
  const style = getDesignStylePreset(designStyleId);

  const augmentMarkdown = editInstruction?.trim()
    ? `## User Revision Request\n\n${editInstruction.trim()}\n\nApply the requested changes to the Pencil design.`
    : undefined;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const result = await runPencilLiveSession({
          prdContent,
          designSpec: designSpecContent,
          projectRoot: outputRoot,
          sessionId,
          augmentMarkdown,
          styleAugment: style.pencilPrompt,
          onEvent: (event) => send(event),
        });

        send({
          type: "done",
          result: {
            content: result.content,
            costUsd: result.costUsd,
            durationMs: result.durationMs,
            tokens: result.usage.total_tokens,
            model: result.model,
          },
        });
      } catch (error) {
        send({
          type: "error",
          error:
            error instanceof Error ? error.message : "Pencil generation failed",
        });
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
