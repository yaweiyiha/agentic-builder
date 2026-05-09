/**
 * Recall ranking weights.
 *
 * score = w1*tag_match + w2*text_relevance + w3*log(hits+1)
 *       + w4*recency_decay - w5*negative_score_penalty
 */

export interface RecallWeights {
  tagMatch: number;
  textRelevance: number;
  hits: number;
  recency: number;
  negativeScorePenalty: number;
}

export const DEFAULT_RECALL_WEIGHTS: Readonly<RecallWeights> = Object.freeze({
  tagMatch: 3,
  textRelevance: 2,
  hits: 1,
  recency: 1,
  negativeScorePenalty: 5,
});

/** Half-life in ms for recency decay. Default 30 days. */
export const RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

export const DEFAULT_RECALL_LIMIT = 5;

/** Hard cap on injected memory tokens. See design doc §14 Q5. */
export const INJECT_TOKEN_BUDGET = 1500;

/**
 * Per-role token budget for injected memory. Architects survey wide context
 * and benefit from more recall; test workers operate on narrower acceptance
 * criteria and get a smaller budget. Unknown roles fall back to the default.
 */
export const INJECT_TOKEN_BUDGETS_BY_ROLE: Readonly<Record<string, number>> =
  Object.freeze({
    architect: 2500,
    frontend: 1500,
    backend: 1500,
    test: 800,
  });

export function getInjectTokenBudgetForRole(role?: string): number {
  if (!role) return INJECT_TOKEN_BUDGET;
  return INJECT_TOKEN_BUDGETS_BY_ROLE[role] ?? INJECT_TOKEN_BUDGET;
}

/**
 * Injection-time re-ranking weights. The recall step (file-store.rankScore)
 * optimises for retrieval — it pays attention to tag/text match but only
 * *penalises* negative quality scores, so it can't surface high-quality
 * patterns above mediocre ones. When the token budget bites we want the
 * highest-quality, most-recent, best-validated records to win, hence this
 * second pass.
 */
export interface InjectRelevanceWeights {
  qualityScore: number;
  recency: number;
  hits: number;
}

export const DEFAULT_INJECT_RELEVANCE_WEIGHTS: Readonly<InjectRelevanceWeights> =
  Object.freeze({
    qualityScore: 4,
    recency: 1,
    hits: 0.5,
  });
