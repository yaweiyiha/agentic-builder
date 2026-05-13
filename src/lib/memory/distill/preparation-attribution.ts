/**
 * Preparation-phase outcome attribution — closes the feedback loop on
 * `prd-pattern` and `design-pattern` records.
 *
 * Signal source (vs. failure-pattern attribution):
 *   - failure-pattern attribution uses **task-history** records (codegen
 *     tasks completed/failed) as success/failure verdicts.
 *   - PRD/Design have no codegen tasks. The user's verdict — whether they
 *     accepted the AI-generated artifact as-is or edited it — is the only
 *     ground-truth signal we have, and it lives in `prep-outcome` trace
 *     events emitted by /api/memory/{prd,design}/capture.
 *
 * Algorithm:
 *   1. Index injection events by sessionId, partitioned by agent ("pm" or
 *      "design"), capturing which L1 patterns the prep agent saw.
 *   2. Index citation events the same way (model said "I used these").
 *   3. For each prep-outcome event, look up the corresponding injection
 *      set. If the model cited some subset, only those are credited;
 *      otherwise all injected patterns share the credit/blame.
 *      - source=human_approval → +deltaSuccess
 *      - source=human_edit     → +deltaFailure (negative)
 *   4. Patterns with `manual:approved` tag are immune (logged but not
 *      changed) — humans curate them.
 *   5. The cursor key is the sessionId (one outcome per session per phase),
 *      preventing double-counting across attribution runs.
 *
 * Pure function — no I/O. The HTTP wrapper handles file I/O and
 * persistence.
 */

import type { TraceEvent } from "../trace";
import type { MemoryRecord } from "../types";

export interface PrepAttributionInput {
  /** All trace events from `<l1Root>/.memory/trace.jsonl`. */
  traceEvents: TraceEvent[];
  /** Map from pattern id → current L1 record. Patterns missing from the
   *  map are skipped silently (deleted between runs). */
  patternsById: Map<string, MemoryRecord>;
  /** sessionIds (one per (phase, sessionId) pair) already attributed in past runs. */
  alreadyAttributed: Set<string>;
  /** Score delta for human_approval (default +0.05). */
  deltaApproval: number;
  /** Score delta for human_edit (default -0.05; smaller magnitude than
   *  failure-pattern's -0.10 because user edits are noisier — they may
   *  reflect personal preference rather than a real PRD/Design defect). */
  deltaEdit: number;
}

export interface PrepPatternAttribution {
  patternId: string;
  oldScore: number;
  newScore: number;
  delta: number;
  approvals: number;
  edits: number;
  immune: boolean;
  /** "cite" — model explicitly cited this pattern;
   *  "inject-fallback" — only inject set used (no cite present);
   *  "mixed" — both kinds of evidence contributed. */
  source: "cite" | "inject-fallback" | "mixed";
  /** Distinct phases this pattern appeared in: "prd", "design", or "both". */
  phase: "prd" | "design" | "both";
}

export interface PrepAttributionResult {
  attributions: PrepPatternAttribution[];
  /** Cursor keys (sessionId::phase) newly attributed by this run. */
  newlyAttributed: string[];
  stats: {
    outcomeEventsConsidered: number;
    outcomeEventsSkippedAlreadyAttributed: number;
    outcomeEventsSkippedNoInjection: number;
    injectEventsConsidered: number;
    patternsTouched: number;
  };
}

export const DEFAULT_DELTA_APPROVAL = 0.05;
export const DEFAULT_DELTA_EDIT = -0.05;

const PREP_AGENTS = new Set(["pm", "design"]);

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export function cursorKey(sessionId: string, phase: "prd" | "design"): string {
  return `${sessionId}::${phase}`;
}

interface InjectionEntry {
  ids: Set<string>;
  phase: "prd" | "design";
}

/**
 * sessionId+phase → injected pattern ids the prep agent actually saw
 * (`injected: true` in inject-event details).
 */
function buildInjectionIndex(events: TraceEvent[]): Map<string, InjectionEntry> {
  const out = new Map<string, InjectionEntry>();
  for (const ev of events) {
    if (ev.op !== "inject" && ev.op !== "reinject") continue;
    if (!ev.kickoffId || !ev.agent || !PREP_AGENTS.has(ev.agent)) continue;
    const det = ev.details as
      | { injected?: boolean; activeIds?: unknown }
      | undefined;
    if (!det || det.injected !== true) continue;
    if (!Array.isArray(det.activeIds)) continue;
    const phase: "prd" | "design" = ev.agent === "pm" ? "prd" : "design";
    const key = cursorKey(ev.kickoffId, phase);
    let entry = out.get(key);
    if (!entry) {
      entry = { ids: new Set(), phase };
      out.set(key, entry);
    }
    for (const id of det.activeIds) {
      if (typeof id === "string") entry.ids.add(id);
    }
  }
  return out;
}

/**
 * sessionId+phase → cited pattern ids (validated against the injection set
 * — hallucinated cites are silently dropped).
 */
function buildCitationIndex(
  events: TraceEvent[],
  injIndex: Map<string, InjectionEntry>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const ev of events) {
    if (ev.op !== "cite") continue;
    if (!ev.kickoffId || !ev.agent || !PREP_AGENTS.has(ev.agent)) continue;
    const det = ev.details as { validIds?: unknown; citedIds?: unknown } | undefined;
    const ids = Array.isArray(det?.validIds)
      ? det.validIds
      : Array.isArray(det?.citedIds)
        ? det.citedIds
        : [];
    if (ids.length === 0) continue;
    const phase: "prd" | "design" = ev.agent === "pm" ? "prd" : "design";
    const key = cursorKey(ev.kickoffId, phase);
    const allowed = injIndex.get(key)?.ids;
    let set = out.get(key);
    if (!set) {
      set = new Set();
      out.set(key, set);
    }
    for (const id of ids) {
      if (typeof id !== "string") continue;
      if (allowed && !allowed.has(id)) continue;
      set.add(id);
    }
  }
  return out;
}

interface OutcomeEvent {
  sessionId: string;
  phase: "prd" | "design";
  source: "human_approval" | "human_edit";
}

function extractOutcomeEvents(events: TraceEvent[]): OutcomeEvent[] {
  const out: OutcomeEvent[] = [];
  for (const ev of events) {
    if (ev.op !== "prep-outcome") continue;
    if (!ev.kickoffId) continue;
    const det = ev.details as
      | { phase?: string; source?: string }
      | undefined;
    if (det?.phase !== "prd" && det?.phase !== "design") continue;
    if (det?.source !== "human_approval" && det?.source !== "human_edit") continue;
    out.push({
      sessionId: ev.kickoffId,
      phase: det.phase,
      source: det.source,
    });
  }
  return out;
}

interface PatternAccum {
  approvals: number;
  edits: number;
  sawCite: boolean;
  sawFallback: boolean;
  phasesSeen: Set<"prd" | "design">;
}

export function computePrepAttributions(
  input: PrepAttributionInput,
): PrepAttributionResult {
  const injIndex = buildInjectionIndex(input.traceEvents);
  const citeIndex = buildCitationIndex(input.traceEvents, injIndex);
  const outcomes = extractOutcomeEvents(input.traceEvents);

  const accum = new Map<string, PatternAccum>();
  const newlyAttributed: string[] = [];
  const stats = {
    outcomeEventsConsidered: 0,
    outcomeEventsSkippedAlreadyAttributed: 0,
    outcomeEventsSkippedNoInjection: 0,
    injectEventsConsidered: injIndex.size,
    patternsTouched: 0,
  };

  for (const o of outcomes) {
    stats.outcomeEventsConsidered++;
    const key = cursorKey(o.sessionId, o.phase);
    if (input.alreadyAttributed.has(key)) {
      stats.outcomeEventsSkippedAlreadyAttributed++;
      continue;
    }
    const inj = injIndex.get(key);
    if (!inj || inj.ids.size === 0) {
      stats.outcomeEventsSkippedNoInjection++;
      continue;
    }
    newlyAttributed.push(key);

    const cited = citeIndex.get(key);
    const useCites = cited !== undefined && cited.size > 0;
    const credited = useCites ? cited : inj.ids;

    for (const patternId of credited) {
      let acc = accum.get(patternId);
      if (!acc) {
        acc = {
          approvals: 0,
          edits: 0,
          sawCite: false,
          sawFallback: false,
          phasesSeen: new Set(),
        };
        accum.set(patternId, acc);
      }
      if (o.source === "human_approval") acc.approvals++;
      else acc.edits++;
      if (useCites) acc.sawCite = true;
      else acc.sawFallback = true;
      acc.phasesSeen.add(o.phase);
    }
  }

  const attributions: PrepPatternAttribution[] = [];
  for (const [patternId, acc] of accum) {
    const pattern = input.patternsById.get(patternId);
    if (!pattern) continue;
    stats.patternsTouched++;
    const oldScore = pattern.metrics.score ?? 0;
    const immune = pattern.tags.includes("manual:approved");
    const rawDelta =
      acc.approvals * input.deltaApproval + acc.edits * input.deltaEdit;
    const newScore = immune ? oldScore : clamp(oldScore + rawDelta, -1, 1);
    const delta = newScore - oldScore;
    const source: PrepPatternAttribution["source"] =
      acc.sawCite && acc.sawFallback
        ? "mixed"
        : acc.sawCite
          ? "cite"
          : "inject-fallback";
    const phase: PrepPatternAttribution["phase"] =
      acc.phasesSeen.size === 2
        ? "both"
        : acc.phasesSeen.has("prd")
          ? "prd"
          : "design";
    attributions.push({
      patternId,
      oldScore,
      newScore,
      delta,
      approvals: acc.approvals,
      edits: acc.edits,
      immune,
      source,
      phase,
    });
  }

  // Sort: largest absolute delta first so the dashboard surfaces the loud
  // moves; ties broken by approvals desc, then patternId for determinism.
  attributions.sort((a, b) => {
    const ad = Math.abs(a.delta);
    const bd = Math.abs(b.delta);
    if (ad !== bd) return bd - ad;
    if (a.approvals !== b.approvals) return b.approvals - a.approvals;
    return a.patternId.localeCompare(b.patternId);
  });

  return { attributions, newlyAttributed, stats };
}
