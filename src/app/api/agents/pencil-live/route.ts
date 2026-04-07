import { NextRequest } from "next/server";
import { resolveCodeOutputRoot } from "@/lib/pipeline/code-output";
import { runPencilLiveSession } from "@/lib/pencil-host/live-runner";

export const maxDuration = 600;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { prdContent, designSpec, sessionId, codeOutputDir, pencilAugmentMarkdown } =
    body as {
      prdContent?: string;
      designSpec?: string;
      sessionId?: string;
      codeOutputDir?: string;
      pencilAugmentMarkdown?: string;
    };

  if (!prdContent) {
    return Response.json({ error: "prdContent is required" }, { status: 400 });
  }

  const outputRoot = resolveCodeOutputRoot(process.cwd(), codeOutputDir);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const result = await runPencilLiveSession({
          prdContent,
          designSpec: designSpec ?? "",
          projectRoot: outputRoot,
          sessionId,
          augmentMarkdown: pencilAugmentMarkdown,
          onEvent: (event) => send(event),
        });
        send({
          type: "done",
          result: {
            content: result.content,
            costUsd: result.costUsd,
            durationMs: result.durationMs,
            tokens: result.usage.totalTokens,
            model: result.model,
            traceId: result.traceId,
          },
        });
      } catch (error) {
        send({
          type: "error",
          error: error instanceof Error ? error.message : "Pencil live failed",
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
