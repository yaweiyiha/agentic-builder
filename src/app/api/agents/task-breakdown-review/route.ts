import { NextRequest } from "next/server";
import { MODEL_CONFIG, resolveModelChain } from "@/lib/model-config";
import {
  chatCompletionWithFallback,
  estimateCost,
  resolveModel,
  type ChatMessage,
} from "@/lib/openrouter";
import type { KickoffWorkItem } from "@/lib/pipeline/types";

type SuggestionSeverity = "high" | "medium" | "low";

interface TaskBreakdownSuggestion {
  id: string;
  title: string;
  reason: string;
  instruction: string;
  severity: SuggestionSeverity;
}

function parseSuggestions(raw: string): TaskBreakdownSuggestion[] {
  const block = raw.match(/\[[\s\S]*\]/)?.[0];
  if (!block) return [];
  try {
    const parsed = JSON.parse(block) as unknown[];
    return parsed
      .map((item, i) => {
        const o = (item ?? {}) as Record<string, unknown>;
        const severityRaw = String(o.severity ?? "medium").toLowerCase();
        const severity: SuggestionSeverity =
          severityRaw === "high" || severityRaw === "low"
            ? severityRaw
            : "medium";
        const title = String(o.title ?? "").trim();
        const reason = String(o.reason ?? "").trim();
        const instruction = String(o.instruction ?? "").trim();
        if (!title || !reason || !instruction) return null;
        return {
          id: String(o.id ?? `S-${i + 1}`),
          title,
          reason,
          instruction,
          severity,
        };
      })
      .filter((v): v is TaskBreakdownSuggestion => v !== null);
  } catch {
    return [];
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    prd,
    trd,
    sysdesign,
    implguide,
    design,
    taskBreakdown,
    tier,
  } = body as {
    prd?: string;
    trd?: string;
    sysdesign?: string;
    implguide?: string;
    design?: string;
    taskBreakdown?: KickoffWorkItem[];
    tier?: string;
  };

  if (!prd || !Array.isArray(taskBreakdown) || taskBreakdown.length === 0) {
    return Response.json(
      { error: "prd and non-empty taskBreakdown are required" },
      { status: 400 },
    );
  }

  const modelChain = resolveModelChain(
    MODEL_CONFIG.taskBreakdownReview ?? MODEL_CONFIG.taskBreakdown,
    resolveModel,
  );

  const docs = [
    "## PRD",
    prd,
    trd?.trim() ? `## TRD\n${trd}` : "",
    sysdesign?.trim() ? `## System Design\n${sysdesign}` : "",
    implguide?.trim() ? `## Implementation Guide\n${implguide}` : "",
    design?.trim() ? `## Design Spec\n${design}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are a senior software architect reviewing a coding task breakdown.",
        "Your job is to identify concrete, high-value improvements before coding starts.",
        "Focus on: missing critical tasks, incorrect dependencies, requirement ID mismatches, route/registration closure, backend/frontend contract gaps, and over/under-splitting.",
        "Return 0-8 suggestions as JSON array.",
        "Each item must include: id, title, reason, instruction, severity (high|medium|low).",
        "The instruction must be actionable and suitable to feed back into task-breakdown regeneration.",
        "Output ONLY a JSON array.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Project tier: ${tier ?? "M"}`,
        "",
        docs.slice(0, 12000),
        "",
        `## Current task breakdown\n${JSON.stringify(taskBreakdown, null, 2).slice(0, 28000)}`,
      ].join("\n"),
    },
  ];

  try {
    const start = Date.now();
    const response = await chatCompletionWithFallback(messages, modelChain, {
      temperature: 0.1,
      max_tokens: 8192,
    });
    const durationMs = Date.now() - start;
    const content = response.choices[0]?.message?.content ?? "";
    const suggestions = parseSuggestions(content);

    return Response.json({
      ok: true,
      suggestions,
      rawOutput: content,
      model: response.model,
      costUsd: estimateCost(response.model, response.usage),
      durationMs,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "review failed";
    return Response.json({ error: msg }, { status: 500 });
  }
}

