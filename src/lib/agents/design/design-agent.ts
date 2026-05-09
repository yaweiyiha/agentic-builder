import { BaseAgent } from "../shared/base-agent";
import { MODEL_CONFIG } from "@/lib/model-config";
import { openRouterVisionChatCompletion, estimateCost, resolveModel } from "@/lib/openrouter";
import type { VisionContentPart } from "@/lib/llm-types";

const SYSTEM_PROMPT = `You are a senior UI/UX Design Agent for 57Blocks Agentic Builder Pod.

## Your Role
Transform a PRD into a **complete, self-contained HTML Design System document** — a living style guide that developers can open directly in a browser.

## Output Format — CRITICAL
Output ONLY a single complete HTML file. No markdown, no code fences, no explanation outside the HTML.
The file must:
- Begin exactly with <!DOCTYPE html> and end with </html>
- Embed ALL CSS inline in a <style> tag (no external CSS, except Google Fonts CDN)
- Embed ALL JS inline in a <script> tag
- Load fonts from Google Fonts CDN only: Inter (weights 300–700) + Fira Code (weights 400–700)
- Be fully self-contained and renderable in an <iframe srcDoc> with sandbox="allow-scripts allow-same-origin"

## Required HTML Structure
Produce sections in this order:

1. **Left TOC sidebar** — fixed, 220px wide, lists all section anchors (no top nav bar needed)
2. **Main content area** (margin-left: 220px) with:
   a. Hero — product name + short description + style badges
   b. 🎨 Color System — CSS :root token swatches (backgrounds, brand/primary, semantic status, plus a dedicated risk/semantic color block if applicable to the product)
   c. 📐 Typography — font family pairs, scale table (sizes, weights, line-heights, usage)
   d. 📏 Spacing — spacing scale (4px base unit, common steps 4–24px) with visual bars
   e. ⬜ Radius — 3 tiers (sm/md/lg) with visual samples
   f. 🌫 Shadows — shadow tokens with visual demos
   g. 🧩 Components — live HTML demos of: Buttons (primary/secondary/danger/sm/disabled), Badges (colored dots), Inputs & Selects, Tabs (pill + segment), Cards (basic + KPI grid), Data Table, Alert Feed
   h. 📐 Page Patterns — Sidebar nav demo, Topbar demo, plus any domain-specific patterns (metric cards, score rings, timelines, etc.)
   i. 📋 CSS Token Quick Reference — a styled <pre> code block showing the full :root {} token map

## Design Token Requirements
Derive all tokens from the selected visual style and product domain. Define them as CSS custom properties in :root. Use semantic naming:
- --bg, --surface, --border
- --primary, --primary-light, --primary-dark  (brand main color)
- --text-primary, --text-secondary, --text-muted
- --shadow-sm, --shadow-md
- --radius-sm (8px), --radius-md (12px), --radius-lg (16px)
- Status/semantic colors as needed by the product (e.g., --risk-normal, --risk-elevated, --risk-high, --risk-critical or --status-success, --status-warning, --status-error)

## Visual Quality Rules
- Professional, data-dense, light-mode aesthetic (unless the chosen style is explicitly dark)
- Font: Inter for UI text, Fira Code (monospace) for tokens and data values
- All component demos must be LIVE HTML — actual rendered components, not screenshots or placeholders
- Color swatch cards: show colored block + var name + hex value
- Component demos: show all states side-by-side (default, hover label, active, disabled, error)
- Include JS for smooth scrolling and active TOC highlighting on scroll
- Custom scrollbar styling (thin, subtle)

## Framework Context
- Implementation target: React + Tailwind CSS v4
- Component library: Custom components
- Animation: Motion library (framer-motion successor)

## Completeness Rules — CRITICAL
- Output ONLY the HTML. No preamble, no explanation, no code fences.
- The very first character of output must be < (start of <!DOCTYPE html>)
- You MUST include ALL 9 sections (a through i) listed above. Do NOT stop after Color System.
- Every section must contain real rendered HTML content — no placeholders, no "TODO", no "coming soon".
- Tokens and demos must be tailored specifically to the product described in the PRD — not generic placeholders.
- Do NOT truncate the HTML. The output must end with </html>.
- Budget roughly: Colors 10%, Typography 10%, Spacing+Radius+Shadows 10%, Components 40%, Page Patterns 20%, Token Reference 10%.`;

export class DesignAgent extends BaseAgent {
  constructor() {
    super({
      name: "Design Agent",
      role: "UI/UX Designer",
      systemPrompt: SYSTEM_PROMPT,
      defaultModel: MODEL_CONFIG.design,
      temperature: 0.7,
      maxTokens: 32000,
    });
  }

  async generateDesign(
    prdContent: string,
    additionalContext?: string,
    sessionId?: string,
  ) {
    return this.run(
      `Based on the following PRD, generate a complete self-contained HTML Design System document as described in your instructions.\n\nYou MUST generate ALL sections in order:\n1. Left TOC sidebar\n2. Hero\n3. Color System (backgrounds, brand, text, status, semantic)\n4. Typography (font pairs, scale table)\n5. Spacing (visual bar scale)\n6. Radius + Shadows\n7. Components (buttons, badges, inputs, tabs, cards, KPI grid, data table, alert feed)\n8. Page Patterns (sidebar nav, topbar, domain-specific patterns)\n9. CSS Token Quick Reference\n\nDo NOT stop early. Output ONLY the HTML — start with <!DOCTYPE html> and end with </html>.\n\nPRD:\n\n${prdContent}`,
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
          "The user has uploaded a reference image to guide the visual style. Analyze the image and incorporate its color palette, typography style, spacing, component shapes, and overall aesthetic into the HTML Design System document.",
          "",
          `Based on the following PRD, generate a complete self-contained HTML Design System document as described in your instructions. Output ONLY the HTML — start with <!DOCTYPE html> and end with </html>.\n\nPRD:\n\n${prdContent}`,
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
