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

    // If designSpecContent is an HTML design system doc, extract meaningful
    // design context — stripping all CSS/JS/tags to get plain readable text.
    function extractTextFromHtml(html: string): string {
      return html
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&[a-z]+;/gi, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    }

    const rawSpec = designSpecContent?.trim() ?? "";
    const isHtmlSpec = /^<!DOCTYPE|^<html/i.test(rawSpec);
    const specText = isHtmlSpec ? extractTextFromHtml(rawSpec) : rawSpec;

    const specBlock = specText
      ? `\n\nDesign System Specification (follow these component designs exactly):\n${specText}`
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
