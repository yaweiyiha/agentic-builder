import { NextRequest, NextResponse } from "next/server";
import {
  addDesignReference,
  clearAllDesignReferences,
  readManifest,
} from "@/lib/pipeline/design-references";

export const runtime = "nodejs";

function projectRoot() {
  return process.cwd();
}

export async function GET() {
  const manifest = await readManifest(projectRoot());
  return NextResponse.json({ references: manifest });
}

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Expected multipart/form-data: ${err.message}`
            : "Expected multipart/form-data.",
      },
      { status: 400 },
    );
  }

  const files = form.getAll("file");
  if (files.length === 0) {
    return NextResponse.json(
      {
        error:
          "Provide at least one image under the `file` field (multiple allowed).",
      },
      { status: 400 },
    );
  }
  const labels = form.getAll("label").map((v) => (typeof v === "string" ? v : ""));
  const pageHints = form
    .getAll("pageHint")
    .map((v) => (typeof v === "string" ? v : ""));

  const added: Array<{ id: string; fileName: string }> = [];
  const skipped: Array<{ fileName: string; reason: string }> = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!(file instanceof Blob)) {
      skipped.push({
        fileName: `entry-${i}`,
        reason: "Not a File/Blob payload.",
      });
      continue;
    }
    const fileName =
      file instanceof File && file.name ? file.name : `upload-${i + 1}`;
    const mime = file.type || "application/octet-stream";
    const arrayBuf = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    const result = await addDesignReference(projectRoot(), {
      fileName,
      mime,
      bytes: buffer,
      label: labels[i] ?? "",
      pageHint: pageHints[i] ?? "",
    });

    if (!result.ok) {
      skipped.push({ fileName, reason: result.error });
      continue;
    }
    added.push({ id: result.entry.id, fileName: result.entry.fileName });
  }

  const manifest = await readManifest(projectRoot());
  const status = added.length > 0 ? 200 : 400;
  return NextResponse.json(
    {
      ok: added.length > 0,
      added,
      skipped,
      references: manifest,
    },
    { status },
  );
}

export async function DELETE(request: NextRequest) {
  const url = new URL(request.url);
  if (url.searchParams.get("all") === "true") {
    await clearAllDesignReferences(projectRoot());
    return NextResponse.json({ ok: true, references: [] });
  }
  return NextResponse.json(
    {
      error:
        "Use ?all=true to wipe everything, or DELETE /design-references/<id> to remove one.",
    },
    { status: 400 },
  );
}
