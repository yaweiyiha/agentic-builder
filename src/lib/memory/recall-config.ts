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
