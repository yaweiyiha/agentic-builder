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
 * Token budget enforced via INJECT_TOKEN_BUDGET. Records are dropped from
 * the tail if the budget is exceeded — recall ranking already put the most
 * valuable ones first.
 */

import { INJECT_TOKEN_BUDGET } from "./recall-config";
import type { MemoryRecord } from "./types";

export interface InjectOptions {
  /** Override the global budget. */
  tokenBudget?: number;
  /** Hide bodies, only emit titles + metadata (debug). */
  titlesOnly?: boolean;
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

  const sources = layerSources(records);
  const recalledAt = new Date().toISOString();

  const opener = `<memory-context source="${sources}" recalled-at="${recalledAt}" count="__COUNT__">\n`;
  const closer = `</memory-context>`;

  const included: MemoryRecord[] = [];
  const parts: string[] = [];
  let used = opener.length + closer.length;

  for (const r of records) {
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
