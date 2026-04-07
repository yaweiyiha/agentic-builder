import { PencilMcpClient } from "@/lib/pencil-mcp";
import { runWithPencilMcpExclusive } from "@/lib/pencil-mcp-exclusive";

export const maxDuration = 300;

const MOCK_OPS = [
  `screen=I(document,{type:"frame",layout:"vertical",width:1440,height:900,placeholder:true,fill:"#0F172A",name:"Debug Dashboard"})`,
  `header=I(screen,{type:"frame",layout:"horizontal",width:"fill_container",height:64,padding:[0,24],alignItems:"center",fill:"#1E293B"})`,
  `logo=I(header,{type:"text",content:"Blueprint",fontSize:20,fontWeight:700,fill:"#F1F5F9"})`,
  `main=I(screen,{type:"frame",layout:"vertical",width:"fill_container",padding:32,gap:24})`,
  `title=I(main,{type:"text",content:"Dashboard Overview",fontSize:24,fontWeight:600,fill:"#F1F5F9"})`,
  `cards=I(main,{type:"frame",layout:"horizontal",width:"fill_container",gap:16})`,
  `card1=I(cards,{type:"frame",layout:"vertical",width:"fill_container",height:120,padding:20,fill:"#1E293B",cornerRadius:12,gap:8})`,
  `card1Label=I(card1,{type:"text",content:"Total Users",fontSize:14,fill:"#94A3B8"})`,
  `card1Value=I(card1,{type:"text",content:"12,847",fontSize:28,fontWeight:700,fill:"#F1F5F9"})`,
  `card2=I(cards,{type:"frame",layout:"vertical",width:"fill_container",height:120,padding:20,fill:"#1E293B",cornerRadius:12,gap:8})`,
  `card2Label=I(card2,{type:"text",content:"Revenue",fontSize:14,fill:"#94A3B8"})`,
  `card2Value=I(card2,{type:"text",content:"$84,320",fontSize:28,fontWeight:700,fill:"#10B981"})`,
  `card3=I(cards,{type:"frame",layout:"vertical",width:"fill_container",height:120,padding:20,fill:"#1E293B",cornerRadius:12,gap:8})`,
  `card3Label=I(card3,{type:"text",content:"Active Sessions",fontSize:14,fill:"#94A3B8"})`,
  `card3Value=I(card3,{type:"text",content:"1,024",fontSize:28,fontWeight:700,fill:"#6366F1"})`,
];

const MAX_OPS_PER_BATCH = 4;
const TOOL_CALL_DELAY_MS = 2_000;
const MAX_RETRIES = 2;

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface DebugEvent {
  type: "step_log" | "step_complete";
  stepId: string;
  message?: string;
  result?: Record<string, unknown>;
}

async function callWithRetry(
  mcp: PencilMcpClient,
  name: string,
  args: Record<string, unknown>,
  logger: (msg: string) => void,
): Promise<string> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await mcp.callTool(name, args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_RETRIES) {
        const waitMs = (attempt + 1) * 5_000;
        logger(`${name} attempt ${attempt + 1} failed: ${msg}, retrying in ${waitMs / 1000}s...`);
        await delay(waitMs);
      } else {
        throw err;
      }
    }
  }
  throw new Error("unreachable");
}

export async function POST() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const mcp = PencilMcpClient.getInstance();

      function send(event: DebugEvent) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      function log(msg: string) {
        console.log(`[DebugPencil] ${msg}`);
        send({ type: "step_log", stepId: "pencil", message: msg });
      }

      const results: string[] = [];
      let success = false;

      try {
        await runWithPencilMcpExclusive(async () => {
          try {
            // 1. Connect
            log("Connecting to Pencil MCP...");
            await mcp.connect();
            log("Connected");
            results.push("connect: OK");

            // 2. Open new document
            log("Opening new document...");
            const openRes = await mcp.openDocument("new");
            log(`Document opened: ${openRes.slice(0, 80)}`);
            results.push("open_document: OK");

            log("Waiting for document to initialize...");
            await delay(5_000);

            log("Getting editor state...");
            const state = await callWithRetry(mcp, "get_editor_state", { include_schema: false }, log);
            log(`Editor state: ${state.slice(0, 150)}`);
            results.push("get_editor_state: OK");

            await delay(TOOL_CALL_DELAY_MS);

            log(`Executing ${MOCK_OPS.length} mock operations (${MAX_OPS_PER_BATCH} per batch)...`);
            let okBatches = 0;
            let failBatches = 0;

            for (let i = 0; i < MOCK_OPS.length; i += MAX_OPS_PER_BATCH) {
              const chunk = MOCK_OPS.slice(i, i + MAX_OPS_PER_BATCH).join("\n");
              const batchNum = Math.floor(i / MAX_OPS_PER_BATCH) + 1;
              try {
                const r = await mcp.batchDesign(chunk);
                log(`Batch ${batchNum}: OK - ${r.slice(0, 100)}`);
                okBatches++;
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                log(`Batch ${batchNum}: FAILED - ${msg}`);
                failBatches++;
              }
              if (i + MAX_OPS_PER_BATCH < MOCK_OPS.length) {
                await delay(TOOL_CALL_DELAY_MS);
              }
            }

            results.push(`batch_design: ${okBatches} OK, ${failBatches} failed`);

            await delay(TOOL_CALL_DELAY_MS);

            log("Getting screenshot...");
            try {
              const screenshot = await mcp.callTool("get_screenshot", {});
              const hasImage = screenshot.includes("image") || screenshot.length > 200;
              log(`Screenshot: ${hasImage ? "received" : "empty"} (${screenshot.length} chars)`);
              results.push("get_screenshot: OK");
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              log(`Screenshot failed (non-fatal): ${msg}`);
              results.push(`get_screenshot: FAIL - ${msg}`);
            }

            log("Verifying final state...");
            const finalState = await callWithRetry(mcp, "get_editor_state", { include_schema: false }, log);
            log(`Final state: ${finalState.slice(0, 200)}`);
            results.push("verify: OK");

            success = okBatches > 0;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`Error: ${msg}`);
            results.push(`error: ${msg}`);
          } finally {
            await mcp.disconnect();
            log("Disconnected");
          }
        });
      } catch (lockErr) {
        const msg = lockErr instanceof Error ? lockErr.message : String(lockErr);
        log(`Exclusive lock / MCP error: ${msg}`);
        results.push(`lock/mcp: ${msg}`);
      }

      send({
        type: "step_complete",
        stepId: "pencil",
        result: {
          stepId: "pencil",
          status: success ? "completed" : "failed",
          content: `Pencil MCP debug results:\n${results.join("\n")}`,
          error: success ? undefined : results.join("\n"),
          timestamp: new Date().toISOString(),
        },
      });

      controller.close();
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
