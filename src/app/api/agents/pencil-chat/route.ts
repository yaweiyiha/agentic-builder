import { NextRequest } from "next/server";
import { resolveCodeOutputRoot } from "@/lib/pipeline/code-output";
import { runPencilLiveSession } from "@/lib/pencil-host/live-runner";
import path from "path";
import fs from "fs/promises";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { userMessage, prdContent, sessionId, codeOutputDir } = body as {
    userMessage: string;
    prdContent?: string;
    sessionId?: string;
    codeOutputDir?: string;
  };

  if (!userMessage) {
    return Response.json({ error: "userMessage is required" }, { status: 400 });
  }

  const outputRoot = resolveCodeOutputRoot(process.cwd(), codeOutputDir);
  const encoder = new TextEncoder();

  // Read existing design spec if available
  let designSpec = "";
  try {
    designSpec = await fs.readFile(
      path.join(outputRoot, "DesignSpec.md"),
      "utf-8",
    );
  } catch {
    // ignore
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const result = await runPencilLiveSession({
          prdContent: prdContent ?? "",
          designSpec,
          projectRoot: outputRoot,
          sessionId,
          augmentMarkdown: `## User Change Request\n\n${userMessage}\n\nApply the requested changes to the Pencil design file.`,
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
          },
        });
      } catch (error) {
        send({
          type: "error",
          error:
            error instanceof Error ? error.message : "Pencil chat failed",
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
