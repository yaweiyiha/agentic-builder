import { BaseAgent } from "../shared/base-agent";
import { MODEL_CONFIG, resolveModelChain } from "@/lib/model-config";
import { chatCompletionWithFallback, resolveModel } from "@/lib/openrouter";
import type { ResourceCategory, ResourceRequirement } from "@/lib/pipeline/resource-requirements";

/**
 * Resource Requirement Detector
 *
 * Reads a PRD (and optional supporting documents) and emits a list of
 * external resources / credentials the runtime app will need so the user
 * can supply them once at kickoff time.
 *
 * Examples it should surface:
 *   - Stripe / payment gateways (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET)
 *   - Email senders (SENDGRID_API_KEY, RESEND_API_KEY, SMTP_*)
 *   - OAuth providers (GOOGLE_CLIENT_ID/SECRET, GITHUB_CLIENT_ID/SECRET)
 *   - Object storage (AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
 *   - LLM / AI APIs (OPENAI_API_KEY, ANTHROPIC_API_KEY)
 *   - Maps / geocoding, analytics, push notifications, SMS, etc.
 *
 * It must NEVER emit:
 *   - DATABASE_URL, JWT_SECRET, JWT_EXPIRES_IN, NODE_ENV, PORT — these are
 *     managed by the scaffold itself and would collide.
 */

const RESERVED_KEYS = new Set([
  "DATABASE_URL",
  "JWT_SECRET",
  "JWT_EXPIRES_IN",
  "NODE_ENV",
  "PORT",
  "HOST",
]);

const SYSTEM_PROMPT = `You are a Resource Requirements Analyst. Your job is to read a Product Requirements Document (PRD) and list every EXTERNAL service / credential / API key the application will need at runtime so the user can provision them once before code generation.

## Output format (STRICT)
Return a single JSON array. Each element MUST have this exact shape:

{
  "envKey": "STRIPE_SECRET_KEY",
  "label": "Stripe Secret Key",
  "description": "Server-side key used to create payment intents and refunds for the checkout flow.",
  "category": "payment",
  "required": true,
  "example": "sk_test_...",
  "docsUrl": "https://dashboard.stripe.com/apikeys"
}

### Field rules
- **envKey**: UPPER_SNAKE_CASE only. The actual env var name a backend service would read. Use the canonical name for that vendor (e.g. STRIPE_SECRET_KEY, not PAYMENT_KEY).
- **label**: Human-readable, ≤ 60 chars.
- **description**: One concrete sentence explaining what feature in THIS PRD needs it (cite the feature, not generic copy).
- **category**: One of: "auth" | "payment" | "email" | "storage" | "ai" | "analytics" | "messaging" | "maps" | "other".
- **required**: true if the corresponding feature in the PRD is core (P0/MVP) and the app cannot function without it; false if the feature is optional / nice-to-have.
- **example**: A short format hint (≤ 40 chars) shown as input placeholder. Optional but strongly preferred.
- **docsUrl**: Public URL where the user can obtain the key. Omit if you are not certain.

## What to INCLUDE
- Third-party API keys for any service the PRD names or implies (payments, email, AI, maps, analytics, storage, push notifications, SMS).
- OAuth client credentials when the PRD mentions "Sign in with Google/GitHub/Apple/etc."
- Webhook signing secrets when the PRD describes inbound webhooks (Stripe events, GitHub events, etc.). List them as separate entries.
- Public client IDs that ship to the frontend MUST use the appropriate prefix:
  * For Vite frontends: \`VITE_*\` (e.g. VITE_STRIPE_PUBLISHABLE_KEY, VITE_GOOGLE_CLIENT_ID)
  * For Next.js frontends: \`NEXT_PUBLIC_*\`
  * Default to VITE_ prefix when unsure (most generated projects are Vite).
  Add a separate entry for the server-side counterpart when one exists (e.g. STRIPE_SECRET_KEY).

## What to EXCLUDE (NEVER emit these)
- DATABASE_URL, JWT_SECRET, JWT_EXPIRES_IN, NODE_ENV, PORT, HOST — the scaffold owns these.
- Anything purely internal (feature flags, log levels) that doesn't require the user to obtain a credential from elsewhere.
- Speculative integrations the PRD does not actually mention.

## Quality rules
- Deduplicate aggressively — one envKey appears at most once.
- Be conservative: if the PRD doesn't mention a third-party integration, don't invent one.
- If the PRD mentions a feature that COULD be implemented without an external service (e.g. "send notification" → could be in-app), do NOT add an external credential unless the PRD explicitly names a vendor.
- If NO external resources are needed, return \`[]\` (empty array). This is a valid and common answer for self-contained apps.
- Output ONLY the JSON array. No prose, no markdown fence, no explanations.`;

export interface DetectResourcesInput {
  prd: string;
  trd?: string;
  sysDesign?: string;
  implGuide?: string;
}

export class ResourceDetectorAgent extends BaseAgent {
  constructor() {
    const modelChain = resolveModelChain(
      MODEL_CONFIG.taskBreakdown,
      resolveModel,
    );
    super({
      name: "Resource Requirements Detector",
      role: "Integrations Analyst",
      systemPrompt: SYSTEM_PROMPT,
      defaultModel: MODEL_CONFIG.taskBreakdown,
      temperature: 0.1,
      maxTokens: 4096,
      customChatCompletion: async (messages, opts) => {
        const { model: _ignoredModel, ...rest } = opts;
        return chatCompletionWithFallback(messages, modelChain, rest);
      },
    });
  }

  async detect(
    input: DetectResourcesInput,
    sessionId?: string,
  ): Promise<{
    requirements: ResourceRequirement[];
    raw: string;
    parseError?: string;
    model: string;
    costUsd: number;
    durationMs: number;
  }> {
    const sections: string[] = [];
    sections.push("## PRD\n\n" + input.prd);
    if (input.trd) sections.push("## TRD\n\n" + input.trd);
    if (input.sysDesign) sections.push("## System Design\n\n" + input.sysDesign);
    if (input.implGuide) sections.push("## Implementation Guide\n\n" + input.implGuide);

    const userMessage =
      "Read the documents below and emit the required JSON array of external resource credentials. Remember: empty array `[]` is valid when nothing third-party is needed.\n\n" +
      sections.join("\n\n---\n\n");

    const result = await this.run(
      userMessage,
      undefined,
      "step-resource-detection",
      sessionId,
    );

    const parsed = parseRequirementsJson(result.content);
    return {
      requirements: parsed.items,
      raw: result.content,
      parseError: parsed.error,
      model: result.model,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
    };
  }
}

function parseRequirementsJson(raw: string): {
  items: ResourceRequirement[];
  error?: string;
} {
  const trimmed = stripCodeFence(raw.trim());
  if (!trimmed) return { items: [], error: "empty model output" };
  try {
    const json = JSON.parse(trimmed);
    if (!Array.isArray(json)) {
      return { items: [], error: "top-level value is not an array" };
    }
    const items = json
      .map((x) => normalize(x))
      .filter((x): x is ResourceRequirement => x !== null)
      .filter((x) => !RESERVED_KEYS.has(x.envKey));

    const seen = new Set<string>();
    const deduped: ResourceRequirement[] = [];
    for (const item of items) {
      if (seen.has(item.envKey)) continue;
      seen.add(item.envKey);
      deduped.push(item);
    }
    return { items: deduped };
  } catch (e) {
    return {
      items: [],
      error: e instanceof Error ? e.message : "JSON parse failed",
    };
  }
}

function stripCodeFence(s: string): string {
  if (s.startsWith("```")) {
    const lines = s.split("\n");
    if (lines[0]?.startsWith("```")) lines.shift();
    if (lines[lines.length - 1]?.trim() === "```") lines.pop();
    return lines.join("\n").trim();
  }
  return s;
}

function normalize(raw: unknown): ResourceRequirement | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const envKey = typeof o.envKey === "string" ? o.envKey.trim() : "";
  const label = typeof o.label === "string" ? o.label.trim() : "";
  const description =
    typeof o.description === "string" ? o.description.trim() : "";
  const categoryRaw =
    typeof o.category === "string" ? o.category.trim().toLowerCase() : "other";
  const category = isResourceCategory(categoryRaw) ? categoryRaw : "other";
  const required = o.required !== false;
  const example =
    typeof o.example === "string" && o.example.trim() ? o.example.trim() : undefined;
  const docsUrl =
    typeof o.docsUrl === "string" && o.docsUrl.trim() ? o.docsUrl.trim() : undefined;

  if (!envKey || !label || !description) return null;

  return {
    envKey: envKey.toUpperCase().replace(/[^A-Z0-9_]/g, "_"),
    label,
    description,
    category,
    required,
    example,
    docsUrl,
    value: "",
  };
}

function isResourceCategory(s: string): s is ResourceCategory {
  return [
    "auth",
    "payment",
    "email",
    "storage",
    "ai",
    "analytics",
    "messaging",
    "maps",
    "other",
  ].includes(s);
}
