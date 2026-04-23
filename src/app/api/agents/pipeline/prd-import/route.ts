import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

/**
 * PRD import endpoint — lets the user bring their own PRD instead of having
 * the PM agent regenerate one every time.
 *
 * Mechanics: the engine (`PipelineEngine.readStaticPrd`) already prefers
 * `.blueprint/PRD.md` over the LLM output when present, so we only need to
 * write / read / delete that file from the UI.
 */

const BLUEPRINT_DIR = ".blueprint";
const PRD_FILE_NAME = "PRD.md";

const MAX_IMPORT_BYTES = 500_000;

function blueprintDir() {
  return path.resolve(process.cwd(), BLUEPRINT_DIR);
}

function prdFilePath() {
  return path.join(blueprintDir(), PRD_FILE_NAME);
}

interface ImportedPrdStatus {
  exists: boolean;
  bytes: number;
  updatedAt: string | null;
  preview: string;
}

async function readImportedPrdStatus(): Promise<ImportedPrdStatus> {
  try {
    const filePath = prdFilePath();
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

export async function GET() {
  const status = await readImportedPrdStatus();
  return NextResponse.json(status);
}

export async function POST(request: NextRequest) {
  let body: { content?: string } = {};
  try {
    body = (await request.json()) as { content?: string };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body. Expected { content: string }." },
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

  try {
    await fs.mkdir(blueprintDir(), { recursive: true });
    await fs.writeFile(prdFilePath(), content, "utf-8");
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

  const status = await readImportedPrdStatus();
  return NextResponse.json({ ok: true, status });
}

export async function DELETE() {
  try {
    await fs.unlink(prdFilePath());
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
  const status = await readImportedPrdStatus();
  return NextResponse.json({ ok: true, status });
}
