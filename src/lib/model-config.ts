/**
 * Centralized model assignment for every pipeline step and agent role.
 *
 * How to use:
 *  - Change any value here to swap the model for that step.
 *  - Values must be a key of MODELS in openrouter.ts, or a raw OpenRouter
 *    model ID (e.g. "anthropic/claude-opus-4").
 *  - "gpt-5.4" is routed to the ByteDance GPT-5.4 gateway automatically.
 *  - "gemini-flash" resolves to google/gemini-2.0-flash-exp:free (free tier).
 *
 * Available aliases (see src/lib/openrouter.ts → MODELS):
 *   "gpt-5.4"            → gpt-5.4-2026-03-05  (ByteDance gateway)
 *   "gpt-4o"             → openai/gpt-4o
 *   "gpt-4o-mini"        → openai/gpt-4o-mini
 *   "claude-sonnet"      → anthropic/claude-sonnet-4
 *   "claude-opus"        → anthropic/claude-opus-4
 *   "gemini-pro"         → google/gemini-2.5-pro
 *   "gemini-flash"       → google/gemini-2.0-flash-exp:free  (free)
 *   "gemini-3-pro-preview" → google/gemini-2.5-pro  (legacy alias)
 */

export const MODEL_CONFIG = {
  // ── Preparation phase ──────────────────────────────────────────────────────

  /** Classifies the project tier (S/M/L). Lightweight JSON output. */
  intent: "gpt-4o-mini",

  /** Writes the full PRD. Highest-quality writing task → premium model. */
  prd: "gpt-4o",

  /**
   * PRD appendix: simple interaction flow diagram image via OpenRouter (low cost).
   * See `black-forest-labs/flux.2-klein-4b` in openrouter.ts.
   */
  prdInteractionImage: "alibaba/wan-2.6",

  /**
   * Lightweight structured PRD extraction — pages + component IDs.
   * Uses gpt-4o-mini for cost efficiency (JSON output, no creativity needed).
   */
  prdSpecExtract: "gpt-4o",

  /** PRD inline refinement (chat bar on the PRD review screen). */
  prdRefine: "gpt-4o",

  /** Technical Requirements Document. Deep reasoning needed. */
  trd: "gpt-4o",

  /** System architecture diagram & decisions. */
  sysdesign: "gpt-4o",

  /** Implementation guide for engineers. */
  implguide: "gpt-4o",

  /** UI/UX design specification. Structured output. */
  design: "gpt-4o-mini",

  /** Pencil (.pen file) design generation — needs structured batch_design output. */
  pencil: "gpt-5.2",

  /** Static mockup generation. Disabled by default. */
  mockup: "gpt-4o-mini",

  /** QA test-plan generation. Checklist output. */
  qa: "gpt-4o-mini",

  /** Final alignment verification. Simple comparison. */
  verify: "gpt-4o-mini",

  // ── Kick-off phase ─────────────────────────────────────────────────────────

  /**
   * Task breakdown for the coding phase.
   * Needs solid reasoning to produce well-scoped tasks.
   */
  taskBreakdown: "gpt-4o",

  // ── Coding phase ───────────────────────────────────────────────────────────

  /** Code generation per task (all coding sub-agents). */
  codeGen: "gpt-5.3-codex",

  /** Error-fix pass after code verification fails. */
  codeFix: "gpt-4o",
} as const;

export type ModelConfigKey = keyof typeof MODEL_CONFIG;
