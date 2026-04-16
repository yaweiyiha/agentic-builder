/**
 * Centralized model assignment for every pipeline step and agent role.
 *
 * Each key maps to either:
 *   - A single model alias / raw OpenRouter model ID (string)
 *   - An ordered fallback chain (string[]) — first model tried; on failure, next, etc.
 *
 * Available aliases (see src/lib/openrouter.ts → MODELS):
 *   "gpt-5.4"            → gpt-5.4-2026-03-05  (ByteDance gateway)
 *   "gpt-4o"             → openai/gpt-4o
 *   "gpt-4o-mini"        → openai/gpt-4o-mini
 *   "claude-sonnet"      → anthropic/claude-sonnet-4
 *   "claude-opus"        → anthropic/claude-opus-4
 *   "gemini-pro"         → google/gemini-2.5-pro
 *   "gemini-flash"       → google/gemini-2.0-flash-exp:free  (free)
 */

export const MODEL_CONFIG = {
  // ── Preparation phase ──────────────────────────────────────────────────────

  intent: "gpt-4o-mini",
  prd: "openai/gpt-5.4",
  prdInteractionImage: "alibaba/wan-2.6",
  prdSpecExtract: "gpt-4o",
  prdRefine: "gpt-4o",
  trd: "gpt-4o",
  sysdesign: "gpt-4o",
  implguide: "gpt-4o",
  design: "gpt-4o-mini",
  pencil: "openai/gpt-5.4",
  pencilToolUse: "openai/gpt-5.4",
  mockup: "gpt-4o-mini",
  qa: "gpt-4o-mini",
  verify: "gpt-4o-mini",

  // ── Kick-off phase ─────────────────────────────────────────────────────────

  // claude-sonnet-4 supports 64K output tokens — much less likely to truncate large task lists
  taskBreakdown: ["claude-sonnet-4", "openai/gpt-5.4"] as string[],
  taskBreakdownReview: ["openai/gpt-5.4", "claude-sonnet-4"] as string[],

  // ── Coding phase ───────────────────────────────────────────────────────────

  /** Code generation: try primary, fall back to secondary on failure. */
  codeGen: [
    "openai/gpt-5.3-codex",
    "deepseek/deepseek-v3.2",
    "qwen/qwen3.6-plus",
    "claude-sonnet",
  ] as string[],

  /** Error-fix pass: cheaper models suffice for targeted tsc/build fixes. */
  codeFix: [
    "claude-sonnet",
    "qwen/qwen3.6-plus",
    "deepseek/deepseek-v3.2",
  ] as string[],

  /**
   * Phase verify+fix agentic loop (merged).
   * Needs strong tool-use / function-calling capability.
   */
  phaseVerifyFix: [
    "openai/gpt-5.3-codex",
    "qwen/qwen3.6-plus",
    "deepseek/deepseek-v3.2",
    "gpt-4o",
  ] as string[],

  /**
   * E2E coverage generation / repair.
   * Prefer stronger first model because this step must align test cases to PRD.
   */
  e2eGen: [
    "claude-sonnet-4",
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex",
  ] as string[],
} as const;

export type ModelConfigKey = keyof typeof MODEL_CONFIG;

/**
 * Normalize a MODEL_CONFIG value (string or string[]) to an ordered chain of resolved IDs.
 * Always returns at least one element.
 */
export function resolveModelChain(
  configValue: string | readonly string[],
  resolver: (alias: string) => string,
): string[] {
  const raw = Array.isArray(configValue) ? configValue : [configValue];
  return raw.map(resolver);
}

/**
 * Get the primary (first) model from a config value.
 * Convenience wrapper for contexts that only need a single model.
 */
export function primaryModel(configValue: string | readonly string[]): string {
  if (typeof configValue === "string") return configValue;
  return (configValue as readonly string[])[0] ?? "gpt-4o";
}
