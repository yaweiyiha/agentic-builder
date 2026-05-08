import { NextRequest, NextResponse } from "next/server";
import { getDesignStylePreset } from "@/lib/pipeline/design-style-presets";
import { generateStitchScreen } from "@/lib/stitch-api";

export const maxDuration = 300; // 5 min — Stitch generation can be slow

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      prdContent,
      designStyleId,
      designSpecContent,
      projectTitle,
      editInstruction,
    } = body as {
      prdContent?: string;
      designStyleId?: string;
      designSpecContent?: string;
      projectTitle?: string;
      editInstruction?: string;
    };

    if (!prdContent?.trim()) {
      return NextResponse.json({ error: "prdContent is required" }, { status: 400 });
    }

    // ── Build Stitch prompt ──────────────────────────────────────────────────
    const style = getDesignStylePreset(designStyleId);

    const prdLines = (prdContent ?? "")
      .split("\n")
      .filter((l) => l.trim())
      .slice(0, 40)
      .join("\n");

    const specBlock = designSpecContent?.trim()
      ? `\n\nDesign Specification Summary:\n${designSpecContent.slice(0, 800)}`
      : "";

    const styleBlock =
      `\n\nVisual Style: ${style.labelKey}.\n` + style.pencilPrompt;

    const instructionBlock = editInstruction?.trim()
      ? `\n\nAdditional instruction: ${editInstruction.trim()}`
      : "";

    const prompt =
      `Create a high-fidelity desktop UI design for the following product:\n\n` +
      prdLines +
      styleBlock +
      specBlock +
      instructionBlock;

    console.log("[stitch-generate] prompt length:", prompt.length);

    // ── Call Stitch ──────────────────────────────────────────────────────────
    const result = await generateStitchScreen(
      prompt,
      projectTitle ?? "AgenticBuilder Design",
    );

    return NextResponse.json({
      ok: true,
      projectId: result.projectId,
      screenId: result.screenId,
      projectUrl: result.projectUrl,
      screenshotUrl: result.screenshotUrl,
      htmlDownloadUrl: result.htmlDownloadUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[stitch-generate] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
