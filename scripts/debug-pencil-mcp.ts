/**
 * Debug Pencil MCP - with JSON-RPC message interception.
 * Run: npx tsx scripts/debug-pencil-mcp.ts
 */
import { exec } from "child_process";
import { promisify } from "util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execAsync = promisify(exec);

const PENCIL_APP_BUNDLE = "/Applications/Pencil.app";
const PENCIL_BUNDLE_ID = "dev.pencil.desktop";
const MCP_SERVER_BIN = `${PENCIL_APP_BUNDLE}/Contents/Resources/app.asar.unpacked/out/mcp-server-darwin-arm64`;
const MCP_ARGS = ["--app", "desktop"];

const CONNECT_TIMEOUT_MS = 120_000;
const TOOL_TIMEOUT_MS = 180_000;
const BATCH_TIMEOUT_MS = 600_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> })?.content;
  if (!Array.isArray(content)) return JSON.stringify(result).slice(0, 800);
  return content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
}

async function isPencilRunning(): Promise<boolean> {
  try {
    const { stdout } = await execAsync("pgrep -x Pencil 2>/dev/null || true");
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function ensurePencilRunning(): Promise<void> {
  if (await isPencilRunning()) {
    console.log("OK - Pencil already running");
    return;
  }
  console.log("Pencil not running, launching...");
  await execAsync(`open -b ${PENCIL_BUNDLE_ID}`);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await sleep(1_000);
    if (await isPencilRunning()) {
      console.log("Pencil started, waiting 8s for stabilization...");
      await sleep(8_000);
      return;
    }
  }
  throw new Error("Pencil did not start in 30s.");
}

async function main() {
  console.log("── Step 1: Check binary ──");
  try {
    await execAsync(`ls -la "${MCP_SERVER_BIN}"`);
    console.log("OK");
  } catch {
    console.error("FAIL - binary not found");
    process.exit(1);
  }

  console.log("\n── Step 2: Ensure Pencil running ──");
  await ensurePencilRunning();

  console.log("\n── Step 3: Connect MCP ──");
  const transport = new StdioClientTransport({ command: MCP_SERVER_BIN, args: MCP_ARGS });

  // Intercept the send method to log outgoing JSON-RPC messages
  const originalSend = transport.send.bind(transport);
  transport.send = async (message: unknown, options?: unknown) => {
    const msg = message as { method?: string; params?: Record<string, unknown> };
    if (msg.method === "tools/call") {
      console.log(`   📤 JSON-RPC → method: "${msg.method}", tool: "${msg.params?.name}"`);
    }
    return originalSend(message, options);
  };

  const client = new Client({ name: "DebugScript", version: "1.0.0" });
  try {
    await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
    console.log("OK - connected");
  } catch (err) {
    console.error("FAIL:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  console.log("\n── Step 4: List tools ──");
  try {
    const { tools } = await client.listTools();
    console.log(`Found ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
  } catch (err) {
    console.error("FAIL:", err instanceof Error ? err.message : err);
  }

  console.log("\n── Waiting 5s for WebSocket stabilization... ──");
  await sleep(5_000);

  // Step 5: get_editor_state to get the active file path
  console.log("\n── Step 5: get_editor_state ──");
  let activeFilePath = "";
  try {
    const result = await client.callTool(
      { name: "get_editor_state", arguments: { include_schema: false } },
      undefined,
      { timeout: TOOL_TIMEOUT_MS },
    );
    const text = extractText(result);
    console.log("OK:", text.slice(0, 300));
    const match = text.match(/`([^`]+\.pen)`/);
    if (match) {
      activeFilePath = match[1];
      console.log("   Active file:", activeFilePath);
    }
  } catch (err) {
    console.error("FAIL:", err instanceof Error ? err.message : String(err));
  }

  // Step 6: batch_design with the ACTUAL active file path
  console.log("\n── Step 6: batch_design (with active file path) ──");
  const ops = `testFrame=I(document,{type:"frame",layout:"vertical",width:100,height:100,fill:"#E5E7EB",name:"DebugTest"})`;
  console.log("   filePath:", activeFilePath || "(empty)");
  console.log("   operations:", ops);
  try {
    const result = await client.callTool(
      { name: "batch_design", arguments: { filePath: activeFilePath, operations: ops } },
      undefined,
      { timeout: BATCH_TIMEOUT_MS },
    );
    console.log("✅ OK:", extractText(result).slice(0, 400));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("❌ FAIL:", msg);

    // Additional diagnostic: try with empty filePath
    if (activeFilePath) {
      console.log("\n── Step 6b: retry batch_design with filePath='' ──");
      try {
        const result = await client.callTool(
          { name: "batch_design", arguments: { filePath: "", operations: ops } },
          undefined,
          { timeout: BATCH_TIMEOUT_MS },
        );
        console.log("✅ OK:", extractText(result).slice(0, 400));
      } catch (err2) {
        console.error("❌ FAIL:", err2 instanceof Error ? err2.message : String(err2));
      }
    }

    // Try get_guidelines to see if OTHER tools still work after failure
    console.log("\n── Step 6c: get_guidelines (verify connection still works) ──");
    try {
      const result = await client.callTool(
        { name: "get_guidelines", arguments: {} },
        undefined,
        { timeout: TOOL_TIMEOUT_MS },
      );
      console.log("✅ get_guidelines OK:", extractText(result).slice(0, 200));
    } catch (err2) {
      console.error("❌ get_guidelines FAIL:", err2 instanceof Error ? err2.message : String(err2));
    }
  }

  // Cleanup
  console.log("\n── Cleanup ──");
  try {
    await transport.close();
    console.log("Disconnected");
  } catch { /* ignore */ }

  console.log("\n── Done ──");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
