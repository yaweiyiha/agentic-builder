import path from "path";
import fs from "fs/promises";

/** Reject traversal and absolute keys inside the archive map. */
export function sanitizeRelativeFileKey(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return null;
  const normalized = path.normalize(trimmed);
  if (path.isAbsolute(normalized)) return null;
  const parts = normalized.split(path.sep);
  if (parts.some((p) => p === "..")) return null;
  return normalized.replace(/^[\\/]+/, "");
}

export function resolveCodeOutputRoot(
  projectRoot: string,
  userDir: string | undefined | null,
): string {
  const fromEnv = process.env.CODE_OUTPUT_DIR?.trim();
  const raw = (userDir?.trim() || fromEnv || "generated-code").trim();
  if (!raw) return path.resolve(projectRoot, "generated-code");
  if (path.isAbsolute(raw)) return path.resolve(raw);
  return path.resolve(projectRoot, raw);
}

export async function writeCodegenFileMap(
  outputRoot: string,
  fileMap: Record<string, string>,
): Promise<{ written: string[]; errors: string[] }> {
  const written: string[] = [];
  const errors: string[] = [];

  await fs.mkdir(outputRoot, { recursive: true });

  for (const [relKey, contents] of Object.entries(fileMap)) {
    const safe = sanitizeRelativeFileKey(relKey);
    if (!safe) {
      errors.push(`Rejected path: ${relKey}`);
      continue;
    }
    const dest = path.join(outputRoot, safe);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, contents, "utf-8");
    written.push(safe);
  }

  return { written, errors };
}

export function buildGitInitInstructions(outputRootAbs: string): string {
  const q = outputRootAbs.includes(" ") ? `"${outputRootAbs}"` : outputRootAbs;
  return [
    "## Initialize a Git repository",
    "",
    "Run these commands in a terminal:",
    "",
    "```bash",
    `cd ${q}`,
    "git init",
    "git add .",
    'git commit -m "chore: initial import from Agentic Builder"',
    "```",
    "",
    "Then add a remote and push when ready:",
    "",
    "```bash",
    "git remote add origin <your-repo-url>",
    "git branch -M main",
    "git push -u origin main",
    "```",
  ].join("\n");
}
