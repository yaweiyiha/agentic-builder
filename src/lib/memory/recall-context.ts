/**
 * recallAndPrepareInject — runtime entry point for the three-layer prompt
 * architecture (design doc §12.7).
 *
 *   Layer 2 (active, score >= ACTIVE_THRESHOLD) → rendered into a
 *     `<memory-context>` block, returned for prompt injection
 *   Layer 3 (shadow, deprecated <= score < ACTIVE_THRESHOLD) → only
 *     trace-logged as "would-have-injected"; not added to prompt
 *   Deprecated (score < DEPRECATED_BELOW) → fully ignored
 *
 * Caller is responsible for splicing the returned `block` into its
 * messages array. If `MEMORY_INJECT=false`, even active records are
 * suppressed (still trace-logged) so we can A/B safely.
 */

import { memoryEnabled, memoryInjectEnabled } from "./env";
import { renderMemoryContext } from "./inject";
import { getSystemMemory, getProjectMemory } from "./index";
import { getTraceLogger } from "./trace";
import type {
  MemoryKind,
  MemoryLayer,
  MemoryRecord,
  RecallQuery,
} from "./types";

export const ACTIVE_THRESHOLD = 0.3;
export const DEPRECATED_BELOW = 0;

export interface RecallContextOptions {
  /** Free-form agent name for trace ("worker_codegen", "self-heal-fix"). */
  agent: string;
  /** Optional role (architect/frontend/backend/test) → tag enrichment. */
  role?: string;
  task?: {
    id?: string;
    title?: string;
    description?: string;
    files?: string[];
  };
  /** Project root for L2 lookups (omit to skip L2). */
  projectRoot?: string;
  /** Stable session id linking trace events back to project-card. */
  kickoffId?: string;
  /** Memory layers to consider. Default ['L1']. */
  layers?: MemoryLayer[];
  /** Kinds to recall. Default ['failure-pattern']. */
  kinds?: MemoryKind[];
  /** Max records to consider (pre-split). Default 8. */
  limit?: number;
  /** Override active threshold (default 0.3). */
  activeThreshold?: number;
  /** Token budget for the rendered block. */
  tokenBudget?: number;
  /**
   * Pattern ids to exclude from candidates — used by second-pass recall to
   * avoid re-injecting records that were already injected this task.
   */
  excludeIds?: string[];
  /**
   * "primary" (default) is the worker-startup recall. "secondary" indicates
   * a mid-task second pass triggered by a fresh error signal; trace is
   * logged as op:"reinject" so downstream analytics can distinguish.
   */
  pass?: "primary" | "secondary";
  /**
   * Override the inject gate. Defaults to `memoryInjectEnabled()` when
   * omitted. Phase-specific callers (PRD/Design) pass their own gate so a
   * single global flag isn't required.
   */
  injectEnabled?: () => boolean;
}

export interface RecallContextResult {
  /** Ready-to-inject `<memory-context>` block. Empty string if nothing
   *  to inject (no active patterns, MEMORY_INJECT=false, or budget=0). */
  block: string;
  /** Records that met the active threshold. */
  active: MemoryRecord[];
  /** Records below active but above deprecated; trace-only. */
  shadow: MemoryRecord[];
  /** Estimated tokens for the rendered block. */
  estimatedTokens: number;
  /** True if the block was suppressed by MEMORY_INJECT=false. */
  suppressed: boolean;
}

const EMPTY: RecallContextResult = {
  block: "",
  active: [],
  shadow: [],
  estimatedTokens: 0,
  suppressed: false,
};

export async function recallAndPrepareInject(
  opts: RecallContextOptions,
): Promise<RecallContextResult> {
  if (!memoryEnabled()) return EMPTY;

  try {
    const layers = opts.layers ?? ["L1"];
    const kinds = opts.kinds ?? ["failure-pattern"];
    const activeThreshold = opts.activeThreshold ?? ACTIVE_THRESHOLD;
    const limit = opts.limit ?? 8;
    const text = buildQueryText(opts);
    const tagFilter = buildTagFilter(opts);

    const candidates = await collectFromLayers({
      layers,
      kinds,
      text,
      tagFilter,
      limit,
      projectRoot: opts.projectRoot,
    });

    const exclude = new Set(opts.excludeIds ?? []);
    const filtered = exclude.size
      ? candidates.filter((r) => !exclude.has(r.id))
      : candidates;

    const active: MemoryRecord[] = [];
    const shadow: MemoryRecord[] = [];
    for (const r of filtered) {
      const score = r.metrics.score ?? 0;
      const manualApproved = r.tags.includes("manual:approved");
      if (score < DEPRECATED_BELOW && !manualApproved) continue;
      if (score >= activeThreshold || manualApproved) active.push(r);
      else shadow.push(r);
    }

    const injectAllowed = (opts.injectEnabled ?? memoryInjectEnabled)();
    let block = "";
    let estimatedTokens = 0;
    if (injectAllowed && active.length > 0) {
      const rendered = renderMemoryContext(active, {
        tokenBudget: opts.tokenBudget,
      });
      block = rendered.text;
      estimatedTokens = rendered.estimatedTokens;
    }

    // Awaited (not fire-and-forget) so bumpHit + lockfile cleanup
    // complete before the caller's context exits — matters for short-
    // lived runs and for test determinism.
    await writeTrace(opts, active, shadow, estimatedTokens, injectAllowed);

    return {
      block,
      active,
      shadow,
      estimatedTokens,
      suppressed: !injectAllowed && active.length > 0,
    };
  } catch (err) {
    console.warn(
      "[memory] recallAndPrepareInject failed (skipping):",
      (err as Error).message,
    );
    return EMPTY;
  }
}

function buildQueryText(opts: RecallContextOptions): string | undefined {
  const parts: string[] = [];
  if (opts.task?.title) parts.push(opts.task.title);
  if (opts.task?.description) parts.push(opts.task.description.slice(0, 200));
  return parts.length ? parts.join(" ") : undefined;
}

/**
 * Tag filter is intentionally **soft**: we only require tags that real
 * patterns are likely to carry (file extensions). `agent:` and `role:` are
 * useful for trace context but not as required filters — most mined
 * patterns don't carry them, so requiring would empty the result set.
 *
 * If callers want strict tag matching, they can supply their own query
 * via the lower-level MemoryStore.recall().
 */
function buildTagFilter(
  opts: RecallContextOptions,
): RecallQuery["tags"] | undefined {
  const any: string[] = [];
  for (const f of opts.task?.files ?? []) {
    const m = f.match(/\.([a-z0-9]+)$/i);
    if (m) any.push(`ext:${m[1]!.toLowerCase()}`);
  }
  if (any.length === 0) return undefined;
  return { any: dedupe(any) };
}

async function collectFromLayers(args: {
  layers: MemoryLayer[];
  kinds: MemoryKind[];
  text?: string;
  tagFilter?: RecallQuery["tags"];
  limit: number;
  projectRoot?: string;
}): Promise<MemoryRecord[]> {
  const out: MemoryRecord[] = [];
  for (const layer of args.layers) {
    if (layer === "L1") {
      const rs = await getSystemMemory().recall({
        layer: "L1",
        kinds: args.kinds,
        text: args.text,
        tags: args.tagFilter,
        limit: args.limit,
      });
      out.push(...rs);
    } else if (layer === "L2" && args.projectRoot) {
      const rs = await getProjectMemory(args.projectRoot).recall({
        layer: "L2",
        kinds: args.kinds,
        text: args.text,
        tags: args.tagFilter,
        limit: args.limit,
      });
      out.push(...rs);
    }
  }
  // De-dup by id
  const seen = new Set<string>();
  return out.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

async function writeTrace(
  opts: RecallContextOptions,
  active: MemoryRecord[],
  shadow: MemoryRecord[],
  injectedTokens: number,
  injectAllowed: boolean,
): Promise<void> {
  const traceRoot = opts.projectRoot ?? process.cwd();
  const isSecondary = opts.pass === "secondary";
  await getTraceLogger(traceRoot).log({
    op: isSecondary ? "reinject" : "inject",
    layer: opts.layers?.includes("L2") ? "L2" : "L1",
    kickoffId: opts.kickoffId,
    taskId: opts.task?.id,
    agent: opts.agent,
    details: {
      activeIds: active.map((r) => r.id),
      shadowIds: shadow.map((r) => r.id),
      activeCount: active.length,
      shadowCount: shadow.length,
      injectedTokens,
      injected: injectAllowed && active.length > 0,
      suppressedByFlag: !injectAllowed && active.length > 0,
      ...(opts.excludeIds?.length
        ? { excludeIdCount: opts.excludeIds.length }
        : {}),
      ...(isSecondary ? { pass: "secondary" } : {}),
    },
  });

  // bump hits on records that were actually injected (active + injectAllowed)
  if (injectAllowed) {
    for (const r of active) {
      try {
        if (r.layer === "L1") await getSystemMemory().bumpHit(r.id);
        else if (opts.projectRoot)
          await getProjectMemory(opts.projectRoot).bumpHit(r.id);
      } catch {
        /* swallow — bumpHit failure must not break recall */
      }
    }
  }
}

function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs));
}
