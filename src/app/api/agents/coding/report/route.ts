import { NextRequest } from "next/server";
import path from "path";
import fs from "fs/promises";
import { resolveCodeOutputRoot } from "@/lib/pipeline/code-output";

export const maxDuration = 30;

interface ReportMeta {
  sessionId: string;
  endedAt: string;
  status: string;
  score: number;
  grade: string;
  archiveMdFile: string;
}

/**
 * Read the most recent coding session report as markdown.
 *
 * Query params:
 *   - `outputDir` (optional): relative to the project root or absolute. Falls
 *     back to the configured default code output root.
 *   - `sessionId` (optional): if present, load the per-session archived
 *     report instead of the latest pointer.
 *
 * Returns JSON:
 *   { markdown: string, source: "latest" | "session", sessionId?: string,
 *     history?: ReportMeta[] }
 *
 * Rejects requests that try to escape the resolved output root.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const outputDirParam = url.searchParams.get("outputDir");
  const sessionId = url.searchParams.get("sessionId");

  const projectRoot = process.cwd();
  const outputRoot = resolveCodeOutputRoot(projectRoot, outputDirParam);
  const ralphDir = path.join(outputRoot, ".ralph");

  let markdown: string;
  let source: "latest" | "session";

  try {
    if (sessionId) {
      const sessionMdPath = path.join(
        ralphDir,
        `coding-session-report.${sessionId}.md`,
      );
      const normalized = path.normalize(sessionMdPath);
      if (!normalized.startsWith(ralphDir)) {
        return new Response(
          JSON.stringify({ error: "Invalid session id." }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      markdown = await fs.readFile(normalized, "utf-8");
      source = "session";
    } else {
      const latestPath = path.join(ralphDir, "coding-session-report.md");
      markdown = await fs.readFile(latestPath, "utf-8");
      source = "latest";
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({
        error:
          "No report available yet. Finish a coding session first, or check the output directory.",
        detail: msg,
        resolvedPath: ralphDir,
      }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  let history: ReportMeta[] = [];
  try {
    const historyRaw = await fs.readFile(
      path.join(ralphDir, "coding-session-report-history.json"),
      "utf-8",
    );
    const parsed = JSON.parse(historyRaw);
    if (Array.isArray(parsed)) {
      history = parsed
        .filter(
          (entry): entry is Record<string, unknown> =>
            !!entry && typeof entry === "object",
        )
        .map((entry) => ({
          sessionId: String(entry.sessionId ?? ""),
          endedAt: String(entry.endedAt ?? ""),
          status: String(entry.status ?? ""),
          score:
            typeof entry.score === "number"
              ? entry.score
              : Number(entry.score ?? 0),
          grade: String(entry.grade ?? ""),
          archiveMdFile: String(entry.archiveMdFile ?? ""),
        }))
        .filter((entry) => entry.sessionId.length > 0);
    }
  } catch {
    // History is optional — missing/unreadable file is fine.
  }

  // Load scorecard and leaderboard markdown in parallel — non-fatal if missing.
  const [scorecardMarkdown, leaderboardMarkdown] = await Promise.all([
    fs
      .readFile(path.join(ralphDir, "model-scorecard.md"), "utf-8")
      .catch(() => null),
    fs
      .readFile(path.join(ralphDir, "model-leaderboard.md"), "utf-8")
      .catch(() => null),
  ]);

  return new Response(
    JSON.stringify({
      markdown,
      source,
      sessionId: sessionId ?? null,
      outputDir: outputRoot,
      history,
      scorecardMarkdown: scorecardMarkdown ?? null,
      leaderboardMarkdown: leaderboardMarkdown ?? null,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}
