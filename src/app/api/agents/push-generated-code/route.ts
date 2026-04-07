import { NextRequest, NextResponse } from "next/server";
import {
  readKickoffRepoMetadata,
  pushGeneratedCodeToKickoffRepo,
} from "@/lib/pipeline/push-kickoff-repo";

export const maxDuration = 300;

function githubToken(): string {
  return (
    process.env.PROJECT_KICKOFF_GITHUB_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    ""
  );
}

export async function GET() {
  const projectRoot = process.cwd();
  const meta = await readKickoffRepoMetadata(projectRoot);
  const hasToken = githubToken().length > 0;

  return NextResponse.json({
    available: Boolean(meta?.cloneUrl),
    hasToken,
    repo: meta
      ? {
          name: meta.name,
          htmlUrl: meta.htmlUrl,
          cloneUrl: meta.cloneUrl,
          savedAt: meta.savedAt,
        }
      : null,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const codeOutputDir =
    typeof body.codeOutputDir === "string" && body.codeOutputDir.trim()
      ? body.codeOutputDir.trim()
      : "generated-code";

  const token = githubToken();
  const result = await pushGeneratedCodeToKickoffRepo({
    projectRoot: process.cwd(),
    codeOutputDir,
    token,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, detail: result.detail },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, message: result.message });
}
