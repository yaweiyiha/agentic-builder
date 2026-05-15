/**
 * Repair-circuit escalation.
 *
 * Called by the engine when a repair entry point (phase-repair,
 * task-coverage-repair, audit-repair-dispatch) returns `circuitOpen=true`.
 *
 * Two-tier behaviour (mirrors the supervisor's stagnation-fallback ladder):
 *   • If a `chat` callable is supplied, run `computeStagnationReplan` so
 *     a fresh-eyes LLM produces a 3-bullet action plan from the accumulated
 *     attempt history. The plan is persisted alongside the escalation
 *     record so a downstream UI / verify-fix worker can pick it up.
 *   • If `chat` is omitted (the kickoff/coverage stages don't currently
 *     have a chat layer wired at that point), only the structured
 *     escalation record + telemetry event are produced. The LLM hand-off
 *     can be added later without changing call sites.
 *
 * All escalations append one JSON line to `<outputDir>/.ralph/escalations.jsonl`
 * so post-mortem tooling has a single canonical log.
 */

import fs from "fs/promises";
import path from "path";
import type { AttemptScope, AttemptTracker } from "./attempt-tracker";
import type { RepairEmitter } from "./events";
import {
  computeStagnationReplan,
  type StagnationReplanInput,
} from "./stagnation-replan";

const ESCALATIONS_RELATIVE = ".ralph/escalations.jsonl";

export interface EscalateRepairCircuitInput {
  scope: AttemptScope;
  tracker: AttemptTracker;
  outputDir: string;
  emitter: RepairEmitter;
  /** Optional. When provided, runs computeStagnationReplan to produce a
   *  3-bullet plan. Omit to record the circuit-open event without an LLM
   *  round-trip. */
  chat?: StagnationReplanInput["chat"];
  /** Optional diagnostics to surface inside the replan prompt. Same shape
   *  as `StagnationReplanInput.diagnosticsSnapshot`. */
  diagnostics?: StagnationReplanInput["diagnosticsSnapshot"];
  /** Short human-readable summary of what the circuit was guarding. */
  reason?: string;
  sessionId?: string;
}

export interface EscalateRepairCircuitResult {
  /** True when an escalation record was produced. False only when the
   *  scope has no tracked record (caller invoked escalate on a non-tripped
   *  scope). */
  recorded: boolean;
  /** Path to the appended escalation file. */
  escalationFilePath?: string;
  /** Present iff `chat` was supplied and the replan succeeded. */
  plan?: string;
}

interface EscalationLogEntry {
  at: string;
  sessionId?: string;
  scope: AttemptScope;
  attempts: number;
  firstAttemptAt: string;
  lastAttemptAt: string;
  lastOutcome: string;
  reason?: string;
  plan?: string;
  diagnostics?: StagnationReplanInput["diagnosticsSnapshot"];
}

export async function escalateRepairCircuit(
  input: EscalateRepairCircuitInput,
): Promise<EscalateRepairCircuitResult> {
  const { scope, tracker, outputDir, emitter, chat, diagnostics, reason, sessionId } = input;
  const record = tracker.getRecord(scope);
  if (!record) {
    return { recorded: false };
  }

  let plan: string | undefined;
  if (chat) {
    const replan = await computeStagnationReplan({
      diagnosticsSnapshot: diagnostics ?? {},
      repeatedActions: record.history
        .filter((h) => h.outcome !== "repaired")
        .map((h) => `${scope.stage}/${scope.scopeKey}: ${h.outcome}`),
      repeatedReads: [],
      lastProgressReason:
        record.lastOutcome === "repaired"
          ? "previous repair succeeded; fresh failure under same scope"
          : "no progress detected by attempt tracker",
      iterationsConsumed: record.attempts,
      chat,
    });
    if (replan.ok) {
      plan = replan.plan;
    }
  }

  const entry: EscalationLogEntry = {
    at: new Date().toISOString(),
    sessionId,
    scope,
    attempts: record.attempts,
    firstAttemptAt: record.firstAttemptAt,
    lastAttemptAt: record.lastAttemptAt,
    lastOutcome: record.lastOutcome,
    reason,
    plan,
    diagnostics,
  };

  const escalationFilePath = path.join(outputDir, ESCALATIONS_RELATIVE);
  try {
    await fs.mkdir(path.dirname(escalationFilePath), { recursive: true });
    await fs.appendFile(escalationFilePath, JSON.stringify(entry) + "\n", "utf-8");
  } catch (err) {
    console.warn(
      `[escalateRepairCircuit] failed to persist escalation (ignored):`,
      err instanceof Error ? err.message : err,
    );
  }

  emitter({
    sessionId,
    stage: scope.stage,
    event: "circuit_escalation",
    attempt: record.attempts,
    circuitOpen: true,
    details: {
      scopeKey: scope.scopeKey,
      lastOutcome: record.lastOutcome,
      planAttached: Boolean(plan),
      reason,
    },
  });

  return { recorded: true, escalationFilePath, plan };
}
