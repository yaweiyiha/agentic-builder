import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { resolveCodeOutputRoot } from "@/lib/pipeline/code-output";

/**
 * PRD import endpoint — lets the user bring their own PRD instead of having
 * the PM agent regenerate one every time.
 *
 * Mechanics: when this endpoint writes `<outputRoot>/.blueprint/PRD.md`, the
 * next pipeline run sees it via `PipelineEngine.readImportedPrd()` (engine.ts)
 * and skips the PM agent's `generatePRDStreaming` call entirely — the file's
 * content becomes the PRD step's output verbatim. The structured-spec extractor
 * (`attachPrdStructuredSpec`) still runs against this content so domain.rules
 * and other downstream fields are extracted normally.
 *
 * `codeOutputDir` is passed as a query param (GET/DELETE) or body field (POST)
 * to scope the imported PRD to a specific project output directory. This prevents
 * one project's imported PRD from leaking into a different project.
 */

const BLUEPRINT_SUBDIR = ".blueprint";
const PRD_FILE_NAME = "PRD.md";

const MAX_IMPORT_BYTES = 500_000;

function resolveOutputRoot(codeOutputDir?: string | null): string {
  return resolveCodeOutputRoot(process.cwd(), codeOutputDir ?? undefined);
}

function blueprintDir(outputRoot: string): string {
  return path.join(outputRoot, BLUEPRINT_SUBDIR);
}

function prdFilePath(outputRoot: string): string {
  return path.join(blueprintDir(outputRoot), PRD_FILE_NAME);
}

interface ImportedPrdStatus {
  exists: boolean;
  bytes: number;
  updatedAt: string | null;
  preview: string;
}

async function readImportedPrdStatus(outputRoot: string): Promise<ImportedPrdStatus> {
  try {
    const filePath = prdFilePath(outputRoot);
    const [raw, stat] = await Promise.all([
      fs.readFile(filePath, "utf-8"),
      fs.stat(filePath),
    ]);
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return { exists: false, bytes: 0, updatedAt: null, preview: "" };
    }
    return {
      exists: true,
      bytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
      preview: trimmed.slice(0, 400),
    };
  } catch {
    return { exists: false, bytes: 0, updatedAt: null, preview: "" };
  }
}

export async function GET(request: NextRequest) {
  const codeOutputDir = request.nextUrl.searchParams.get("codeOutputDir");
  const outputRoot = resolveOutputRoot(codeOutputDir);
  const status = await readImportedPrdStatus(outputRoot);
  return NextResponse.json(status);
}

export async function POST(request: NextRequest) {
  let body: { content?: string; codeOutputDir?: string } = {};
  try {
    body = (await request.json()) as { content?: string; codeOutputDir?: string };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body. Expected { content: string, codeOutputDir?: string }." },
      { status: 400 },
    );
  }

  const content = typeof body.content === "string" ? body.content : "";
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return NextResponse.json(
      { error: "PRD content is empty — nothing to import." },
      { status: 400 },
    );
  }
  if (Buffer.byteLength(content, "utf-8") > MAX_IMPORT_BYTES) {
    return NextResponse.json(
      {
        error: `PRD content exceeds the ${MAX_IMPORT_BYTES.toLocaleString()}-byte import limit.`,
      },
      { status: 413 },
    );
  }

  const outputRoot = resolveOutputRoot(body.codeOutputDir);

  try {
    await fs.mkdir(blueprintDir(outputRoot), { recursive: true });
    await fs.writeFile(prdFilePath(outputRoot), content, "utf-8");
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Failed to save imported PRD: ${err.message}`
            : "Failed to save imported PRD.",
      },
      { status: 500 },
    );
  }

  const status = await readImportedPrdStatus(outputRoot);
  return NextResponse.json({ ok: true, status });
}

export async function DELETE(request: NextRequest) {
  const codeOutputDir = request.nextUrl.searchParams.get("codeOutputDir");
  const outputRoot = resolveOutputRoot(codeOutputDir);

  try {
    await fs.unlink(prdFilePath(outputRoot));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? `Failed to clear imported PRD: ${err.message}`
              : "Failed to clear imported PRD.",
        },
        { status: 500 },
      );
    }
  }
  const status = await readImportedPrdStatus(outputRoot);
  return NextResponse.json({ ok: true, status });
}
