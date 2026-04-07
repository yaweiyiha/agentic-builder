import fs from "fs/promises";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const RELATIVE_KICKOFF_REPO_FILE = path.join(".blueprint", "kickoff-repo.json");

export interface KickoffRepoFile {
  cloneUrl: string;
  htmlUrl?: string;
  name?: string;
  savedAt: string;
}

export function kickoffRepoJsonPath(projectRoot: string): string {
  return path.join(projectRoot, RELATIVE_KICKOFF_REPO_FILE);
}

export async function saveKickoffRepoMetadata(
  projectRoot: string,
  data: { cloneUrl?: string; htmlUrl?: string; name?: string },
): Promise<void> {
  if (!data.cloneUrl) return;
  const dir = path.join(projectRoot, ".blueprint");
  await fs.mkdir(dir, { recursive: true });
  const payload: KickoffRepoFile = {
    cloneUrl: data.cloneUrl,
    htmlUrl: data.htmlUrl,
    name: data.name,
    savedAt: new Date().toISOString(),
  };
  await fs.writeFile(
    kickoffRepoJsonPath(projectRoot),
    JSON.stringify(payload, null, 2),
    "utf-8",
  );
}

export async function readKickoffRepoMetadata(
  projectRoot: string,
): Promise<KickoffRepoFile | null> {
  try {
    const raw = await fs.readFile(kickoffRepoJsonPath(projectRoot), "utf-8");
    return JSON.parse(raw) as KickoffRepoFile;
  } catch {
    return null;
  }
}

export async function pushGeneratedCodeToKickoffRepo(params: {
  projectRoot: string;
  codeOutputDir: string;
  token: string;
}): Promise<{ ok: boolean; message: string; detail?: string }> {
  const meta = await readKickoffRepoMetadata(params.projectRoot);
  if (!meta?.cloneUrl) {
    return {
      ok: false,
      message:
        "No kick-off GitHub repository recorded. Run kick-off with GITHUB_TOKEN so a repo is created, or push manually.",
    };
  }

  const outputRoot = path.resolve(params.projectRoot, params.codeOutputDir);
  try {
    await fs.access(outputRoot);
  } catch {
    return {
      ok: false,
      message: `Code output directory not found: ${params.codeOutputDir}`,
    };
  }

  const token = params.token.trim();
  if (!token) {
    return {
      ok: false,
      message:
        "Server has no GitHub token. Set GITHUB_TOKEN or PROJECT_KICKOFF_GITHUB_TOKEN in .env.local.",
    };
  }

  const authenticatedUrl = meta.cloneUrl.replace(
    /^https:\/\//,
    `https://x-access-token:${encodeURIComponent(token)}@`,
  );

  const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "ab-github-push-"));
  const cloneDir = path.join(tmpBase, "repo");

  try {
    await execFileAsync(
      "git",
      ["clone", "--depth", "1", authenticatedUrl, cloneDir],
      { maxBuffer: 50 * 1024 * 1024 },
    );

    const entries = await fs.readdir(outputRoot, { withFileTypes: true });
    for (const e of entries) {
      const src = path.join(outputRoot, e.name);
      const dest = path.join(cloneDir, e.name);
      await fs.cp(src, dest, { recursive: true });
    }

    await execFileAsync(
      "git",
      ["-C", cloneDir, "config", "user.email", "agentic-builder@local"],
      { maxBuffer: 1024 * 1024 },
    );
    await execFileAsync(
      "git",
      ["-C", cloneDir, "config", "user.name", "Agentic Builder"],
      { maxBuffer: 1024 * 1024 },
    );

    await execFileAsync("git", ["-C", cloneDir, "add", "-A"], {
      maxBuffer: 50 * 1024 * 1024,
    });

    const { stdout: statusOut } = await execFileAsync(
      "git",
      ["-C", cloneDir, "status", "--porcelain"],
      { maxBuffer: 1024 * 1024 },
    );
    if (!statusOut.trim()) {
      return {
        ok: true,
        message:
          "Remote repository already matches local generated-code (nothing to commit).",
      };
    }

    await execFileAsync(
      "git",
      [
        "-C",
        cloneDir,
        "commit",
        "-m",
        "chore: sync generated code from Agentic Builder",
      ],
      { maxBuffer: 1024 * 1024 },
    );

    await execFileAsync("git", ["-C", cloneDir, "push", "origin", "HEAD"], {
      maxBuffer: 50 * 1024 * 1024,
    });

    return {
      ok: true,
      message: `Pushed to ${meta.htmlUrl ?? meta.cloneUrl}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const err = e as { stderr?: Buffer };
    const stderr = err.stderr?.toString?.() ?? "";
    return {
      ok: false,
      message: "Git clone/commit/push failed",
      detail: `${msg}${stderr ? `\n${stderr}` : ""}`,
    };
  } finally {
    await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {});
  }
}
