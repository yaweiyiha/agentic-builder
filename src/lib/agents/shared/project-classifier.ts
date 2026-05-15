import { createHash } from "node:crypto";

import {
  chatCompletion,
  resolveModel,
  estimateCost,
  type ChatMessage,
} from "@/lib/openrouter";
import { MODEL_CONFIG } from "@/lib/model-config";
import { memoryCacheEnabled } from "@/lib/memory/env";
import { getSystemMemory } from "@/lib/memory";
import { getTraceLogger } from "@/lib/memory/trace";

export type ProjectTier = "S" | "M" | "L";

export interface ProjectClassification {
  tier: ProjectTier;
  type: string;
  needsBackend: boolean;
  needsDatabase: boolean;
  needsAuth: boolean;
  needsMultipleServices: boolean;
  reasoning: string;
  costUsd: number;
  durationMs: number;
}

/**
 * Returns true when an L-tier classification should be silently downgraded
 * to M-tier across the entire pipeline (scaffold copy, task breakdown,
 * coding context, etc.). Default: ON.
 *
 * Rationale: the L-tier scaffold (pnpm monorepo + Next.js + Fastify +
 * shared package) ships only empty shells and exercises rarely-tested
 * codegen paths. The M-tier scaffold (frontend + backend split) is the
 * battle-tested default and produces drastically more reliable results
 * for the kind of full-stack PoC projects this builder targets.
 *
 * Set `BLUEPRINT_ALLOW_L_TIER=1` (or `=true`) to restore native L-tier
 * routing once the L scaffold has been hardened.
 */
function isLToMDowngradeEnabled(): boolean {
  const v = process.env.BLUEPRINT_ALLOW_L_TIER?.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return false;
  return true;
}

export function normalizeProjectTier(tier?: string | null): ProjectTier {
  const t = (tier ?? "M").toUpperCase();
  let normalized: ProjectTier;
  if (t === "S" || t === "M" || t === "L") {
    normalized = t as ProjectTier;
  } else {
    normalized = "M";
  }
  if (normalized === "L" && isLToMDowngradeEnabled()) {
    if (process.env.NODE_ENV !== "test") {
      console.log(
        "[ProjectClassifier] tier=L detected → downgrading to M (set BLUEPRINT_ALLOW_L_TIER=1 to keep L)",
      );
    }
    return "M";
  }
  return normalized;
}

const CLASSIFIER_PROMPT = `You are a project complexity classifier. Given a feature brief, classify the project into one of three tiers.

## Tiers

**S (Simple)**: Single-page apps, small tools, utilities, browser-only apps, timers, calculators, todo lists, simple games, static sites, CLI tools. No backend needed, or at most a simple API. Pure frontend or very lightweight.

**M (Medium)**: Full-stack applications with a single backend service. Has a database but straightforward schema. Might have basic auth. Examples: blog platform, personal dashboard, simple e-commerce, booking system, note-taking app.

**L (Large)**: Complex platforms with multiple services/modules, complex business logic, multiple user roles, third-party integrations, real-time features, microservices. Examples: SaaS platforms, marketplace, collaboration tools like Figma, enterprise systems.

## Output Format (strict JSON only)

\`\`\`json
{
  "tier": "S" | "M" | "L",
  "type": "one-word category like tool/app/platform/game/site",
  "needsBackend": boolean,
  "needsDatabase": boolean,
  "needsAuth": boolean,
  "needsMultipleServices": boolean,
  "reasoning": "one sentence explaining the classification"
}
\`\`\`

Output ONLY the JSON block. No other text.`;

/**
 * BUMP whenever CLASSIFIER_PROMPT changes (review checklist requirement).
 * Cached results from older versions stay in the index but never re-hit.
 * See MEMORY_SYSTEM_DESIGN.md §12.6.1 R3.
 */
export const CLASSIFIER_PROMPT_VERSION = "v1-2026-04-28";

/** Conservative — trim + collapse internal whitespace. No lowercasing,
 *  no punctuation stripping. See design doc §12.6.1 R2. */
function normalizeBrief(brief: string): string {
  return brief.trim().replace(/\s+/g, " ");
}

function classificationCacheKey(brief: string, model: string): string {
  const payload = `${normalizeBrief(brief)}::${CLASSIFIER_PROMPT_VERSION}::${model}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function classificationRecordId(key: string): string {
  return `CL-${key}`;
}

interface CachedClassificationBody extends ProjectClassification {
  briefHash: string;
  promptVersion: string;
  modelUsed: string;
}

async function tryClassificationCache(
  briefHash: string,
  model: string,
): Promise<ProjectClassification | null> {
  const store = getSystemMemory();
  const id = classificationRecordId(briefHash);
  const start = Date.now();
  const hit = await store.get(id);
  if (!hit) {
    void getTraceLogger(process.cwd()).log({
      op: "cache-miss",
      layer: "L1",
      details: { kind: "classification", briefHash, model },
    });
    return null;
  }
  let body: CachedClassificationBody;
  try {
    body = JSON.parse(hit.body) as CachedClassificationBody;
  } catch {
    // Corrupt body — drop it so next call rewrites cleanly.
    await store.delete(id).catch(() => {});
    return null;
  }
  if (body.promptVersion !== CLASSIFIER_PROMPT_VERSION) {
    // Stale entry from a prior prompt version. Don't return it; let LLM
    // re-classify and overwrite via idempotent save.
    return null;
  }
  // Awaited (not fire-and-forget) so the lockfile is released before the
  // process can exit on short-lived runs / between test cases.
  await store.bumpHit(id);
  void getTraceLogger(process.cwd()).log({
    op: "cache-hit",
    layer: "L1",
    details: {
      kind: "classification",
      briefHash,
      id,
      lookupMs: Date.now() - start,
    },
  });
  // Honest accounting: cache hit incurs no LLM cost; report 0 + lookup ms
  // so engine totalCostUsd doesn't double-count.
  return {
    tier: body.tier,
    type: body.type,
    needsBackend: body.needsBackend,
    needsDatabase: body.needsDatabase,
    needsAuth: body.needsAuth,
    needsMultipleServices: body.needsMultipleServices,
    reasoning: body.reasoning,
    costUsd: 0,
    durationMs: Date.now() - start,
  };
}

async function writeClassificationCache(
  briefHash: string,
  model: string,
  result: ProjectClassification,
): Promise<void> {
  try {
    const store = getSystemMemory();
    const body: CachedClassificationBody = {
      ...result,
      briefHash,
      promptVersion: CLASSIFIER_PROMPT_VERSION,
      modelUsed: model,
    };
    await store.save({
      id: classificationRecordId(briefHash),
      layer: "L1",
      kind: "classification",
      title: `Classification · ${result.tier} · ${result.type}`,
      body: JSON.stringify(body),
      tags: [
        "classifier",
        `tier:${result.tier}`,
        `type:${result.type}`,
        `promptVersion:${CLASSIFIER_PROMPT_VERSION}`,
      ],
      source: "cache",
      refs: {},
    });
  } catch (err) {
    console.warn(
      "[memory] writeClassificationCache failed:",
      (err as Error).message,
    );
  }
}

export async function classifyProject(
  featureBrief: string,
): Promise<ProjectClassification> {
  const model = resolveModel(MODEL_CONFIG.intent);
  const briefHash = classificationCacheKey(featureBrief, model);

  if (memoryCacheEnabled()) {
    const hit = await tryClassificationCache(briefHash, model);
    if (hit) return hit;
  }

  const { classification, didFallback } = await runClassifierLLM(
    featureBrief,
    model,
  );

  if (memoryCacheEnabled() && !didFallback) {
    // writeClassificationCache swallows errors internally (try/catch +
    // console.warn), so awaiting it is safe for the caller. We do await so
    // that subsequent classifyProject() calls in the same process see the
    // cached entry, and so the cache reaches disk before short-lived runs
    // exit. Disk write is < ~10ms; LLM call dominated.
    await writeClassificationCache(briefHash, model, classification);
  }

  return classification;
}

async function runClassifierLLM(
  featureBrief: string,
  model: string,
): Promise<{ classification: ProjectClassification; didFallback: boolean }> {
  const messages: ChatMessage[] = [
    { role: "system", content: CLASSIFIER_PROMPT },
    { role: "user", content: featureBrief },
  ];

  const startMs = Date.now();
  let response;
  try {
    response = await chatCompletion(messages, {
      model,
      temperature: 0.1,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    });
  } catch (err) {
    console.warn(
      "[ProjectClassifier] LLM classification failed, using heuristic fallback:",
      err instanceof Error ? err.message : err,
    );
    return {
      classification: fallbackClassification(featureBrief, 0, Date.now() - startMs),
      didFallback: true,
    };
  }
  const durationMs = Date.now() - startMs;

  const raw = response.choices[0]?.message?.content ?? "";
  const costUsd = estimateCost(response.model, response.usage);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      classification: fallbackClassification(featureBrief, costUsd, durationMs),
      didFallback: true,
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const tier = normalizeProjectTier(
      ["S", "M", "L"].includes(parsed.tier) ? parsed.tier : "M",
    );

    return {
      classification: {
        tier,
        type: parsed.type ?? "app",
        needsBackend: parsed.needsBackend ?? tier !== "S",
        needsDatabase: parsed.needsDatabase ?? tier === "L",
        needsAuth: parsed.needsAuth ?? tier === "L",
        needsMultipleServices: parsed.needsMultipleServices ?? tier === "L",
        reasoning: parsed.reasoning ?? "",
        costUsd,
        durationMs,
      },
      didFallback: false,
    };
  } catch {
    return {
      classification: fallbackClassification(featureBrief, costUsd, durationMs),
      didFallback: true,
    };
  }
}

function fallbackClassification(
  brief: string,
  costUsd: number,
  durationMs: number,
): ProjectClassification {
  const lower = brief.toLowerCase();
  const complexSignals = [
    /platform|marketplace|saas|enterprise|multi.?tenant/,
    /micro\s*service|multiple\s+service/,
    /real.?time.*collab|figma|notion/,
  ];
  const simpleSignals = [
    /timer|clock|calculator|todo|pomodoro|stopwatch/,
    /simple|basic|small|mini|tiny|quick/,
    /game|quiz|flashcard|converter|counter/,
    /landing\s*page|static|portfolio|blog\s*post/,
  ];

  if (simpleSignals.some((p) => p.test(lower))) {
    return {
      tier: normalizeProjectTier("S"),
      type: "tool",
      needsBackend: false,
      needsDatabase: false,
      needsAuth: false,
      needsMultipleServices: false,
      reasoning: "Heuristic fallback: simple project signals detected",
      costUsd,
      durationMs,
    };
  }
  if (complexSignals.some((p) => p.test(lower))) {
    return {
      tier: normalizeProjectTier("L"),
      type: "platform",
      needsBackend: true,
      needsDatabase: true,
      needsAuth: true,
      needsMultipleServices: true,
      reasoning: "Heuristic fallback: complex project signals detected",
      costUsd,
      durationMs,
    };
  }

  return {
    tier: normalizeProjectTier("M"),
    type: "app",
    needsBackend: true,
    needsDatabase: true,
    needsAuth: false,
    needsMultipleServices: false,
    reasoning: "Heuristic fallback: default medium tier",
    costUsd,
    durationMs,
  };
}
