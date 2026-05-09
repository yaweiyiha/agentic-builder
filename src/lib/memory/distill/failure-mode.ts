/**
 * Classify a free-form error message into one of a small set of stable
 * failure-mode labels. Used as a bucketing key for memory metrics &
 * attribution so we can answer "do recalled patterns help compile-errors
 * more than they help api-errors?".
 *
 * Labels are intentionally coarse — they're for analytical bucketing, not
 * root-cause analysis. If callers want finer granularity, they can pass
 * a structured failureMode directly to recordTaskHistory and bypass this
 * classifier.
 */

export type FailureMode =
  | "compile-error" // tsc / build / parse failures
  | "type-error" // TS type mismatches at compile or runtime
  | "runtime-error" // generic JS runtime exceptions (TypeError, ReferenceError, etc.)
  | "api-error" // HTTP / fetch / network / contract failures
  | "timeout" // operation exceeded budget
  | "validation-error" // schema / input validation
  | "permission-error" // auth / forbidden / EACCES / EPERM
  | "not-found" // 404 / ENOENT / module-not-found
  | "unknown";

interface Pattern {
  mode: FailureMode;
  re: RegExp;
}

// Order matters — earlier patterns win on the first match. Place more
// specific patterns above broad ones.
const PATTERNS: readonly Pattern[] = [
  { mode: "timeout", re: /\b(timeout|timed out|deadline exceeded|ETIMEDOUT)\b/i },
  { mode: "permission-error", re: /\b(EACCES|EPERM|forbidden|unauthori[sz]ed|401|403)\b/i },
  { mode: "not-found", re: /\b(ENOENT|not found|cannot find module|404)\b/i },
  { mode: "compile-error", re: /\b(SyntaxError|ParseError|tsc[: ]|TS\d{3,4}|cannot compile|build failed|JSX element|expected[^.]*token)\b/i },
  { mode: "type-error", re: /\b(TypeError|is not assignable to|does not exist on type|implicitly has an 'any' type|TS2\d{3})\b/i },
  { mode: "validation-error", re: /\b(ValidationError|ZodError|schema (?:mismatch|invalid)|invalid input|missing required field)\b/i },
  { mode: "api-error", re: /\b(fetch failed|ECONNREFUSED|ENETUNREACH|ECONNRESET|HTTP\s*5\d{2}|HTTP\s*4\d{2}|status\s*[45]\d{2}|axios|response\.status)\b/i },
  { mode: "runtime-error", re: /\b(RangeError|ReferenceError|EvalError|URIError|undefined is not (?:a function|an object)|cannot read propert(?:y|ies))\b/i },
];

export function classifyFailureMode(message?: string | null): FailureMode {
  if (!message) return "unknown";
  for (const p of PATTERNS) {
    if (p.re.test(message)) return p.mode;
  }
  return "unknown";
}
