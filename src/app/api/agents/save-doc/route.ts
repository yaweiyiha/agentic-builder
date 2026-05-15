import { NextRequest } from "next/server";
import path from "path";
import fs from "fs/promises";
import { resolveCodeOutputRoot } from "@/lib/pipeline/code-output";

const DOC_FILENAME: Record<string, string> = {
  prd: "PRD.md",
  trd: "TRD.md",
  sysdesign: "SystemDesign.md",
  implguide: "ImplementationGuide.md",
  design: "DesignSpec.md",
  pencil: "PencilDesign.md",
  qa: "QATestCases.md",
};

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { docId, content, codeOutputDir } = body as {
    docId: string;
    content: string;
    codeOutputDir?: string;
  };

  if (!docId || content === undefined) {
    return Response.json(
      { error: "docId and content are required" },
      { status: 400 },
    );
  }

  const filename = DOC_FILENAME[docId];
  if (!filename) {
    return Response.json({ error: `Unknown docId: ${docId}` }, { status: 400 });
  }

  const outputRoot = resolveCodeOutputRoot(process.cwd(), codeOutputDir);
  const filePath = path.join(outputRoot, filename);

  try {
    await fs.mkdir(outputRoot, { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
    return Response.json({ ok: true, filename });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Write failed";
    return Response.json({ error: msg }, { status: 500 });
  }
}
