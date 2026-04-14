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
  "npx prisma",
  // npm
  "npm install",
  "npm run build",
  "npm run dev",
  "npm run test",
  "npm run lint",
  "npm install &&",
  "npm add",
  // pnpm
  "pnpm install",
  "pnpm run build",
  "pnpm run dev",
  "pnpm run test",
  "pnpm run lint",
  "pnpm install &&",
  "pnpm add",
  "pnpm approve-builds",
  // yarn
  "yarn install",
  "yarn run build",
  "yarn run dev",
  "yarn run test",
  "yarn run lint",
  "yarn install &&",
  "yarn add",
  // shell utilities
  "ls",
  "cat",
  "head",
  "tail",
  "find",
  "wc",
  "node -e",
  // RALPH: git operations for per-task commits
  "git init",
  "git add",
  "git commit",
  "git status",
  "git log",
  "git rev-parse",
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

export type ShellExecOptions = {
  timeout?: number;
  /** Merged over process.env (e.g. DATABASE_URL for `prisma generate` when .env is not loaded). */
  env?: Record<string, string>;
};

export async function shellExec(
  command: string,
  cwd: string,
  options?: ShellExecOptions,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (!isSafeCommand(command)) {
    return {
      stdout: "",
      stderr: `REJECTED: command not in allowlist. Allowed: ${ALLOWED_COMMANDS.join(", ")}`,
      exitCode: 1,
    };
  }

  const timeout = options?.timeout ?? SHELL_TIMEOUT_MS;
  const childEnv =
    options?.env && Object.keys(options.env).length > 0
      ? { ...process.env, ...options.env }
      : process.env;
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-c", command], {
      cwd,
      maxBuffer: MAX_BUFFER,
      timeout,
      env: childEnv,
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

/**
 * Run `npx prisma generate` with merged env (no bash). Prisma's get-config WASM
 * needs a valid DATABASE_URL when the schema uses env("DATABASE_URL"); passing
 * env through `bash -c` can still fail P1012 in some environments.
 */
export async function execPrismaGenerate(
  cwd: string,
  extraEnv: Record<string, string>,
  options?: { timeout?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const timeout = options?.timeout ?? 90_000;
  const env = { ...process.env, ...extraEnv } as NodeJS.ProcessEnv;
  try {
    const { stdout, stderr } = await execFileAsync("npx", ["prisma", "generate"], {
      cwd,
      maxBuffer: MAX_BUFFER,
      timeout,
      env,
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

/** Workspace / path-alias specifiers that must not be passed to pnpm/npm add. */
export function isAutoInstallableNpmPackageName(pkg: string): boolean {
  if (!pkg || pkg.includes("@/")) return false;
  if (pkg.startsWith("@shared/")) return false;
  if (pkg.startsWith("@project/")) return false;
  return true;
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

/**
 * Detect which package manager the project at outputDir uses.
 * Checks for pnpm-workspace.yaml / pnpm-lock.yaml → 'pnpm'
 *         yarn.lock → 'yarn'
 *         otherwise → 'npm'
 */
export async function detectPackageManager(outputDir: string): Promise<"pnpm" | "yarn" | "npm"> {
  const abs = path.resolve(outputDir);
  for (const lockFile of ["pnpm-workspace.yaml", "pnpm-lock.yaml"]) {
    try {
      await fs.access(path.join(abs, lockFile));
      return "pnpm";
    } catch {
      // not found
    }
  }
  try {
    await fs.access(path.join(abs, "yarn.lock"));
    return "yarn";
  } catch {
    return "npm";
  }
}

/**
 * Return the correct "install" command for the given package manager.
 * For pnpm/yarn/npm workspaces, always install from root.
 */
export function buildInstallCommand(pm: "pnpm" | "yarn" | "npm"): string {
  if (pm === "pnpm") return "pnpm install --prefer-offline 2>&1 | tail -30";
  if (pm === "yarn") return "yarn install --prefer-offline 2>&1 | tail -30";
  return "npm install --prefer-offline 2>&1 | tail -30";
}

/**
 * Return the correct "add package" command for the given package manager.
 * For pnpm, an optional `filter` selects the workspace package.
 */
export function buildAddCommand(
  pm: "pnpm" | "yarn" | "npm",
  pkgs: string[],
  opts?: { filter?: string; dev?: boolean },
): string {
  const devFlag = opts?.dev
    ? pm === "yarn"
      ? " --dev"
      : " --save-dev"
    : "";
  if (pm === "pnpm") {
    const filter = opts?.filter ? ` --filter ${opts.filter}` : "";
    return `pnpm add${filter}${devFlag} ${pkgs.join(" ")} 2>&1 | tail -15`;
  }
  if (pm === "yarn") return `yarn add${devFlag} ${pkgs.join(" ")} 2>&1 | tail -15`;
  const saveFlag = opts?.dev ? "--save-dev" : "--save";
  return `npm install ${saveFlag} ${pkgs.join(" ")} 2>&1 | tail -15`;
}
