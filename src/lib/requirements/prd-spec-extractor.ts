import { chatCompletion } from "@/lib/openrouter";
import { MODEL_CONFIG } from "@/lib/model-config";
import { chunkMarkdown } from "./prd-chunker";
// Import only from the narrow `events` module — the self-heal barrel pulls
// server-only modules (agent-subgraph, child_process) which break client
// bundles that transitively import this file via `formatPrdSpecForContext`.
import { getRepairEmitter } from "@/lib/pipeline/self-heal/events";
import type {
  PrdDomainSpec,
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
- Keep every field concise (≤ 25 words per field value).

──────────────────────────────────────────────────────────────────────
DOMAIN section (CONDITIONAL — only when applicable):

If the PRD describes any of the following — domain-specific scoring,
pricing tiers, eligibility rules, periodic ingestion jobs, external API
dependencies, entity-level workflow state machines, or numeric thresholds
governing alerts — ALSO include a top-level "domain" object alongside
"pages". Omit entirely for plain CRUD apps.

Sub-fields are each conditional (include only what the PRD specifies):

  "domain": {
    "entities":     [ { "type": "stablecoins", "instances": [{ "symbol": "USDC", "issuer": "Circle" }, ...] } ],
    "variables":    [ { "id": "RQ-1", "name": "Safe Reserve Asset Ratio", "description": "%% reserves in safe assets", "unit": "%", "source": "issuer-attestation", "historyWindow": "none" } ],
    "rules":        [ { "id": "RQ-1-NORM", "name": "Reserve safety normalisation",
                        "type": "piecewise-linear", "inputVariableId": "RQ-1",
                        "segments": [
                          { "from": 90, "to": 100, "outputFrom": 0,  "outputTo": 0 },
                          { "from": 80, "to": 90,  "outputFrom": 10, "outputTo": 0 },
                          { "from": 70, "to": 80,  "outputFrom": 25, "outputTo": 10 },
                          { "from": 55, "to": 70,  "outputFrom": 50, "outputTo": 25 },
                          { "from": 40, "to": 55,  "outputFrom": 75, "outputTo": 50 },
                          { "from": 25, "to": 40,  "outputFrom": 100, "outputTo": 75 },
                          { "from": 0,  "to": 25,  "outputFrom": 100, "outputTo": 100 }
                        ] } ],
    "dataSources":  [ { "id": "coingecko", "name": "CoinGecko Market",
                        "kind": "http-rest", "baseUrl": "https://api.coingecko.com/api/v3",
                        "auth": "api-key-header", "rateLimit": "30 rpm",
                        "fieldMapping": "ids → instances.coingecko_id",
                        "freshness": "fresh<5min, stale<15min, dead>30min" } ],
    "schedules":    [ { "id": "scoring-cycle", "description": "Recompute composite scores every 5 minutes",
                        "cron": "*/5 * * * *", "pipelineId": "scoring-cycle" } ],
    "workflows":    [ { "id": "reserve-review", "entity": "ReserveReview", "initial": "pending",
                        "states": ["pending", "approved", "rejected"],
                        "transitions": [
                          { "from": "pending", "to": "approved", "action": "approve",
                            "requires": ["reviewer_id", "comment"] },
                          { "from": "pending", "to": "rejected", "action": "reject",
                            "requires": ["reviewer_id", "reason"] }
                        ],
                        "auditTrail": true } ],
    "alerts":       [ { "id": "rapid-mover", "description": "Score moved sharply within one cycle",
                        "trigger": "score delta >= 25 points within 5 minutes",
                        "severity": "high", "channels": ["in-app"] } ]
  }

Domain rules for rule/segment extraction:
- COPY numeric boundary values EXACTLY as written in the PRD — do NOT round, interpolate, or invent new values.
- If the PRD gives discrete pairs (>=90 → 0, 80 → 10, 70 → 25), expand them into segment ranges as in the example above.
- If you cannot tell from the PRD whether a rule is piecewise-linear or a decision-table, use type "other" and put the description in "formula".
- For dataSources.fixtures: include exactly what the PRD lists; do not invent fixtures.
- For schedules.cron: only emit if the PRD explicitly states a frequency.

If a section does not apply (no rules, no external data sources, etc.) just omit that key from "domain". An empty domain object is acceptable but you can also omit the "domain" key entirely.`;

interface RawPrdSpec {
  pages: RawPrdPage[];
  /** Untyped passthrough — domain shape is validated by extractDomainSpec. */
  domain?: unknown;
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

/** Exported for unit testing — production callers go through `extractPrdSpec`. */
export function parsePrdSpec(raw: string): PrdSpec | null {
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
    const domain = extractDomainSpec(parsed.domain);
    return domain
      ? { pages, allComponentIds, domain }
      : { pages, allComponentIds };
  } catch {
    return null;
  }
}

/**
 * Coerce the loose `domain` payload from the LLM into a validated
 * `PrdDomainSpec`. Each sub-field is independently filtered — a bad
 * `rules` array doesn't drop the whole domain, just that array.
 *
 * Returns `null` only when the input is completely empty / unusable so
 * the caller can omit the field rather than carry a stub.
 */
function extractDomainSpec(raw: unknown): PrdDomainSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: PrdDomainSpec = {};

  if (Array.isArray(r.entities)) {
    const entities = r.entities
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => ({
        type: typeof e.type === "string" ? e.type : "",
        instances: Array.isArray(e.instances)
          ? (e.instances.filter(
              (i): i is Record<string, string | number | boolean | null> =>
                !!i && typeof i === "object",
            ) as Array<Record<string, string | number | boolean | null>>)
          : [],
      }))
      .filter((e) => e.type.length > 0);
    if (entities.length) out.entities = entities;
  }

  if (Array.isArray(r.variables)) {
    const variables = r.variables
      .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
      .map((v) => ({
        id: String(v.id ?? ""),
        name: String(v.name ?? ""),
        description: String(v.description ?? ""),
        unit: typeof v.unit === "string" ? v.unit : undefined,
        source: typeof v.source === "string" ? v.source : undefined,
        historyWindow:
          typeof v.historyWindow === "string" ? v.historyWindow : undefined,
      }))
      .filter((v) => v.id.length > 0 && v.name.length > 0);
    if (variables.length) out.variables = variables;
  }

  if (Array.isArray(r.rules)) {
    const rules = r.rules
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => {
        const type =
          x.type === "piecewise-linear" ||
          x.type === "decision-table" ||
          x.type === "other"
            ? x.type
            : "other";
        const segments = Array.isArray(x.segments)
          ? x.segments
              .filter(
                (s): s is Record<string, unknown> =>
                  !!s && typeof s === "object",
              )
              .map((s) => ({
                from: Number(s.from),
                to: Number(s.to),
                outputFrom: Number(s.outputFrom),
                outputTo: Number(s.outputTo),
              }))
              .filter(
                (s) =>
                  Number.isFinite(s.from) &&
                  Number.isFinite(s.to) &&
                  Number.isFinite(s.outputFrom) &&
                  Number.isFinite(s.outputTo),
              )
          : undefined;
        const cases = Array.isArray(x.cases)
          ? x.cases
              .filter(
                (c): c is Record<string, unknown> =>
                  !!c && typeof c === "object",
              )
              .map((c) => ({
                when:
                  c.when && typeof c.when === "object"
                    ? (c.when as Record<string, string | number | boolean>)
                    : {},
                then:
                  typeof c.then === "string" ||
                  typeof c.then === "number" ||
                  typeof c.then === "boolean"
                    ? c.then
                    : "",
              }))
          : undefined;
        return {
          id: String(x.id ?? ""),
          name: String(x.name ?? ""),
          description:
            typeof x.description === "string" ? x.description : undefined,
          type,
          inputVariableId:
            typeof x.inputVariableId === "string"
              ? x.inputVariableId
              : undefined,
          segments,
          cases,
          formula: typeof x.formula === "string" ? x.formula : undefined,
        };
      })
      .filter((x) => x.id.length > 0 && x.name.length > 0);
    if (rules.length) out.rules = rules as PrdDomainSpec["rules"];
  }

  if (Array.isArray(r.dataSources)) {
    type DataSourceAuth =
      | "none"
      | "api-key-header"
      | "bearer"
      | "oauth2"
      | "basic";
    const VALID_AUTH: ReadonlySet<DataSourceAuth> = new Set([
      "none",
      "api-key-header",
      "bearer",
      "oauth2",
      "basic",
    ]);
    const dataSources = r.dataSources
      .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
      .map((d) => {
        const auth: DataSourceAuth | undefined =
          typeof d.auth === "string" && VALID_AUTH.has(d.auth as DataSourceAuth)
            ? (d.auth as DataSourceAuth)
            : undefined;
        return {
          id: String(d.id ?? ""),
          name: String(d.name ?? ""),
          kind: String(d.kind ?? ""),
          baseUrl: typeof d.baseUrl === "string" ? d.baseUrl : undefined,
          auth,
          rateLimit: typeof d.rateLimit === "string" ? d.rateLimit : undefined,
          fieldMapping:
            typeof d.fieldMapping === "string" ? d.fieldMapping : undefined,
          fixtures: Array.isArray(d.fixtures)
            ? (d.fixtures.filter(
                (f): f is Record<string, string | number | boolean | null> =>
                  !!f && typeof f === "object",
              ) as Array<Record<string, string | number | boolean | null>>)
            : undefined,
          freshness: typeof d.freshness === "string" ? d.freshness : undefined,
        };
      })
      .filter((d) => d.id.length > 0 && d.kind.length > 0);
    if (dataSources.length) out.dataSources = dataSources;
  }

  if (Array.isArray(r.schedules)) {
    const schedules = r.schedules
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => ({
        id: String(s.id ?? ""),
        description: String(s.description ?? ""),
        cron: typeof s.cron === "string" ? s.cron : undefined,
        intervalHuman:
          typeof s.intervalHuman === "string" ? s.intervalHuman : undefined,
        pipelineId:
          typeof s.pipelineId === "string" ? s.pipelineId : undefined,
      }))
      .filter((s) => s.id.length > 0);
    if (schedules.length) out.schedules = schedules;
  }

  if (Array.isArray(r.workflows)) {
    const workflows = r.workflows
      .filter((w): w is Record<string, unknown> => !!w && typeof w === "object")
      .map((w) => ({
        id: String(w.id ?? ""),
        entity: String(w.entity ?? ""),
        initial: String(w.initial ?? ""),
        states: Array.isArray(w.states)
          ? w.states.filter((s): s is string => typeof s === "string")
          : [],
        transitions: Array.isArray(w.transitions)
          ? w.transitions
              .filter(
                (t): t is Record<string, unknown> =>
                  !!t && typeof t === "object",
              )
              .map((t) => ({
                from: String(t.from ?? ""),
                to: String(t.to ?? ""),
                action: String(t.action ?? ""),
                requires: Array.isArray(t.requires)
                  ? t.requires.filter((x): x is string => typeof x === "string")
                  : undefined,
                guard: typeof t.guard === "string" ? t.guard : undefined,
              }))
              .filter(
                (t) =>
                  t.from.length > 0 &&
                  t.to.length > 0 &&
                  t.action.length > 0,
              )
          : [],
        auditTrail:
          typeof w.auditTrail === "boolean" ? w.auditTrail : undefined,
      }))
      .filter((w) => w.id.length > 0 && w.entity.length > 0);
    if (workflows.length) out.workflows = workflows;
  }

  if (Array.isArray(r.alerts)) {
    const alerts = r.alerts
      .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
      .map((a) => ({
        id: String(a.id ?? ""),
        description: String(a.description ?? ""),
        trigger: String(a.trigger ?? ""),
        severity: typeof a.severity === "string" ? a.severity : undefined,
        channels: Array.isArray(a.channels)
          ? a.channels.filter((c): c is string => typeof c === "string")
          : undefined,
      }))
      .filter((a) => a.id.length > 0 && a.trigger.length > 0);
    if (alerts.length) out.alerts = alerts;
  }

  return Object.keys(out).length > 0 ? out : null;
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
  const domain = mergeDomainSpecs(filtered);
  return domain
    ? { pages, allComponentIds, domain }
    : { pages, allComponentIds };
}

/**
 * Merge `domain` across PRD chunks. Each sub-field is treated as a flat
 * list and de-duplicated by `id` — the first chunk that introduces a
 * given id wins. Domain spec is typically global, not per-chunk, so any
 * later chunk that re-emits the same id is treated as a duplicate.
 */
function mergeDomainSpecs(partials: PrdSpec[]): PrdDomainSpec | null {
  const collected: PrdDomainSpec = {};
  const haveSeenId = new Map<string, Set<string>>();
  const seenOnce = (field: string, id: string): boolean => {
    let set = haveSeenId.get(field);
    if (!set) {
      set = new Set();
      haveSeenId.set(field, set);
    }
    if (set.has(id)) return true;
    set.add(id);
    return false;
  };

  for (const part of partials) {
    const d = part.domain;
    if (!d) continue;

    for (const e of d.entities ?? []) {
      // Entities use `type` as the unique key (instances merge by-type).
      const key = e.type;
      if (seenOnce("entities", key)) continue;
      (collected.entities ??= []).push(e);
    }
    for (const v of d.variables ?? []) {
      if (seenOnce("variables", v.id)) continue;
      (collected.variables ??= []).push(v);
    }
    for (const r of d.rules ?? []) {
      if (seenOnce("rules", r.id)) continue;
      (collected.rules ??= []).push(r);
    }
    for (const ds of d.dataSources ?? []) {
      if (seenOnce("dataSources", ds.id)) continue;
      (collected.dataSources ??= []).push(ds);
    }
    for (const s of d.schedules ?? []) {
      if (seenOnce("schedules", s.id)) continue;
      (collected.schedules ??= []).push(s);
    }
    for (const w of d.workflows ?? []) {
      if (seenOnce("workflows", w.id)) continue;
      (collected.workflows ??= []).push(w);
    }
    for (const a of d.alerts ?? []) {
      if (seenOnce("alerts", a.id)) continue;
      (collected.alerts ??= []).push(a);
    }
  }

  return Object.keys(collected).length > 0 ? collected : null;
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
