import { chatCompletion } from "@/lib/openrouter";
import { MODEL_CONFIG } from "@/lib/model-config";
import { chunkMarkdown } from "./prd-chunker";
// Import only from the narrow `events` module — the self-heal barrel pulls
// server-only modules (agent-subgraph, child_process) which break client
// bundles that transitively import this file via `formatPrdSpecForContext`.
import { getRepairEmitter } from "@/lib/pipeline/self-heal/events";
import type {
  PrdInteractiveComponent,
  PrdPage,
  PrdSpec,
} from "./prd-spec-types";

const PRD_CHUNK_MAX_CHARS = Number(
  process.env.PRD_SPEC_CHUNK_MAX_CHARS ?? "18000",
);
const PRD_CHUNK_OVERLAP = Number(
  process.env.PRD_SPEC_CHUNK_OVERLAP ?? "1200",
);
const PRD_SINGLE_SHOT_FALLBACK_LIMIT = 24_000;

const SYSTEM_PROMPT = `You are a product analyst. Extract a structured page specification from a PRD.
Return ONLY a valid JSON object — no markdown, no explanation. The schema below is an example of the required structure and field shape, not a domain-specific content template:

{
  "pages": [
    {
      "id": "PAGE-001",
      "name": "Dashboard Overview",
      "route": "/",
      "layoutRegions": [
        "Header: Product title + primary action",
        "Body: Summary cards + primary content panel",
        "Sidebar: Filters + secondary navigation"
      ],
      "interactiveComponents": [
        {
          "id": "CMP-001",
          "name": "Create Item Button",
          "type": "button",
          "location": "Header",
          "interaction": "Click",
          "effect": "Modal opens; button shows pressed state; user can begin creating a new record"
        }
      ],
      "staticElements": [
        "Section heading",
        "Summary metric labels"
      ],
      "states": ["default", "loading", "empty", "error"]
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
- "states": ONLY states explicitly mentioned or clearly implied by the PRD (e.g. loading, empty, error, success, default, editing, submitted).
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
    id:
      typeof raw.id === "string" && raw.id
        ? raw.id
        : `PAGE-${String(pageIdx + 1).padStart(3, "0")}`,
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

function normalizeComponent(
  raw: RawPrdComponent,
  idx: number,
): PrdInteractiveComponent {
  return {
    id:
      typeof raw.id === "string" && raw.id
        ? raw.id
        : `CMP-${String(idx + 1).padStart(3, "0")}`,
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

async function callExtractor(
  model: string,
  chunkContent: string,
  chunkLabel: string,
): Promise<PrdSpec | null> {
  const res = await chatCompletion(
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Extract the structured page specification from this PRD segment (${chunkLabel}).\n\n` +
          `---\n\n${chunkContent}`,
      },
    ],
    { model, temperature: 0.1, max_tokens: 8192 },
  );
  const content = res.choices[0]?.message?.content ?? "";
  return parsePrdSpec(content);
}

/**
 * Merge an array of `PrdSpec` partials into a single spec, deduplicating
 * pages by `name + route` and components by `name + location + type`, then
 * renumbering every surviving id so PAGE-* and CMP-* are globally unique
 * and sequential again.
 */
function mergePrdSpecs(partials: PrdSpec[]): PrdSpec | null {
  const filtered = partials.filter(
    (p): p is PrdSpec => !!p && Array.isArray(p.pages),
  );
  if (filtered.length === 0) return null;

  const pageMap = new Map<string, PrdPage>();
  const orderedPageKeys: string[] = [];

  for (const part of filtered) {
    for (const page of part.pages) {
      const key = pageKey(page);
      const existing = pageMap.get(key);
      if (existing) {
        mergePageInPlace(existing, page);
      } else {
        pageMap.set(key, clonePage(page));
        orderedPageKeys.push(key);
      }
    }
  }

  let nextPageNum = 1;
  let nextCmpNum = 1;
  const pages: PrdPage[] = [];
  for (const key of orderedPageKeys) {
    const page = pageMap.get(key)!;
    page.id = `PAGE-${String(nextPageNum++).padStart(3, "0")}`;
    for (const cmp of page.interactiveComponents) {
      cmp.id = `CMP-${String(nextCmpNum++).padStart(3, "0")}`;
    }
    pages.push(page);
  }

  const allComponentIds = pages.flatMap((p) =>
    p.interactiveComponents.map((c) => c.id),
  );
  return { pages, allComponentIds };
}

function pageKey(p: PrdPage): string {
  return [
    (p.name ?? "").trim().toLowerCase(),
    (p.route ?? "").trim().toLowerCase(),
  ].join("||");
}

function componentKey(c: PrdInteractiveComponent): string {
  return [
    (c.name ?? "").trim().toLowerCase(),
    (c.location ?? "").trim().toLowerCase(),
    (c.type ?? "").trim().toLowerCase(),
  ].join("||");
}

function clonePage(p: PrdPage): PrdPage {
  return {
    id: p.id,
    name: p.name,
    route: p.route,
    layoutRegions: [...p.layoutRegions],
    interactiveComponents: p.interactiveComponents.map((c) => ({ ...c })),
    staticElements: [...p.staticElements],
    states: [...p.states],
  };
}

function mergePageInPlace(target: PrdPage, incoming: PrdPage): void {
  mergeUniqueStrings(target.layoutRegions, incoming.layoutRegions);
  mergeUniqueStrings(target.staticElements, incoming.staticElements);
  mergeUniqueStrings(target.states, incoming.states);
  const seen = new Set(target.interactiveComponents.map(componentKey));
  for (const c of incoming.interactiveComponents) {
    const key = componentKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    target.interactiveComponents.push({ ...c });
  }
}

function mergeUniqueStrings(target: string[], incoming: string[]): void {
  const seen = new Set(target.map((s) => s.trim().toLowerCase()));
  for (const s of incoming) {
    const key = s.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(s);
  }
}

/**
 * Uses a cheap LLM call to extract a structured `PrdSpec` (pages + component IDs) from PRD markdown.
 * Returns `null` when the LLM output cannot be parsed.
 *
 * PRDs longer than `PRD_CHUNK_MAX_CHARS` are split on H2/H3 boundaries and
 * each chunk is extracted in parallel; results are merged and globally
 * renumbered. A single-shot fallback preserves the legacy truncation
 * behaviour if chunked extraction yields nothing.
 */
export async function extractPrdSpec(
  prdMarkdown: string,
  sessionId?: string,
): Promise<PrdSpec | null> {
  const model = MODEL_CONFIG.prdSpecExtract;
  const emitter = getRepairEmitter(sessionId);
  const source = prdMarkdown ?? "";

  if (source.length === 0) return null;

  const chunks = chunkMarkdown(source, {
    maxChars: PRD_CHUNK_MAX_CHARS,
    overlap: PRD_CHUNK_OVERLAP,
  });

  // Small PRD → skip chunking overhead entirely.
  if (chunks.length <= 1) {
    try {
      return await callExtractor(model, source, "single");
    } catch (e) {
      console.error(
        "[PrdSpecExtractor] LLM call failed:",
        e instanceof Error ? e.message : e,
      );
      emitter({
        stage: "prd-spec",
        event: "single_shot_failed",
        details: { error: e instanceof Error ? e.message : String(e) },
      });
      return null;
    }
  }

  emitter({
    stage: "prd-spec",
    event: "chunking_started",
    details: {
      chunks: chunks.length,
      totalChars: source.length,
      maxChars: PRD_CHUNK_MAX_CHARS,
    },
  });

  const partials = await Promise.all(
    chunks.map(async (chunk) => {
      const label = `chunk ${chunk.index + 1}/${chunk.total}`;
      const content = chunk.preamble
        ? `${chunk.preamble}\n\n---\n\n${chunk.body}`
        : chunk.body;
      try {
        return await callExtractor(model, content, label);
      } catch (err) {
        emitter({
          stage: "prd-spec",
          event: "chunk_parse_failed",
          details: {
            chunkIdx: chunk.index,
            error: err instanceof Error ? err.message : String(err),
          },
        });
        return null;
      }
    }),
  );

  const successful = partials.filter(
    (p): p is PrdSpec => p !== null && Array.isArray(p.pages),
  );
  const merged = mergePrdSpecs(successful);

  if (merged && merged.pages.length > 0) {
    emitter({
      stage: "prd-spec",
      event: "merge_done",
      details: {
        chunks: chunks.length,
        successful: successful.length,
        pages: merged.pages.length,
        components: merged.allComponentIds.length,
      },
    });
    return merged;
  }

  // Fallback: try a single-shot call with the legacy truncation. Better to
  // ship a truncated spec than no spec at all.
  emitter({
    stage: "prd-spec",
    event: "fallback_single_shot",
    details: { reason: "chunked extraction produced no pages" },
  });
  try {
    return await callExtractor(
      model,
      source.slice(0, PRD_SINGLE_SHOT_FALLBACK_LIMIT),
      "fallback-single",
    );
  } catch (e) {
    console.error(
      "[PrdSpecExtractor] Fallback single-shot failed:",
      e instanceof Error ? e.message : e,
    );
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
