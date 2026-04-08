import path from "path";
import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  mergeScaffoldContent,
  normalizeScaffoldRelPath,
} from "@/lib/pipeline/scaffold-file-merge";

const execFileAsync = promisify(execFile);

const SHELL_TIMEOUT_MS = 90_000;
const MAX_BUFFER = 5 * 1024 * 1024;

const ALLOWED_COMMANDS = [
  "tsc",
  "npx tsc",
  "npm install",
  "npm run build",
  "npm run dev",
  "npm run test",
  "npm run lint",
  "npm install &&",
  "ls",
  "cat",
  "head",
  "tail",
  "find",
  "wc",
  "node -e",
];

function isSafeCommand(cmd: string): boolean {
  const trimmed = cmd.trim();
  return ALLOWED_COMMANDS.some(
    (a) => trimmed === a || trimmed.startsWith(a + " "),
  );
}

export type FsWriteOptions = {
  /** Relative paths from tier scaffold; existing files merge or skip instead of overwrite. */
  scaffoldProtectedPaths?: Iterable<string>;
  /** Fix passes (supervisor) may replace protected files when errors require it. */
  forceProtectedOverwrite?: boolean;
};

export async function fsWrite(
  filePath: string,
  content: string,
  outputDir: string,
  options?: FsWriteOptions,
): Promise<string> {
  const normalized = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = path.resolve(path.join(outputDir, normalized));
  const resolvedRoot = path.resolve(outputDir);
  if (!abs.startsWith(resolvedRoot + path.sep) && abs !== resolvedRoot) {
    return `REJECTED: path traversal detected for "${filePath}"`;
  }

  const key = normalizeScaffoldRelPath(normalized);
  const protectedSet =
    options?.scaffoldProtectedPaths != null
      ? new Set(
          [...options.scaffoldProtectedPaths].map((p) =>
            normalizeScaffoldRelPath(p),
          ),
        )
      : null;

  let toWrite = content;
  let mergeKind: "none" | "merged" | "incoming" = "none";

  if (protectedSet?.has(key)) {
    try {
      const existing = await fs.readFile(abs, "utf-8");
      const merged = mergeScaffoldContent(key, existing, content, {
        forceOverwrite: options?.forceProtectedOverwrite ?? false,
      });
      if (merged.kind === "skip") {
        return `SKIPPED_PROTECTED: ${key} (${merged.reason})`;
      }
      if (merged.kind === "merged") {
        toWrite = merged.content;
        mergeKind = "merged";
      } else if (merged.kind === "use_incoming") {
        toWrite = merged.content;
        mergeKind = "incoming";
      }
    } catch {
      /* missing file under a protected path — write full incoming */
    }
  }

  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, toWrite, "utf-8");
  if (mergeKind === "merged") {
    return `Merged (scaffold): ${normalized} (${toWrite.length} chars)`;
  }
  return `Written: ${normalized} (${toWrite.length} chars)`;
}

export async function fsRead(
  filePath: string,
  outputDir: string,
): Promise<string> {
  const normalized = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = path.resolve(path.join(outputDir, normalized));
  const resolvedRoot = path.resolve(outputDir);
  if (!abs.startsWith(resolvedRoot + path.sep) && abs !== resolvedRoot) {
    return `REJECTED: path traversal detected for "${filePath}"`;
  }
  try {
    return await fs.readFile(abs, "utf-8");
  } catch {
    return `FILE_NOT_FOUND: ${normalized}`;
  }
}

export async function shellExec(
  command: string,
  cwd: string,
  options?: { timeout?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (!isSafeCommand(command)) {
    return {
      stdout: "",
      stderr: `REJECTED: command not in allowlist. Allowed: ${ALLOWED_COMMANDS.join(", ")}`,
      exitCode: 1,
    };
  }

  const timeout = options?.timeout ?? SHELL_TIMEOUT_MS;
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-c", command], {
      cwd,
      maxBuffer: MAX_BUFFER,
      timeout,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (e) {
    const err = e as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? (e instanceof Error ? e.message : String(e)),
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
}

export async function listFiles(
  directory: string,
  outputDir: string,
): Promise<string[]> {
  const abs = path.resolve(path.join(outputDir, directory));
  const resolvedRoot = path.resolve(outputDir);
  if (!abs.startsWith(resolvedRoot) && abs !== resolvedRoot) {
    return [];
  }

  const results: string[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        results.push(path.relative(resolvedRoot, full));
      }
    }
  }

  await walk(abs);
  return results;
}
