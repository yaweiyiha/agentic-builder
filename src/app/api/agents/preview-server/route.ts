import { NextRequest } from "next/server";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs/promises";
import { resolveCodeOutputRoot } from "@/lib/pipeline/code-output";

let serverProcess: ChildProcess | null = null;
let serverPort: number | null = null;
let serverStatus: "stopped" | "starting" | "running" | "error" = "stopped";
let serverLogs: string[] = [];
const MAX_LOG_LINES = 200;

function addLog(line: string) {
  serverLogs.push(line);
  if (serverLogs.length > MAX_LOG_LINES) {
    serverLogs = serverLogs.slice(-MAX_LOG_LINES);
  }
}

async function detectPort(outputDir: string): Promise<number> {
  const pkgPath = path.join(outputDir, "package.json");
  try {
    const raw = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw);
    const devScript = pkg.scripts?.dev ?? "";
    const portMatch = devScript.match(/--port\s+(\d+)/);
    if (portMatch) return parseInt(portMatch[1], 10);
  } catch { /* fall through */ }
  return 5173;
}

async function detectPackageManager(outputDir: string): Promise<string> {
  try {
    await fs.access(path.join(outputDir, "pnpm-lock.yaml"));
    return "pnpm";
  } catch { /* fall through */ }
  try {
    await fs.access(path.join(outputDir, "yarn.lock"));
    return "yarn";
  } catch { /* fall through */ }
  return "npm";
}

async function startServer(outputDir: string): Promise<{ port: number }> {
  if (serverProcess) {
    throw new Error("Server is already running");
  }

  const hasNodeModules = await fs.access(path.join(outputDir, "node_modules")).then(() => true).catch(() => false);
  const pm = await detectPackageManager(outputDir);

  if (!hasNodeModules) {
    addLog(`[preview] Installing dependencies with ${pm}...`);
    serverStatus = "starting";
    await new Promise<void>((resolve, reject) => {
      const install = spawn(pm, ["install"], { cwd: outputDir, shell: true });
      install.stdout?.on("data", (d: Buffer) => addLog(d.toString().trim()));
      install.stderr?.on("data", (d: Buffer) => addLog(d.toString().trim()));
      install.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${pm} install failed with code ${code}`));
      });
      install.on("error", reject);
    });
  }

  const port = await detectPort(outputDir);
  serverPort = port;
  serverStatus = "starting";
  serverLogs = [];
  addLog(`[preview] Starting dev server on port ${port}...`);

  const child = spawn(pm, ["run", "dev", "--", "--port", String(port), "--host"], {
    cwd: outputDir,
    shell: true,
    env: { ...process.env, PORT: String(port), BROWSER: "none" },
  });

  serverProcess = child;

  child.stdout?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    addLog(line);
    if (serverStatus === "starting" && (line.includes("localhost") || line.includes("Local:") || line.includes("ready"))) {
      serverStatus = "running";
      addLog(`[preview] Dev server is ready at http://localhost:${port}`);
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    addLog(line);
    if (serverStatus === "starting" && (line.includes("localhost") || line.includes("Local:") || line.includes("ready"))) {
      serverStatus = "running";
      addLog(`[preview] Dev server is ready at http://localhost:${port}`);
    }
  });

  child.on("close", (code) => {
    addLog(`[preview] Dev server exited with code ${code}`);
    serverProcess = null;
    serverStatus = "stopped";
  });

  child.on("error", (err) => {
    addLog(`[preview] Error: ${err.message}`);
    serverStatus = "error";
    serverProcess = null;
  });

  await new Promise<void>((resolve) => {
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 500;
      if (serverStatus === "running" || elapsed > 30000) {
        clearInterval(interval);
        if (serverStatus !== "running") {
          serverStatus = "running";
          addLog(`[preview] Assuming server is ready (timeout).`);
        }
        resolve();
      }
    }, 500);
  });

  return { port };
}

function stopServer() {
  if (serverProcess) {
    addLog("[preview] Stopping dev server...");
    serverProcess.kill("SIGTERM");
    setTimeout(() => {
      if (serverProcess) {
        serverProcess.kill("SIGKILL");
      }
    }, 5000);
    serverProcess = null;
    serverStatus = "stopped";
    serverPort = null;
  }
}

export async function GET() {
  return Response.json({
    status: serverStatus,
    port: serverPort,
    url: serverPort ? `http://localhost:${serverPort}` : null,
    logs: serverLogs.slice(-50),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action, codeOutputDir } = body as { action: string; codeOutputDir?: string };

  if (action === "start") {
    if (serverStatus === "running" || serverStatus === "starting") {
      return Response.json({ status: serverStatus, port: serverPort, url: `http://localhost:${serverPort}` });
    }

    const outputRoot = resolveCodeOutputRoot(process.cwd(), codeOutputDir);
    const hasPkg = await fs.access(path.join(outputRoot, "package.json")).then(() => true).catch(() => false);
    if (!hasPkg) {
      return Response.json({ error: "No package.json found in output directory" }, { status: 400 });
    }

    try {
      const { port } = await startServer(outputRoot);
      return Response.json({ status: serverStatus, port, url: `http://localhost:${port}` });
    } catch (err) {
      serverStatus = "error";
      return Response.json({ error: err instanceof Error ? err.message : "Failed to start", status: "error" }, { status: 500 });
    }
  }

  if (action === "stop") {
    stopServer();
    return Response.json({ status: "stopped" });
  }

  if (action === "restart") {
    stopServer();
    const outputRoot = resolveCodeOutputRoot(process.cwd(), codeOutputDir);
    try {
      const { port } = await startServer(outputRoot);
      return Response.json({ status: serverStatus, port, url: `http://localhost:${port}` });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : "Failed to restart" }, { status: 500 });
    }
  }

  return Response.json({ error: "Invalid action. Use start, stop, or restart." }, { status: 400 });
}
