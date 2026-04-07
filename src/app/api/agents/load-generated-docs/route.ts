import { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";
import { resolveCodeOutputRoot } from "@/lib/pipeline/code-output";

const DOC_MAP: Record<string, string[]> = {
  prd: ["PRD.md"],
  trd: ["TRD.md"],
  sysdesign: ["SystemDesign.md"],
  implguide: ["ImplementationGuide.md", "ImpelementGuide.md"],
  design: ["DesignSpec.md"],
  pencil: ["PencilDesign.md"],
};

export async function GET(request: NextRequest) {
  const dir = request.nextUrl.searchParams.get("dir") || undefined;
  const outputRoot = resolveCodeOutputRoot(process.cwd(), dir);

  const docs: Record<string, string> = {};

  for (const [stepId, filenames] of Object.entries(DOC_MAP)) {
    for (const filename of filenames) {
      try {
        const content = await fs.readFile(
          path.join(outputRoot, filename),
          "utf-8",
        );
        if (content.trim()) {
          docs[stepId] = content;
          break;
        }
      } catch {
        /* skip */
      }
    }
  }

  return Response.json({ docs, outputRoot });
}
