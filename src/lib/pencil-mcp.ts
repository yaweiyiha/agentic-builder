import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const PENCIL_APP_BUNDLE =
  process.env.PENCIL_APP_PATH?.trim() || "/Applications/Pencil.app";
const PENCIL_BUNDLE_ID = "dev.pencil.desktop";

const MCP_SERVER_BIN = `${PENCIL_APP_BUNDLE}/Contents/Resources/app.asar.unpacked/out/mcp-server-darwin-arm64`;
const MCP_ARGS = ["--app", "desktop"];

const MAX_CONNECT_RETRIES = 2;
const RETRY_DELAY_MS = 3_000;
const WS_STABILIZE_MS = 5_000;

/**
 * Build a sanitised env that strips Electron / Chromium vars.
 * Prevents Pencil (also an Electron app) from inheriting the host
 * Electron runtime context, which causes duplicate app instances.
 */
function cleanEnv(): Record<string, string> {
  const blocked = /^(ELECTRON_|CHROME_|NODE_OPTIONS|GOOGLE_|ORIGINAL_XDG_)/i;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !blocked.test(k)) env[k] = v;
  }
  if (!env.PATH) {
    env.PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  }
  return env;
}

const MCP_INIT_TIMEOUT_MS = Number(
  process.env.PENCIL_MCP_INIT_TIMEOUT_MS ?? 120_000,
);
const MCP_TOOL_TIMEOUT_MS = Number(
  process.env.PENCIL_MCP_TOOL_TIMEOUT_MS ?? 180_000,
);
const MCP_BATCH_DESIGN_TIMEOUT_MS = Number(
  process.env.PENCIL_MCP_BATCH_TIMEOUT_MS ?? 600_000,
);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function isPencilRunning(): Promise<boolean> {
  try {
    const { stdout } = await execAsync("pgrep -x Pencil 2>/dev/null || true", {
      env: cleanEnv() as NodeJS.ProcessEnv,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function ensurePencilRunning(): Promise<void> {
  if (await isPencilRunning()) {
    console.log("[PencilMCP] Pencil GUI already running");
    return;
  }

  // Launching Pencil from inside Electron causes macOS to associate
  // the child process with the parent app bundle, resulting in
  // duplicate-instance issues.  Use `open -a` with explicit path
  // and a detached shell so Launch Services treats it as independent.
  console.log("[PencilMCP] Pencil not running, launching...");
  const launchCmd = `open -a "${PENCIL_APP_BUNDLE}"`;
  await execAsync(launchCmd, {
    env: cleanEnv() as NodeJS.ProcessEnv,
    shell: "/bin/zsh",
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await sleep(1_000);
    if (await isPencilRunning()) {
      console.log("[PencilMCP] Pencil started, stabilizing...");
      await sleep(12_000);
      return;
    }
  }
  throw new Error(
    "Pencil did not start in 30s. Please launch Pencil manually before running.",
  );
}

let _singleton: PencilMcpClient | null = null;

export class PencilMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private toolNameMap: Map<string, string> = new Map();

  static getInstance(): PencilMcpClient {
    if (!_singleton) {
      _singleton = new PencilMcpClient();
    }
    return _singleton;
  }

  async connect(): Promise<void> {
    if (this.client) return;

    await ensurePencilRunning();

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_CONNECT_RETRIES; attempt++) {
      try {
        this.transport = new StdioClientTransport({
          command: MCP_SERVER_BIN,
          args: MCP_ARGS,
          env: cleanEnv(),
        });

        this.client = new Client({
          name: "AgenticBuilder",
          version: "1.0.0",
        });

        await this.client.connect(this.transport, {
          timeout: MCP_INIT_TIMEOUT_MS,
        });
        console.log("[PencilMCP] Stdio connected, waiting for WebSocket stabilization...");
        await sleep(WS_STABILIZE_MS);
        const toolsResult = await this.client.listTools();
        this.toolNameMap.clear();
        for (const tool of toolsResult.tools) {
          const canonical = tool.name.replace(/-/g, "_");
          this.toolNameMap.set(canonical, tool.name);
        }
        console.log(
          "[PencilMCP] Connection fully established, tools:",
          [...this.toolNameMap.values()].join(", "),
        );
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(
          `[PencilMCP] Attempt ${attempt + 1}/${MAX_CONNECT_RETRIES} failed: ${lastError.message}`,
        );
        try {
          if (this.transport) await this.transport.close();
        } catch {
          /* ignore */
        }
        this.client = null;
        this.transport = null;
        this.toolNameMap.clear();

        if (attempt < MAX_CONNECT_RETRIES - 1) await sleep(RETRY_DELAY_MS);
      }
    }

    throw new Error(
      `Pencil MCP connection failed after ${MAX_CONNECT_RETRIES} retries. Last: ${lastError?.message}`,
    );
  }

  private resolveToolName(canonical: string): string {
    return this.toolNameMap.get(canonical) ?? canonical;
  }

  private extractText(result: unknown): string {
    const res = result as { content?: { type: string; text?: string }[] };
    if (res?.content) {
      return res.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!)
        .join("\n");
    }
    return JSON.stringify(result);
  }

  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    options?: { timeoutMs?: number },
  ): Promise<string> {
    if (!this.client) throw new Error("Pencil MCP not connected");
    const resolved = this.resolveToolName(name.replace(/-/g, "_"));
    const timeout =
      options?.timeoutMs ??
      (name.includes("batch_design") || name.includes("batch-design")
        ? MCP_BATCH_DESIGN_TIMEOUT_MS
        : MCP_TOOL_TIMEOUT_MS);
    const result = await this.client.callTool(
      { name: resolved, arguments: args },
      undefined,
      { timeout },
    );
    return this.extractText(result);
  }

  openDocument(filePathOrNew: string) {
    return this.callTool("open_document", { filePathOrNew });
  }

  getGuidelines(topic: string) {
    return this.callTool("get_guidelines", { topic });
  }

  batchDesign(operations: string, filePath = "") {
    return this.callTool(
      "batch_design",
      { filePath, operations },
      { timeoutMs: MCP_BATCH_DESIGN_TIMEOUT_MS },
    );
  }

  batchGet(params: {
    filePath?: string;
    patterns?: Record<string, unknown>[];
    nodeIds?: string[];
    readDepth?: number;
    searchDepth?: number;
  }) {
    return this.callTool("batch_get", params);
  }

  exportNodes(params: {
    filePath: string;
    nodeIds: string[];
    outputDir: string;
    format?: string;
  }) {
    return this.callTool("export_nodes", params, {
      timeoutMs: MCP_TOOL_TIMEOUT_MS,
    });
  }

  async disconnect() {
    try {
      if (this.transport) await this.transport.close();
    } catch {
      /* ignore */
    }
    this.client = null;
    this.transport = null;
    this.toolNameMap.clear();
  }

  get isConnected(): boolean {
    return this.client !== null;
  }
}
