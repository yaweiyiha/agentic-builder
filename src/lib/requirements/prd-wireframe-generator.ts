import {
  generateSeedreamImage,
  isSeedreamConfigured,
} from "@/lib/image-gen/seedream-client";
import type { PrdPage, PrdPageWireframe, PrdSpec } from "./prd-spec-types";

/**
 * Build a SeeDream image prompt for a hand-drawn wireframe of one PRD page.
 * Keeps the prompt instructional and layout-focused (no artistic decoration).
 */
export function buildWireframePrompt(page: PrdPage): string {
  const componentLines = page.interactiveComponents
    .map(
      (c) =>
        `  - [${c.id}] ${c.name} (${c.type}): ${c.interaction} → ${c.effect}`,
    )
    .join("\n");

  const staticLines = page.staticElements
    .map((e) => `  - ${e}`)
    .join("\n");

  const regionLines = page.layoutRegions
    .map((r) => `  - ${r}`)
    .join("\n");

  return [
    "Simple hand-drawn wireframe sketch of a web/app UI screen.",
    "Style: rough pencil lines on white paper, technical wireframe, boxes for containers, no colors, no gradients, no photos.",
    "Label every interactive control with its component ID in square brackets (e.g. [CMP-001]).",
    "Make labels small and clear. Use arrows for navigation flows.",
    "",
    `Screen name: ${page.name}`,
    `Route: ${page.route}`,
    "",
    "Layout regions (top to bottom):",
    regionLines || "  (none specified)",
    "",
    "Interactive controls to draw and label:",
    componentLines || "  (none specified)",
    "",
    "Static / non-interactive elements:",
    staticLines || "  (none specified)",
    "",
    "Drawing style: architectural wireframe sketch, ballpoint pen, clean and readable, UX mockup, black on white.",
  ]
    .join("\n")
    .trim();
}

/**
 * Generate a SeeDream wireframe image for a single PRD page.
 * Returns the public image URL on success, or `null` on error (non-blocking).
 */
async function generatePageWireframe(
  page: PrdPage,
): Promise<PrdPageWireframe | null> {
  try {
    const prompt = buildWireframePrompt(page);
    const res = await generateSeedreamImage(prompt, { size: "1K" });
    const url = res.data?.[0]?.url;
    if (!url) return null;
    return { pageId: page.id, pageName: page.name, imageUrl: url };
  } catch (e) {
    console.warn(
      `[PrdWireframe] Failed to generate wireframe for ${page.id} (${page.name}):`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/**
 * Generate wireframe images for every page in the PrdSpec.
 *
 * - Runs sequentially to avoid rate-limit issues.
 * - Silently skips pages that fail.
 * - Returns an empty array when SeeDream is not configured.
 */
export async function generatePrdWireframes(
  spec: PrdSpec,
): Promise<PrdPageWireframe[]> {
  if (!isSeedreamConfigured()) {
    console.info("[PrdWireframe] SEEDREAM_API_KEY not set — skipping wireframe generation.");
    return [];
  }

  const results: PrdPageWireframe[] = [];
  for (const page of spec.pages) {
    const wireframe = await generatePageWireframe(page);
    if (wireframe) results.push(wireframe);
  }
  return results;
}
