/**
 * Stagnation replan — fresh-eyes triage when the verify-fix worker has
 * exhausted its stagnation-fallback budget.
 *
 * The current escalation ladder is:
 *   1. stagnation warning      → gentle prompt nudge
 *   2. escalated warning       → forceful "write or report_done" nudge
 *   3. fallback retry          → ONE batched classify-then-mutate prompt
 *   4. (this fix) replan       → fresh LLM produces a 3-step action plan;
 *                                bloated message history is dropped and
 *                                replaced with the system prompt + plan
 *   5. abort                   → only if replan also fails to recover
 *
 * The hypothesis driving (4): when the worker is still stuck after the
 * batched fallback, its accumulated message history (often 30+ turns of
 * tool calls + observations) is itself part of the problem — the context
 * is poisoned with circular reasoning. A separate LLM call with a clean
 * slate and just the diagnostics produces a path forward that the
 * verify-fix worker cannot see from inside its own context.
 *
 * Note: this module does NO LLM calls itself. The caller supplies the
 * `chat` callable so tests can pin the behavior without an OpenRouter
 * round trip.
 */

export interface StagnationReplanInput {
  /** outputDir is for diagnostics file reads (caller supplies the
   *  reader); we accept the already-loaded content so this module is
   *  side-effect-free and testable. */
  diagnosticsSnapshot: {
    /** Top N TSC diagnostics from .ralph/tsc-diagnostics.json. */
    tscErrors?: string[];
    /** Top contract-coverage gaps from .ralph/contract-usage-coverage.json. */
    contractCoverageGaps?: string[];
    /** Route audit findings — unregistered modules + unresolved registrations. */
    routeAudit?: string[];
    /** Migration coverage gaps from .ralph/migration-coverage.json. */
    migrationGaps?: string[];
  };
  /** The actions the worker has been repeating without progress. */
  repeatedActions: string[];
  /** Files the worker has been re-reading without writing. */
  repeatedReads: string[];
  /** Last "meaningful progress" reason — useful so the replan LLM knows
   *  what already worked recently. */
  lastProgressReason: string;
  /** Total iterations consumed so far. */
  iterationsConsumed: number;
  /** Caller-supplied chat callable — accepts (messages) returns content text. */
  chat: (
    messages: Array<{ role: "system" | "user"; content: string }>,
  ) => Promise<string>;
}

export interface StagnationReplanResult {
  /** True when the chat call returned a usable plan. */
  ok: boolean;
  /** 3-step action plan as Markdown, ready to inject as a user message.
   *  Empty when ok=false. */
  plan: string;
  /** Diagnostic info for telemetry. */
  diagnostics: {
    rawResponseLength: number;
    bulletCount: number;
    reason?: string;
  };
}

const SYSTEM_PROMPT = `You are a Senior Engineering Triage agent.

You are NOT the verify-fix worker — you are a separate fresh-eyes reviewer
called in because the verify-fix worker has exhausted its retry budget
WITHOUT making any code changes. The worker's accumulated message history
is likely poisoned with circular reasoning, so we are dropping it and
reseeding the worker with a focused action plan from you.

Your output goes DIRECTLY into the worker's next prompt as instruction.

## Rules for the plan
- **Exactly 3 bullet points.** Each bullet ≤ 35 words.
- **Each bullet must name a specific FILE (full path) or COMMAND.** Never
  "explore X" or "investigate Y" — only concrete writes / shell commands.
- **Ordered**: bullet 1 is the highest-leverage change; bullets 2 + 3 are
  follow-ups. If bullet 1 succeeds, bullets 2 + 3 may become moot.
- **Cite the diagnostic that justifies each bullet.** Example: "Fix the
  TSC error at backend/src/api/modules/auth/auth.routes.ts:12 (TS2322
  string vs number)."
- **Do NOT suggest more reads.** The worker has been re-reading for ≥10
  iterations. You're escalating because reading didn't work.
- **Do NOT suggest broad refactors.** Pick the SMALLEST atomic change.

## Output format
Output ONLY the 3-bullet Markdown list. No preamble, no explanation, no
fence. Example output:
- Fix backend/src/app.ts:24 — change \`apiRouter.prefix\` from \`/api\` to \`/api/v1\` to match contract paths.
- Register registerAuthRoutes(apiRouter) in backend/src/api/modules/index.ts:8 — currently the function is exported but never called.
- Run \`pnpm --filter backend tsc --noEmit\` to surface the remaining type errors after the route fix; the highest-priority file is whatever the first error mentions.`;

export async function computeStagnationReplan(
  input: StagnationReplanInput,
): Promise<StagnationReplanResult> {
  const userMessage = buildReplanContext(input);

  let raw: string;
  try {
    raw = await input.chat([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ]);
  } catch (err) {
    return {
      ok: false,
      plan: "",
      diagnostics: {
        rawResponseLength: 0,
        bulletCount: 0,
        reason: err instanceof Error ? err.message : String(err),
      },
    };
  }

  const cleaned = stripFences(raw).trim();
  const bullets = extractBullets(cleaned);
  if (bullets.length < 1) {
    return {
      ok: false,
      plan: "",
      diagnostics: {
        rawResponseLength: raw.length,
        bulletCount: bullets.length,
        reason: "no bullets parsed from chat response",
      },
    };
  }

  // We allow 1–5 bullets — the prompt asks for 3 but LLMs vary; only
  // hard-reject zero-bullet outputs.
  const trimmed = bullets.slice(0, 5);
  return {
    ok: true,
    plan: trimmed.map((b) => `- ${b}`).join("\n"),
    diagnostics: {
      rawResponseLength: raw.length,
      bulletCount: trimmed.length,
    },
  };
}

/**
 * Build the user-message context the replan LLM sees. Exported for
 * tests + so callers can preview what the LLM will be told.
 */
export function buildReplanContext(input: StagnationReplanInput): string {
  const parts: string[] = [];

  parts.push(
    `## Stagnation context`,
    `Worker has consumed ${input.iterationsConsumed} iteration(s) since last meaningful progress.`,
    `Last meaningful progress: "${input.lastProgressReason}".`,
    "",
  );

  if (input.repeatedReads.length > 0) {
    parts.push(
      `## Files the worker has been re-reading (DO NOT suggest reading these again)`,
      ...input.repeatedReads.slice(0, 10).map((f) => `- \`${f}\``),
      "",
    );
  }

  if (input.repeatedActions.length > 0) {
    parts.push(
      `## Repeated actions producing no mutation`,
      ...input.repeatedActions.slice(0, 8).map((a) => `- ${a}`),
      "",
    );
  }

  const d = input.diagnosticsSnapshot;
  if (d.tscErrors && d.tscErrors.length > 0) {
    parts.push(
      `## TSC errors (top 10)`,
      ...d.tscErrors.slice(0, 10).map((e) => `- ${e}`),
      "",
    );
  }
  if (d.routeAudit && d.routeAudit.length > 0) {
    parts.push(
      `## Route audit findings`,
      ...d.routeAudit.slice(0, 10).map((e) => `- ${e}`),
      "",
    );
  }
  if (d.contractCoverageGaps && d.contractCoverageGaps.length > 0) {
    parts.push(
      `## Contract usage coverage gaps`,
      ...d.contractCoverageGaps.slice(0, 10).map((e) => `- ${e}`),
      "",
    );
  }
  if (d.migrationGaps && d.migrationGaps.length > 0) {
    parts.push(
      `## Migration coverage gaps`,
      ...d.migrationGaps.slice(0, 10).map((e) => `- ${e}`),
      "",
    );
  }

  parts.push(
    "",
    "Produce the 3-bullet action plan now. Remember: each bullet names a specific file or command; no reads.",
  );

  return parts.join("\n");
}

function stripFences(s: string): string {
  return s
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function extractBullets(s: string): string[] {
  const out: string[] = [];
  for (const raw of s.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // Accept "-", "*", "1.", "1)" bullet styles.
    const m = line.match(/^(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (m && m[1]) {
      out.push(m[1].trim());
    }
  }
  return out;
}
