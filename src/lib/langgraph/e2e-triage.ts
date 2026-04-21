/**
 * E2E test failure triage.
 *
 * The legacy `e2eVerifyAndFix` loop treated every non-zero exit from
 * `playwright test` as proof of an application bug and fed the output
 * straight to an LLM for "auto-repair". That behaviour has two failure
 * modes in practice:
 *
 *  1. Flaky failures (timing, mock race, fast backend) that pass on a
 *     second run get "fixed" anyway — the LLM rewrites otherwise-correct
 *     code and often introduces real regressions chasing a symptom that
 *     doesn't actually reproduce.
 *  2. Infra failures (backend not started, DB missing, port clash,
 *     DNS error) look identical to bugs at the shell-exit level. The LLM
 *     then tries to patch frontend source to compensate — which can't
 *     succeed, and burns tokens while making the code worse.
 *
 * This module adds a triage stage between "test run" and "fix" that:
 *   • Re-runs the command once when the first run fails, to observe flake.
 *   • Parses failing-test names + error signatures out of Playwright output.
 *   • Classifies each failure as `deterministic` / `flaky` / `infra`.
 *   • Returns only the deterministic set to the caller, plus a structured
 *     report suitable for `.ralph/e2e-triage.md` and SSE `repair_event`s.
 *
 * The parser is deliberately conservative: it recognises Playwright's
 * default console reporter format. JSON reporter support can be layered
 * on later; for now we work with what the existing shell command emits.
 */

export type FailureClass = "deterministic" | "flaky" | "infra";

export interface FailedTestRecord {
  /** Full test name including spec path + test title. Stable across runs. */
  name: string;
  /**
   * Normalised first-line error signature — used to compare runs. Timestamps,
   * counters and other per-run noise are stripped so the same "real" bug
   * matches on both runs.
   */
  errorSignature: string;
  /** Up to ~400 chars of raw error context, for LLM prompt + the markdown report. */
  errorSnippet: string;
  /** Playwright project (e.g. "chromium"). */
  project?: string;
}

export interface TriageInput {
  firstRunOutput: string;
  firstRunExitCode: number;
  secondRunOutput?: string;
  secondRunExitCode?: number;
}

export interface TriageResult {
  firstRunFailures: FailedTestRecord[];
  secondRunFailures: FailedTestRecord[];
  deterministic: FailedTestRecord[];
  flaky: FailedTestRecord[];
  infra: FailedTestRecord[];
  /** Tests that failed in the first run but passed on retry — self-healed. */
  selfHealed: FailedTestRecord[];
  /** Human-readable markdown report for `.ralph/e2e-triage.md`. */
  report: string;
  /**
   * Short 1-line classification line for logs — e.g.
   *   "triage: 3 deterministic, 1 flaky, 0 infra (2 self-healed on retry)"
   */
  summary: string;
}

/**
 * Substrings that, when present in e2e output, indicate infrastructure
 * problems rather than application bugs. Case-insensitive match.
 */
const INFRA_PATTERNS: ReadonlyArray<RegExp> = [
  /\bECONNREFUSED\b/i,
  /\bEADDRINUSE\b/i,
  /\bENETUNREACH\b/i,
  /\bEAI_AGAIN\b/i,
  /\bENOTFOUND\b/i,
  /net::ERR_CONNECTION_REFUSED/i,
  /net::ERR_EMPTY_RESPONSE/i,
  /net::ERR_NAME_NOT_RESOLVED/i,
  /net::ERR_INTERNET_DISCONNECTED/i,
  /Failed to connect to/i,
  /Database connection (failed|refused|error)/i,
  /Cannot connect to the database/i,
  /Error: listen EADDRINUSE/i,
  /Error: connect ECONNREFUSED/i,
  /getaddrinfo ENOTFOUND/i,
  /Browser closed unexpectedly/i,
  /Target page, context or browser has been closed/i,
];

/**
 * The caller runs the e2e command twice (first run, and on failure a
 * retry) and passes both outputs here. Returns a structured triage.
 *
 * When the caller omits `secondRunOutput`, every failure from the first
 * run is treated as deterministic — no flake detection is possible.
 */
export function triageE2eFailures(input: TriageInput): TriageResult {
  const firstRunFailures = parsePlaywrightFailures(input.firstRunOutput);
  const secondRunFailures =
    input.secondRunOutput !== undefined
      ? parsePlaywrightFailures(input.secondRunOutput)
      : firstRunFailures;

  const firstRunHasInfra = hasInfraSignal(input.firstRunOutput);
  const secondRunHasInfra = hasInfraSignal(input.secondRunOutput ?? "");

  // Infra detection is output-level: if the whole run blew up on a
  // connection error we won't necessarily see per-test failures, but we
  // still want to halt auto-fix. Record it as a synthetic infra entry.
  if (firstRunHasInfra && firstRunFailures.length === 0) {
    firstRunFailures.push({
      name: "__infra__",
      errorSignature: firstRunOutputInfraSignature(input.firstRunOutput),
      errorSnippet: input.firstRunOutput.slice(-600),
    });
  }

  const firstByName = new Map(firstRunFailures.map((f) => [f.name, f]));
  const secondByName = new Map(
    (secondRunFailures ?? []).map((f) => [f.name, f]),
  );

  const deterministic: FailedTestRecord[] = [];
  const flaky: FailedTestRecord[] = [];
  const infra: FailedTestRecord[] = [];
  const selfHealed: FailedTestRecord[] = [];

  const retried = input.secondRunOutput !== undefined;

  for (const [name, first] of firstByName) {
    const isInfraSig =
      INFRA_PATTERNS.some((re) => re.test(first.errorSnippet)) ||
      name === "__infra__" ||
      (firstRunHasInfra && input.firstRunExitCode !== 0 && !retried);
    if (isInfraSig) {
      infra.push(first);
      continue;
    }

    if (!retried) {
      deterministic.push(first);
      continue;
    }

    const second = secondByName.get(name);
    if (!second) {
      // Failed once, passed on retry — classic flake.
      selfHealed.push(first);
      continue;
    }

    if (second.errorSignature === first.errorSignature) {
      deterministic.push(first);
    } else {
      // Same test fails both times but with different error → flaky.
      flaky.push(first);
    }
  }

  // A failure that only appeared in the second run is flaky by definition.
  if (retried) {
    for (const [name, second] of secondByName) {
      if (firstByName.has(name)) continue;
      if (
        INFRA_PATTERNS.some((re) => re.test(second.errorSnippet)) ||
        secondRunHasInfra
      ) {
        infra.push(second);
      } else {
        flaky.push(second);
      }
    }
  }

  const report = buildTriageReport({
    firstRunFailures,
    secondRunFailures,
    deterministic,
    flaky,
    infra,
    selfHealed,
    retried,
  });
  const summary = `triage: ${deterministic.length} deterministic, ${flaky.length} flaky, ${infra.length} infra (${selfHealed.length} self-healed on retry)`;

  return {
    firstRunFailures,
    secondRunFailures,
    deterministic,
    flaky,
    infra,
    selfHealed,
    report,
    summary,
  };
}

/** Quick check used by callers to short-circuit triage entirely. */
export function hasInfraSignal(output: string): boolean {
  return INFRA_PATTERNS.some((re) => re.test(output));
}

// ─── parsing ─────────────────────────────────────────────────────────────

/**
 * Playwright's default reporter prints a "Failed tests" block that looks
 * like this (paraphrased):
 *
 *   1) [chromium] › e2e/home.spec.ts:25:3 › Home Page - Record Entry and Display › E2E-002 — Submit valid record successfully
 *
 *      Error: expect(locator).toBeDisabled() failed
 *      ...
 *
 *      Locator:  getByRole('button', { name: 'Submit' })
 *      ...
 *
 *   2) [chromium] › e2e/home.spec.ts:119:3 › Home Page - Record Entry and Display › E2E-005 — Retry failed record loading
 *      ...
 *
 * And a footer like:
 *
 *      2 failed
 *        [chromium] › e2e/home.spec.ts:25:3 › Home Page - Record Entry and Display › E2E-002 — Submit valid record successfully
 *        [chromium] › e2e/home.spec.ts:119:3 › ...
 *      5 passed (29.3s)
 *
 * We parse the numbered block to recover both the test name and the first
 * few lines of its error; those together form the `errorSignature`.
 */
export function parsePlaywrightFailures(output: string): FailedTestRecord[] {
  if (!output) return [];
  const lines = output.split("\n");

  // Locate the start of each numbered failure. Playwright indents the
  // number with 2-4 spaces and follows with `) `.
  //   group 1 = optional project (e.g. "chromium")
  //   group 2 = test name (rest of the line after the optional "[project] › ")
  const HEADER = /^\s{0,6}\d+\)\s+(?:\[([^\]]+)\]\s*›\s*)?(.+)$/;
  const out: FailedTestRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = HEADER.exec(lines[i]);
    if (!m) continue;
    const projectName = m[1]?.trim();
    const rawName = m[2].trim();
    // Guard against matching random numbered lines by requiring the name
    // to look like a Playwright test reference (spec path + ` › `).
    if (!/›/.test(rawName) && !/\.spec\.(ts|tsx|js|jsx)/.test(rawName)) {
      continue;
    }

    // Collect the next ~15 non-empty lines as the error body.
    const bodyLines: string[] = [];
    let j = i + 1;
    while (j < lines.length && bodyLines.length < 20) {
      const line = lines[j];
      // Next numbered failure → stop.
      if (/^\s{0,6}\d+\)\s+\[/.test(line)) break;
      if (/^\s*\d+\s+failed\s*$/.test(line)) break;
      if (/^\s*\d+\s+passed\b/.test(line)) break;
      bodyLines.push(line);
      j++;
    }
    const snippet = bodyLines.join("\n").trim().slice(0, 1200);
    const signature = buildErrorSignature(snippet);

    out.push({
      name: rawName,
      project: projectName,
      errorSignature: signature,
      errorSnippet: snippet,
    });
    i = j - 1;
  }
  return dedupeByName(out);
}

function dedupeByName(records: FailedTestRecord[]): FailedTestRecord[] {
  const seen = new Map<string, FailedTestRecord>();
  for (const r of records) {
    if (!seen.has(r.name)) seen.set(r.name, r);
  }
  return [...seen.values()];
}

/**
 * Build a stable short signature from an error snippet. We take the first
 * non-empty line that looks like the real error (`Error: ...`, an `expect`
 * line, or `Timeout: ...`) and strip known per-run noise.
 */
function buildErrorSignature(snippet: string): string {
  const lines = snippet.split("\n").map((l) => l.trim()).filter(Boolean);
  const candidate =
    lines.find((l) => /^Error:/i.test(l)) ??
    lines.find((l) => /expect\(/.test(l)) ??
    lines.find((l) => /^Timeout/i.test(l)) ??
    lines[0] ??
    "";
  return normaliseSignatureLine(candidate);
}

function normaliseSignatureLine(line: string): string {
  return line
    // Per-run timestamps & counters.
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "<ts>")
    .replace(/\d{13,}/g, "<n>") // Date.now()-style
    .replace(/\b\d+\s*ms\b/g, "<ms>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function firstRunOutputInfraSignature(output: string): string {
  const m = INFRA_PATTERNS.map((re) => re.exec(output))
    .find((r): r is RegExpExecArray => r !== null);
  return m ? `infra: ${m[0]}` : "infra: unknown-network";
}

// ─── report ──────────────────────────────────────────────────────────────

interface ReportInput {
  firstRunFailures: FailedTestRecord[];
  secondRunFailures: FailedTestRecord[];
  deterministic: FailedTestRecord[];
  flaky: FailedTestRecord[];
  infra: FailedTestRecord[];
  selfHealed: FailedTestRecord[];
  retried: boolean;
}

function buildTriageReport(input: ReportInput): string {
  const lines: string[] = [];
  lines.push(`# E2E Triage report`);
  lines.push("");
  lines.push(
    `- First run failures: **${input.firstRunFailures.length}**`,
  );
  if (input.retried) {
    lines.push(
      `- Second run failures: **${input.secondRunFailures.length}** (same command, re-run to detect flakes)`,
    );
  } else {
    lines.push(`- Second run: skipped (single-run triage).`);
  }
  lines.push(
    `- Classified: **${input.deterministic.length} deterministic**, **${input.flaky.length} flaky**, **${input.infra.length} infra**, **${input.selfHealed.length} self-healed on retry**`,
  );
  lines.push("");
  lines.push(
    `Only deterministic failures are sent to the LLM fix prompt. Flaky / infra failures are logged here and **not** passed to auto-repair — rewriting code on a flake is worse than leaving it alone.`,
  );
  lines.push("");

  appendSection(
    lines,
    "Deterministic failures (fed to auto-repair)",
    input.deterministic,
  );
  appendSection(
    lines,
    "Flaky failures (skipped — retry gave a different result)",
    input.flaky,
  );
  appendSection(
    lines,
    "Infra failures (skipped — network/environment, not a code bug)",
    input.infra,
  );
  appendSection(
    lines,
    "Self-healed on retry (skipped — retry passed)",
    input.selfHealed,
  );

  return lines.join("\n") + "\n";
}

function appendSection(
  out: string[],
  heading: string,
  records: FailedTestRecord[],
): void {
  out.push(`## ${heading}`);
  out.push("");
  if (records.length === 0) {
    out.push("_(none)_");
    out.push("");
    return;
  }
  for (const r of records) {
    out.push(
      `- **${r.name}**${r.project ? ` _(${r.project})_` : ""}`,
    );
    if (r.errorSignature) {
      out.push(`  - signature: \`${r.errorSignature}\``);
    }
  }
  out.push("");
}
