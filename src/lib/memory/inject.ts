/**
 * Render recalled MemoryRecords into a prompt-injectable block.
 *
 * Output format (design doc §7.2):
 *
 *   <memory-context source="L1+L2" recalled-at="..." count="N">
 *     <record id="..." kind="..." hits="...">
 *       <title>...</title>
 *       <body>...</body>
 *     </record>
 *     ...
 *   </memory-context>
 *
 * Records arrive pre-ranked by FileStore.recall (retrieval ranking). Before
 * rendering we re-rank by quality score + recency + hits — this is the
 * "what to keep when the budget bites" pass. See recall-config.ts.
 */

import {
  DEFAULT_INJECT_RELEVANCE_WEIGHTS,
  INJECT_TOKEN_BUDGET,
  RECENCY_HALF_LIFE_MS,
  type InjectRelevanceWeights,
} from "./recall-config";
import type { MemoryRecord } from "./types";

export interface InjectOptions {
  /** Override the global budget. */
  tokenBudget?: number;
  /** Hide bodies, only emit titles + metadata (debug). */
  titlesOnly?: boolean;
  /** Re-ranking weights applied before budget truncation. */
  relevanceWeights?: InjectRelevanceWeights;
  /** Wall clock injection point (defaults to Date.now()). For tests. */
  now?: number;
}

/** Conservative chars-to-tokens ratio for budget estimation. */
const CHARS_PER_TOKEN = 4;

export function renderMemoryContext(
  records: MemoryRecord[],
  opts: InjectOptions = {},
): { text: string; included: MemoryRecord[]; estimatedTokens: number } {
  if (records.length === 0) {
    return { text: "", included: [], estimatedTokens: 0 };
  }

  const budget = opts.tokenBudget ?? INJECT_TOKEN_BUDGET;
  const charBudget = budget * CHARS_PER_TOKEN;
  const weights = opts.relevanceWeights ?? DEFAULT_INJECT_RELEVANCE_WEIGHTS;
  const now = opts.now ?? Date.now();

  const ranked = sortByInjectionRelevance(records, weights, now);

  const sources = layerSources(ranked);
  const recalledAt = new Date(now).toISOString();

  const opener = `<memory-context source="${sources}" recalled-at="${recalledAt}" count="__COUNT__">\n`;
  const closer = `</memory-context>`;

  const included: MemoryRecord[] = [];
  const parts: string[] = [];
  let used = opener.length + closer.length;

  for (const r of ranked) {
    const block = renderRecord(r, opts.titlesOnly ?? false);
    if (used + block.length > charBudget && included.length > 0) break;
    parts.push(block);
    included.push(r);
    used += block.length;
  }

  const body = opener.replace("__COUNT__", String(included.length)) +
    parts.join("\n") +
    "\n" +
    closer;

  return {
    text: body,
    included,
    estimatedTokens: Math.ceil(used / CHARS_PER_TOKEN),
  };
}

/**
 * Pure ordering function — exported so callers (and tests) can reproduce the
 * exact priority used at injection time without re-rendering the block.
 */
export function sortByInjectionRelevance(
  records: MemoryRecord[],
  weights: InjectRelevanceWeights = DEFAULT_INJECT_RELEVANCE_WEIGHTS,
  now: number = Date.now(),
): MemoryRecord[] {
  const scored = records.map((r) => ({
    r,
    s: injectionRelevance(r, weights, now),
  }));
  // Stable-ish: ties broken by updatedAt (newer wins), then id.
  scored.sort((a, b) => {
    if (b.s !== a.s) return b.s - a.s;
    if (b.r.updatedAt !== a.r.updatedAt) return b.r.updatedAt - a.r.updatedAt;
    return a.r.id.localeCompare(b.r.id);
  });
  return scored.map((x) => x.r);
}

function injectionRelevance(
  r: MemoryRecord,
  w: InjectRelevanceWeights,
  now: number,
): number {
  const quality = r.metrics.score ?? 0;
  const hits = r.metrics.hits ?? 0;
  const ageMs = Math.max(0, now - r.updatedAt);
  const recency = Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS);
  return (
    w.qualityScore * quality +
    w.recency * recency +
    w.hits * Math.log(hits + 1)
  );
}

function renderRecord(r: MemoryRecord, titlesOnly: boolean): string {
  const hits = r.metrics.hits ?? 0;
  const head = `  <record id="${r.id}" kind="${r.kind}" hits="${hits}">\n` +
    `    <title>${escapeXml(r.title)}</title>`;
  if (titlesOnly) return head + "\n  </record>";
  return head + "\n" +
    `    <body>${escapeXml(r.body)}</body>\n` +
    "  </record>";
}

function layerSources(rs: MemoryRecord[]): string {
  const set = new Set(rs.map((r) => r.layer));
  return Array.from(set).sort().join("+");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
