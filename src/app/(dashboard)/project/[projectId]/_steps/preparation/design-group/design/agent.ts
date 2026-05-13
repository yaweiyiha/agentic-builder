// Step: Design — Design System Spec
// Category: custom (multi-phase: style selection → spec generation → stitch)
import { createParallelGenerateAgent } from "../../../_shared/pipeline-sse-helpers";
import type { StepAgent } from "../../../_shared/types";

// ── Module-level design context ──────────────────────────────────────────────
// Set by the UI before calling executeStep("design") so the agent can
// include the selected style / custom references in the API payload.

let _pendingDesignStyleId: string | undefined;
let _pendingStyleRefBase64: string | undefined;
let _pendingDesignDirectionPrompt: string | undefined;

export interface DesignContext {
  designStyleId?: string | null;
  styleReferenceImageBase64?: string | null;
  designDirectionPrompt?: string | null;
}

/** Call before executeStep("design") to inject style / custom-ref context. */
export function setDesignContext(params: DesignContext) {
  _pendingDesignStyleId = params.designStyleId ?? undefined;
  _pendingStyleRefBase64 = params.styleReferenceImageBase64 ?? undefined;
  _pendingDesignDirectionPrompt = params.designDirectionPrompt ?? undefined;
}

// ── StepAgent (registered in step-registry) ──────────────────────────────────

export const designAgent: StepAgent = createParallelGenerateAgent({
  stepId: "design",
  docId: "design",
  buildPayload: (ctx) => ({
    prdContent: ctx.previousSteps.prd?.content ?? ctx.featureBrief,
    selectedDocs: ["design"],
    sessionId: ctx.sessionId,
    codeOutputDir: ctx.codeOutputDir,
    tier: ctx.tier,
    designStyleId: _pendingDesignStyleId,
    styleReferenceImageBase64: _pendingStyleRefBase64,
    designDirectionPrompt: _pendingDesignDirectionPrompt,
    ...(ctx.editInstruction?.trim() ? {
      editInstruction: ctx.editInstruction.trim(),
      existingDesign: ctx.previousSteps.design?.content ?? "",
    } : {}),
  }),
});

// ── Helper: generate design styles from PRD content ─────────────────────────

export interface DesignStyle {
  id: string;
  name: string;
  description: string;
  colors: { primary: string; secondary: string; tertiary: string; neutral: string };
  typography: { headlineFont: string; bodyFont: string; labelFont: string };
  fontSizes: { h1: number; h2: number; h3: number; body: number; label: number };
  spacing: { xs: number; sm: number; md: number; lg: number; xl: number };
}

export interface GenerateDesignStylesResult {
  styles: DesignStyle[] | null;
  error: string | null;
}

export async function generateDesignStyles(
  prdContent: string,
): Promise<GenerateDesignStylesResult> {
  if (!prdContent.trim()) {
    return { styles: null, error: "PRD content is required" };
  }
  try {
    const response = await fetch("/api/agents/generate-design-styles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prdContent }),
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return {
        styles: null,
        error: (errData as { error?: string }).error || "Failed to generate design styles",
      };
    }
    const data = (await response.json()) as { styles: DesignStyle[] };
    return { styles: data.styles ?? [], error: null };
  } catch (err) {
    return {
      styles: null,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// ── Helper: run Stitch generation ────────────────────────────────────────────

export interface StitchGenerateResult {
  projectId: string;
  screenId: string;
  projectUrl: string;
  screenshotUrl: string | null;
  htmlDownloadUrl: string | null;
}

export interface StitchGenerateOutcome {
  result: StitchGenerateResult | null;
  error: string | null;
}

export async function runStitchGenerate(params: {
  prdContent: string;
  designStyleId?: string | null;
  designSpecContent?: string;
  editInstruction?: string;
}): Promise<StitchGenerateOutcome> {
  try {
    const response = await fetch("/api/agents/stitch-generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prdContent: params.prdContent,
        designStyleId: params.designStyleId ?? undefined,
        designSpecContent: params.designSpecContent ?? "",
        editInstruction: params.editInstruction?.trim() || undefined,
      }),
    });
    const data = (await response.json()) as StitchGenerateResult & { error?: string };
    if (!response.ok || data.error) {
      return { result: null, error: data.error || "Stitch generation failed" };
    }
    return {
      result: {
        projectId: data.projectId,
        screenId: data.screenId,
        projectUrl: data.projectUrl,
        screenshotUrl: data.screenshotUrl,
        htmlDownloadUrl: data.htmlDownloadUrl,
      },
      error: null,
    };
  } catch (err) {
    return {
      result: null,
      error: err instanceof Error ? err.message : "Stitch request failed",
    };
  }
}
