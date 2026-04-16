import {
  chatCompletion,
  resolveModel,
  estimateCost,
  type ChatMessage,
} from "@/lib/openrouter";
import { MODEL_CONFIG } from "@/lib/model-config";

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

export function normalizeProjectTier(_tier?: string | null): ProjectTier {
  return "M";
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

export async function classifyProject(
  featureBrief: string,
): Promise<ProjectClassification> {
  const model = resolveModel(MODEL_CONFIG.intent);

  const messages: ChatMessage[] = [
    { role: "system", content: CLASSIFIER_PROMPT },
    { role: "user", content: featureBrief },
  ];

  const startMs = Date.now();
  const response = await chatCompletion(messages, {
    model,
    temperature: 0.1,
    max_tokens: 256,
  });
  const durationMs = Date.now() - startMs;

  const raw = response.choices[0]?.message?.content ?? "";
  const costUsd = estimateCost(response.model, response.usage);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return fallbackClassification(featureBrief, costUsd, durationMs);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const tier = normalizeProjectTier(
      ["S", "M", "L"].includes(parsed.tier) ? parsed.tier : "M",
    );

    return {
      tier,
      type: parsed.type ?? "app",
      needsBackend: parsed.needsBackend ?? tier !== "S",
      needsDatabase: parsed.needsDatabase ?? tier === "L",
      needsAuth: parsed.needsAuth ?? tier === "L",
      needsMultipleServices: parsed.needsMultipleServices ?? tier === "L",
      reasoning: parsed.reasoning ?? "",
      costUsd,
      durationMs,
    };
  } catch {
    return fallbackClassification(featureBrief, costUsd, durationMs);
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
