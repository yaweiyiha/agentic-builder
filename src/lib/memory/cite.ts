/**
 * Memory citations — fine-grained attribution.
 *
 * Workers are encouraged (not required) to emit a `<memory-cite ids="..." />`
 * tag in their output when an injected memory pattern actually informed the
 * code they wrote. When present, the citation lets attribution credit the
 * specific helpful patterns instead of treating every injected pattern as
 * equally responsible for the task outcome.
 *
 * Design choices:
 * - **Soft signal**: missing cite is fine; attribution falls back to the
 *   existing "all injected" behavior. The cite is upside, not a contract.
 * - **One tag wins**: if the model emits multiple cite tags (likely from
 *   confusion), we union the ids. Worker output is unstructured enough
 *   that requiring a single tag invites parse failures.
 * - **Validated against allowed ids**: a hallucinated id that wasn't in
 *   the actual injected set is dropped silently — we trust the trace, not
 *   the model's memory of what it saw.
 */

import { getTraceLogger } from "./trace";

const CITE_TAG_RE =
  /<memory-cite\s+ids\s*=\s*"([^"]*)"\s*\/?\s*>/gi;
const ID_SPLITTER = /[\s,]+/;

export function parseMemoryCites(output: string): string[] {
  if (!output) return [];
  const ids = new Set<string>();
  for (const m of output.matchAll(CITE_TAG_RE)) {
    const inner = m[1] ?? "";
    for (const tok of inner.split(ID_SPLITTER)) {
      const t = tok.trim();
      if (t) ids.add(t);
    }
  }
  return Array.from(ids);
}

/**
 * Strip `<memory-cite />` tags from output before it's persisted to disk.
 * The cite is metadata, not code; we don't want it ending up in committed
 * file content or in the saved coding-session report.
 */
export function stripMemoryCites(output: string): string {
  if (!output) return output;
  return output.replace(CITE_TAG_RE, "").trimStart();
}

export interface RecordCitesInput {
  /** Used to resolve `.memory/trace.jsonl` location. */
  traceRoot: string;
  agent: string;
  kickoffId?: string;
  taskId?: string;
  /** Ids parsed from worker output. */
  citedIds: string[];
  /** Patterns actually injected this task (primary + secondary recall). The
   *  cite is intersected with this set so hallucinated ids don't poison
   *  attribution. */
  injectedIds: string[];
}

export async function recordMemoryCites(
  input: RecordCitesInput,
): Promise<{ valid: string[]; invalid: string[] }> {
  if (input.citedIds.length === 0) return { valid: [], invalid: [] };
  const injected = new Set(input.injectedIds);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const id of input.citedIds) {
    if (injected.has(id)) valid.push(id);
    else invalid.push(id);
  }
  // Always log even if all ids are invalid — signals a hallucinating model
  // worth investigating in the dashboard.
  await getTraceLogger(input.traceRoot).log({
    op: "cite",
    layer: "L1",
    kickoffId: input.kickoffId,
    taskId: input.taskId,
    agent: input.agent,
    details: {
      citedIds: input.citedIds,
      validIds: valid,
      invalidIds: invalid,
      validCount: valid.length,
      invalidCount: invalid.length,
    },
  });
  return { valid, invalid };
}
