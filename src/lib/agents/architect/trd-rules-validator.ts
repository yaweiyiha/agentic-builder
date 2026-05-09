/**
 * Lightweight shape validator for the business-rules DSL emitted in
 * TRD §7. Intentionally regex-based — full YAML parsing happens later
 * when codegen consumes the DSL; this validator runs at TRD time so the
 * dashboard can flag obvious format problems before the user confirms.
 *
 * MVP supports two rule types:
 *   - piecewise-linear  (segmented numeric mapping)
 *   - decision-table    (top-to-bottom case match)
 *
 * Anything else is flagged as `unknown-rule-type`. The validator never
 * throws and never blocks — its output is advisory metadata only.
 */

export type RulesDslWarningCode =
  | "missing-version"
  | "missing-rules"
  | "no-rules"
  | "rule-missing-id"
  | "rule-missing-type"
  | "unknown-rule-type"
  | "empty-content";

export interface RulesDslWarning {
  code: RulesDslWarningCode;
  message: string;
}

export interface RulesDslValidation {
  /** True when no warnings were raised. */
  ok: boolean;
  /** Number of rule entries discovered (by counting top-level `- id:`). */
  ruleCount: number;
  /** Distinct rule types referenced. */
  ruleTypes: string[];
  /** Advisory warnings — the dashboard / log surface for them, but
   *  pipeline does NOT fail on warnings. */
  warnings: RulesDslWarning[];
}

const SUPPORTED_TYPES = ["piecewise-linear", "decision-table"] as const;

export function validateRulesDsl(yaml: string): RulesDslValidation {
  const warnings: RulesDslWarning[] = [];

  if (!yaml.trim()) {
    return {
      ok: false,
      ruleCount: 0,
      ruleTypes: [],
      warnings: [
        { code: "empty-content", message: "DSL block is empty." },
      ],
    };
  }

  if (!/^\s*version:\s*1\b/m.test(yaml)) {
    warnings.push({
      code: "missing-version",
      message: "Missing top-level `version: 1` declaration.",
    });
  }

  if (!/^\s*rules:\s*$/m.test(yaml) && !/^\s*rules:\s*\[/m.test(yaml)) {
    warnings.push({
      code: "missing-rules",
      message: "Missing top-level `rules:` array.",
    });
  }

  // Each rule starts with `  - id: <something>` (two-space indent typical).
  const ruleIdMatches = Array.from(yaml.matchAll(/^\s*-\s*id:\s*(\S+)/gm));
  const ruleCount = ruleIdMatches.length;

  if (ruleCount === 0) {
    warnings.push({
      code: "no-rules",
      message: "No rule entries with `id:` field were found.",
    });
  }

  // Count `type:` occurrences. Each rule should have exactly one.
  const typeMatches = Array.from(yaml.matchAll(/^\s*type:\s*(\S+)/gm));
  const ruleTypes = Array.from(new Set(typeMatches.map((m) => m[1]!)));

  if (ruleCount > 0 && typeMatches.length < ruleCount) {
    warnings.push({
      code: "rule-missing-type",
      message: `Expected ${ruleCount} \`type:\` entries (one per rule); found ${typeMatches.length}.`,
    });
  }

  for (const t of ruleTypes) {
    if (!SUPPORTED_TYPES.includes(t as (typeof SUPPORTED_TYPES)[number])) {
      warnings.push({
        code: "unknown-rule-type",
        message:
          `Rule type "${t}" is not in the MVP supported set ` +
          `(${SUPPORTED_TYPES.join(", ")}). It will pass through to codegen ` +
          "but lacks a template and will be generated freeform.",
      });
    }
  }

  return {
    ok: warnings.length === 0,
    ruleCount,
    ruleTypes,
    warnings,
  };
}
