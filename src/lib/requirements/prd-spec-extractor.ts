import { chatCompletion } from "@/lib/openrouter";
import { MODEL_CONFIG } from "@/lib/model-config";
import type { PrdInteractiveComponent, PrdPage, PrdSpec } from "./prd-spec-types";

const SYSTEM_PROMPT = `You are a product analyst. Extract a structured page specification from a PRD.
Return ONLY a valid JSON object — no markdown, no explanation. Follow this exact schema:

{
  "pages": [
    {
      "id": "PAGE-001",
      "name": "Main Timer View",
      "route": "/",
      "layoutRegions": [
        "Header: App title text",
        "Body: Timer display + Start/Stop button + duration inputs",
        "Footer: Session counter + Settings link"
      ],
      "interactiveComponents": [
        {
          "id": "CMP-001",
          "name": "Start/Stop Button",
          "type": "button",
          "location": "Body",
          "interaction": "Click",
          "effect": "Timer starts counting down; button label switches to 'Pause'; title changes to 'Focus session active'"
        }
      ],
      "staticElements": [
        "Timer display (MM:SS format)",
        "Session counter label"
      ],
      "states": ["idle", "running", "paused", "break"]
    }
  ]
}

Assignment rules:
- PAGE-001, PAGE-002 … sequentially.
- CMP-001, CMP-002 … sequentially across ALL pages (global, not per-page).
- Every interactive element (button, input, toggle, checkbox, select, link, tab, form field, drag handle, etc.) gets its own CMP-*.
- "type" must be one of: button | input | toggle | checkbox | select | radio | link | tab | form | modal | dropdown | slider | search | drag | list-item | icon-button | other.
- "interaction" is the user trigger: Click | Tap | Type | Change | Blur | Toggle | Select | Drag | Hover | Focus | Submit | Keyboard shortcut.
- "effect" describes: (a) immediate visual feedback, AND (b) resulting state/action.
- "staticElements": read-only labels, counters, headings, images — no interaction.
- "states": ONLY states explicitly mentioned or clearly implied by the PRD (e.g. loading, empty, error, success, idle, running, paused).
- If the PRD mentions a modal, drawer, or popover, treat it as a separate page entry (PAGE-xxx with route "modal:/name" or "drawer:/name").
- Keep every field concise (≤ 25 words per field value).`;

interface RawPrdSpec {
  pages: RawPrdPage[];
}

interface RawPrdPage {
  id?: string;
  name?: string;
  route?: string;
  layoutRegions?: string[];
  interactiveComponents?: RawPrdComponent[];
  staticElements?: string[];
  states?: string[];
}

interface RawPrdComponent {
  id?: string;
  name?: string;
  type?: string;
  location?: string;
  interaction?: string;
  effect?: string;
}

function normalizePage(raw: RawPrdPage, pageIdx: number): PrdPage {
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : `PAGE-${String(pageIdx + 1).padStart(3, "0")}`,
    name: typeof raw.name === "string" ? raw.name : `Page ${pageIdx + 1}`,
    route: typeof raw.route === "string" ? raw.route : "/",
    layoutRegions: Array.isArray(raw.layoutRegions)
      ? raw.layoutRegions.filter((r): r is string => typeof r === "string")
      : [],
    interactiveComponents: Array.isArray(raw.interactiveComponents)
      ? raw.interactiveComponents
          .filter((c): c is RawPrdComponent => !!c && typeof c === "object")
          .map((c, ci) => normalizeComponent(c, ci))
      : [],
    staticElements: Array.isArray(raw.staticElements)
      ? raw.staticElements.filter((s): s is string => typeof s === "string")
      : [],
    states: Array.isArray(raw.states)
      ? raw.states.filter((s): s is string => typeof s === "string")
      : [],
  };
}

function normalizeComponent(raw: RawPrdComponent, idx: number): PrdInteractiveComponent {
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : `CMP-${String(idx + 1).padStart(3, "0")}`,
    name: typeof raw.name === "string" ? raw.name : `Component ${idx + 1}`,
    type: typeof raw.type === "string" ? raw.type : "other",
    location: typeof raw.location === "string" ? raw.location : "",
    interaction: typeof raw.interaction === "string" ? raw.interaction : "",
    effect: typeof raw.effect === "string" ? raw.effect : "",
  };
}

function parsePrdSpec(raw: string): PrdSpec | null {
  let cleaned = raw.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  const objStart = cleaned.indexOf("{");
  const objEnd = cleaned.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    cleaned = cleaned.slice(objStart, objEnd + 1);
  }
  try {
    const parsed = JSON.parse(cleaned) as RawPrdSpec;
    if (!Array.isArray(parsed?.pages)) return null;
    const pages: PrdPage[] = parsed.pages
      .filter((p): p is RawPrdPage => !!p && typeof p === "object")
      .map((p, i) => normalizePage(p, i));
    const allComponentIds = pages.flatMap((p) =>
      p.interactiveComponents.map((c) => c.id),
    );
    return { pages, allComponentIds };
  } catch {
    return null;
  }
}

/**
 * Uses a cheap LLM call to extract a structured `PrdSpec` (pages + component IDs) from PRD markdown.
 * Returns `null` when the LLM output cannot be parsed.
 */
export async function extractPrdSpec(
  prdMarkdown: string,
  sessionId?: string,
): Promise<PrdSpec | null> {
  const model = MODEL_CONFIG.prdSpecExtract;
  try {
    const res = await chatCompletion(
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Extract the structured page specification from this PRD.\n\n---\n\n${prdMarkdown.slice(0, 24000)}`,
        },
      ],
      { model, temperature: 0.1, max_tokens: 8192 },
    );
    const content = res.choices[0]?.message?.content ?? "";
    return parsePrdSpec(content);
  } catch (e) {
    console.error("[PrdSpecExtractor] LLM call failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Format a PrdSpec into human-readable text for LLM context. */
export function formatPrdSpecForContext(spec: PrdSpec): string {
  const lines: string[] = [
    "## Structured PRD Spec (use these IDs in coversRequirementIds)",
    "",
  ];
  for (const page of spec.pages) {
    lines.push(`### ${page.id} — ${page.name} (route: ${page.route})`);
    if (page.layoutRegions.length) {
      lines.push("**Layout regions:**");
      page.layoutRegions.forEach((r) => lines.push(`- ${r}`));
    }
    if (page.interactiveComponents.length) {
      lines.push("**Interactive components:**");
      page.interactiveComponents.forEach((c) =>
        lines.push(
          `- \`${c.id}\` **${c.name}** (${c.type}) — interaction: ${c.interaction} → effect: ${c.effect}`,
        ),
      );
    }
    if (page.staticElements.length) {
      lines.push(`**Static elements:** ${page.staticElements.join(", ")}`);
    }
    if (page.states.length) {
      lines.push(`**Page states:** ${page.states.join(", ")}`);
    }
    lines.push("");
  }
  lines.push(
    `**All component IDs:** ${spec.allComponentIds.join(", ") || "(none)"}`,
  );
  return lines.join("\n");
}
