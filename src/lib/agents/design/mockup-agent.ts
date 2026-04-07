import { BaseAgent } from "../shared/base-agent";
import { MODEL_CONFIG } from "@/lib/model-config";

const SYSTEM_PROMPT = `You are a Mockup Agent for 57Blocks Agentic Builder Pod.

## Your Role
Transform a design specification (DESIGN.md) into a set of **self-contained, runnable React + Tailwind CSS static mockup pages**.

Your output is a JSON object whose keys are file paths (relative to the mockup root) and values are the full source code of each file. The mockup must demonstrate the full user flow with realistic mock data—no real backend required.

## Output Format
Respond with a single JSON code block and nothing else:

\`\`\`json
{
  "pages/index.tsx": "...",
  "pages/[other-page].tsx": "...",
  "components/[ComponentName].tsx": "...",
  "lib/mock-data.ts": "...",
  "README.md": "..."
}
\`\`\`

## Stack & Rules
- React 18 + TypeScript + Tailwind CSS v3 (use className, no CSS modules)
- All animations via **motion** (import from "motion/react")
- Dark theme: bg-zinc-950 / bg-zinc-900 body; text-zinc-100; accent indigo-500
- Scrollbars: [&::-webkit-scrollbar] custom dark variant inline in JSX className
- Inline mock data only — no fetch() calls, no real APIs
- Each page must be a complete default export functional component
- Shared layout in a Layout component; pages use it
- Interactive: navigation links work (Next.js Link or plain <a href> for mockup)
- Loading states use a consistent Spinner (zinc-600 border, indigo accent) — same across all pages
- Include a README.md explaining how to run (\`npx create-next-app --example\` or paste into existing Next.js project)
- All pages must match the visual intent in the design spec: layout, components, states, spacing tokens

## Pencil Context
If "[PENCIL_NOTES]" section is provided, use those notes to refine layout positions and component sizes. Treat them as supplementary visual hints—the DESIGN.md spec is the primary source of truth.

## Constraints
- Output ONLY the JSON block — no prose before or after
- If a section in the spec is incomplete, implement a reasonable placeholder that matches the design system
- Do NOT use any CSS file (use Tailwind only)
- Do NOT add comments that just narrate the code`;

export class MockupAgent extends BaseAgent {
  constructor() {
    super({
      name: "Mockup Agent",
      role: "Static Mockup Generator",
      systemPrompt: SYSTEM_PROMPT,
      defaultModel: MODEL_CONFIG.mockup,
      temperature: 0.4,
      maxTokens: 16384,
    });
  }

  async generateMockup(
    designContent: string,
    prdContent: string,
    pencilNotes?: string,
    sessionId?: string
  ) {
    const pencilSection = pencilNotes
      ? `\n\n[PENCIL_NOTES]\n${pencilNotes}`
      : "";

    const prompt = `Generate a complete static React mockup based on the following inputs.

---
## PRD Summary
${prdContent}

---
## Design Specification (DESIGN.md)
${designContent}${pencilSection}
---

Produce the full file map as described. Cover all P0 pages and the complete primary user flow.`;

    return this.run(prompt, undefined, "step-mockup", sessionId);
  }

  /** Parse the JSON file-map from the LLM content string. */
  static parseFileMap(content: string): Record<string, string> {
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (!match) return {};
    try {
      return JSON.parse(match[1].trim()) as Record<string, string>;
    } catch {
      return {};
    }
  }
}
