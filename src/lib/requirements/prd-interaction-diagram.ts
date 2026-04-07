import { chatCompletion, estimateCost, resolveModel } from "@/lib/openrouter";
import { MODEL_CONFIG } from "@/lib/model-config";
import type { ChatMessage } from "@/lib/llm-types";

/**
 * Builds an English prompt for a simple screen-flow wireframe (cheap image model).
 */
export function buildInteractionDiagramPrompt(
  featureBrief: string,
  prdMarkdown: string,
): string {
  const brief = featureBrief.trim().slice(0, 2000);
  const excerpt = prdMarkdown.trim().slice(0, 4000);
  return [
    "Generate a single simple diagram image: black and white wireframe / UX flow.",
    "Show main screens or views as rounded rectangles, labeled with short names only.",
    "Use arrows to show primary navigation and user flow between screens.",
    "No photos, no gradients, no decorative art — technical product sketch only.",
    "Keep labels minimal (2–4 words per box). White background, dark gray lines.",
    "",
    "## Product brief",
    brief || "(none)",
    "",
    "## PRD excerpt (pages, routes, flows)",
    excerpt || "(none)",
  ].join("\n");
}

export async function appendPrdInteractionDiagramMarkdown(
  prdMarkdown: string,
  featureBrief: string,
): Promise<{ content: string; extraCostUsd: number }> {
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: buildInteractionDiagramPrompt(featureBrief, prdMarkdown),
    },
  ];

  try {
    const model = resolveModel(MODEL_CONFIG.prdInteractionImage);
    const res = await chatCompletion(messages, {
      model,
      modalities: ["image", "text"],
      max_tokens: 256,
      temperature: 0.35,
      image_config: { aspect_ratio: "16:9" },
    });

    const msg = res.choices[0]?.message;
    const first = msg?.images?.[0];
    const url =
      first &&
      typeof first === "object" &&
      "image_url" in first &&
      first.image_url?.url
        ? first.image_url.url
        : null;

    const extraCostUsd = estimateCost(res.model, res.usage);

    if (!url) {
      return {
        content: `${prdMarkdown}\n\n---\n\n## Generated interaction diagram\n\n*No image was returned by the image model (\`${res.model}\`). The Mermaid diagram in this PRD still describes the flow.*\n`,
        extraCostUsd,
      };
    }

    return {
      content: `${prdMarkdown}\n\n---\n\n## Generated interaction diagram\n\n![Screen flow overview](${url})\n\n*Auto-generated wireframe-style flow (OpenRouter image model).*\n`,
      extraCostUsd,
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      content: `${prdMarkdown}\n\n---\n\n## Generated interaction diagram\n\n*Skipped diagram image: ${detail}*\n`,
      extraCostUsd: 0,
    };
  }
}
