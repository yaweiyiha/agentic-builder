import { BaseAgent } from "../shared/base-agent";
import { MODEL_CONFIG } from "@/lib/model-config";
import { openRouterVisionChatCompletion, estimateCost, resolveModel } from "@/lib/openrouter";
import type { VisionContentPart } from "@/lib/llm-types";

const SYSTEM_PROMPT = `You are a senior UI/UX Design Agent for 57Blocks Agentic Builder Pod.

## Your Role
Transform PRD into detailed design specifications. Generate DESIGN.md with:
- Component hierarchy and layout structure
- Interaction specifications
- Design token mappings (colors, spacing, typography)
- Responsive behavior notes
- Accessibility guidelines

## Design System
- Framework: React + Tailwind CSS v4
- Component library: Custom components
- Animation: Motion library (framer-motion successor)
- Design tool: Pencil (.pen files via MCP)

## Output Format
Always output in Markdown:

# Design Specification: [Feature Name]

## Screen Layout
[Description of overall layout with component hierarchy]

## Components
### [ComponentName]
- **Props**: list of props
- **Behavior**: interaction details
- **States**: idle, hover, active, disabled, loading, error
- **Responsive**: breakpoint behavior

## Design Tokens
| Token | Value | Usage |
|-------|-------|-------|

## Interaction Flow
1. User action → system response
2. State transitions

## Accessibility
- ARIA roles and labels
- Keyboard navigation
- Screen reader considerations

## Pencil Integration Notes
[Notes for generating .pen file mockups]

## Rules
- All animations use Motion library
- Consistent scrollbar styling (light zinc theme)
- Mobile-responsive where applicable`;

export class DesignAgent extends BaseAgent {
  constructor() {
    super({
      name: "Design Agent",
      role: "UI/UX Designer",
      systemPrompt: SYSTEM_PROMPT,
      defaultModel: MODEL_CONFIG.design,
      temperature: 0.7,
      maxTokens: 8192,
    });
  }

  async generateDesign(
    prdContent: string,
    additionalContext?: string,
    sessionId?: string,
  ) {
    return this.run(
      `Based on the following PRD, generate a detailed design specification:\n\n${prdContent}`,
      additionalContext,
      "step-2-design",
      sessionId,
    );
  }

  async generateDesignWithReferenceImage(
    prdContent: string,
    referenceImageBase64: string,
    additionalContext?: string,
    sessionId?: string,
  ) {
    const startTime = Date.now();
    const model = resolveModel(this.config.defaultModel as string);

    const userTextParts: VisionContentPart[] = [
      {
        type: "text",
        text: [
          additionalContext?.trim() ? additionalContext.trim() : "",
          "The user has uploaded a reference image to guide the visual style. Analyze the image and incorporate its color palette, typography style, spacing, component shapes, and overall aesthetic into the design specification.",
          "",
          `Based on the following PRD, generate a detailed design specification:\n\n${prdContent}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
      {
        type: "image_url",
        image_url: { url: referenceImageBase64, detail: "auto" },
      },
    ];

    const messages = [
      { role: "system" as const, content: this.config.systemPrompt },
      { role: "user" as const, content: userTextParts },
    ];

    const resp = await openRouterVisionChatCompletion(messages, {
      model,
      temperature: this.config.temperature ?? 0.7,
      max_tokens: this.config.maxTokens ?? 8192,
    });

    const content = resp.choices[0]?.message?.content ?? "";
    const costUsd = estimateCost(resp.model, resp.usage);
    return {
      content: typeof content === "string" ? content : JSON.stringify(content),
      model: resp.model,
      costUsd,
      durationMs: Date.now() - startTime,
      usage: resp.usage,
    };
  }
}
