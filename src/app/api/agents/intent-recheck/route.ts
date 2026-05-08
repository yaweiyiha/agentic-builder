import { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";
import { streamChatCompletion, resolveModel } from "@/lib/openrouter";
import { MODEL_CONFIG } from "@/lib/model-config";

async function readImportedPrd(): Promise<string | null> {
  try {
    const filePath = path.resolve(process.cwd(), ".blueprint", "PRD.md");
    const content = await fs.readFile(filePath, "utf-8");
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/agents/intent-recheck
 *
 * Lightweight re-run of intent analysis after the user has submitted answers.
 * Accumulates the full conversation (original brief + all Q&A rounds) and
 * checks whether any of the 5 required items are still missing or ambiguous.
 *
 * Returns the same JSON shape as the initial intent analysis:
 * { project_name, summary, gathered, questions }
 */

const INTENT_RECHECK_SYSTEM_PROMPT = `You are a senior product analyst in a multi-turn clarification loop. Your goal is to ensure all 6 required items are fully understood before engineering begins.

## Required items (same as before)
  A. need_backend   — Whether a real backend is needed, or mock/static data is sufficient. This determines whether TRD and backend code will be generated. Ask this FIRST before all other items.
  B. core_goal      — The specific problem or need this product solves.
  C. target_users   — Who the primary users are.
  D. pain_points    — Frustrations, inefficiencies, or gaps this product eliminates.
  E. mobile_support — Deployment target: web-only / mobile-responsive / native mobile / both.
  F. auth_method    — How users authenticate (or no login needed).

## Your task
You will receive the original project brief and the full Q&A conversation so far.
1. Re-evaluate ALL 6 items considering every piece of information provided (brief + all answers).
2. Mark each item as KNOWN or MISSING/AMBIGUOUS.
3. For any item still MISSING or where the answer was vague/contradictory, generate a follow-up question.
4. IMPORTANT: Always ask about \`need_backend\` first if it is not yet known — its answer affects the entire downstream pipeline (TRD generation, backend scaffolding).
5. If ALL 6 items are clearly covered, return an empty questions array and set \`all_clear: true\`.

## Question format (same types as before)
- radio   → exactly one answer (best for A: need_backend, E: mobile_support)
- checkbox → one or more answers (best for F: auth_method providers)
- text    → free-form (best for B, C, D when still unclear)

For A: use radio with options ["Yes, need a real backend (API + database)", "No, mock data is sufficient (frontend only)"].
For E: use radio with options ["Web only", "Mobile-responsive web", "Native mobile app", "Both web and native"].
For F: use checkbox with options ["Email / Password", "Google", "GitHub", "Apple", "WeChat", "No login needed"].

## Output format (STRICT — return ONLY valid JSON, no prose outside the object)

{
  "project_name": "Short, memorable product name (2–5 words, title case)",
  "all_clear": true | false,
  "summary": "1–2 sentences summarising what is now understood.",
  "gathered": [
    "A: <confirmed extraction>",
    ...only items that are now KNOWN
  ],
  "questions": [
    {
      "id": "need_backend" | "core_goal" | "target_users" | "pain_points" | "mobile_support" | "auth_method",
      "type": "radio" | "checkbox" | "text",
      "label": "Concise follow-up question (≤ 15 words)",
      "options": ["..."]   // omit for type "text"
    },
    ...only items still MISSING or ambiguous — max 6 total, need_backend always first if missing
  ]
}

Rules:
- project_name should incorporate any new information from the answers (refine if needed).
- Be strict: if an answer was vague or incomplete, keep that item as a question.
- Be lenient: if the answer is reasonable and actionable, mark it as KNOWN.
- Output ONLY the JSON object — no markdown fences, no explanation.`;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      brief?: string;
      conversationHistory?: { role: "user" | "assistant"; content: string }[];
    };

    const brief = (body.brief ?? "").trim();
    const conversationHistory = body.conversationHistory ?? [];

    if (!brief) {
      return new Response(JSON.stringify({ error: "brief is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Read the imported PRD (e.g. uploaded PDF converted to text) if present.
    const importedPrdContent = await readImportedPrd();

    // Build the user-turn content: prepend the imported PRD so the LLM has full context.
    const userTurnParts: string[] = [];
    if (importedPrdContent) {
      userTurnParts.push(
        `Imported PRD document (user-provided — treat as the primary source of truth):\n\`\`\`\n${importedPrdContent}\n\`\`\`\n`,
      );
    }
    userTurnParts.push(`Original project brief:\n${brief}`);
    if (conversationHistory.length > 0) {
      userTurnParts.push(
        `\nClarification conversation so far:\n${conversationHistory
          .map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
          .join("\n\n")}`,
      );
    } else {
      userTurnParts.push("(No answers yet — this is the initial check)");
    }

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: INTENT_RECHECK_SYSTEM_PROMPT },
      { role: "user", content: userTurnParts.join("\n\n") },
    ];

    const model = resolveModel(MODEL_CONFIG.intent);
    const llmStream = await streamChatCompletion(messages, {
      model,
      temperature: 0.3,
      max_tokens: 800,
    });

    const encoder = new TextEncoder();

    // Emit pipeline-style SSE events so the client can reuse the same
    // handleEvent / streaming-display logic as the main pipeline.
    function send(event: Record<string, unknown>): Uint8Array {
      return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
    }

    const readable = new ReadableStream({
      async start(controller) {
        // ── step_start ──
        controller.enqueue(send({ type: "step_start", stepId: "intent", data: { status: "running" } }));

        const reader = llmStream.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        let lineBuffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            lineBuffer += decoder.decode(value, { stream: true });
            const parts = lineBuffer.split("\n");
            lineBuffer = parts.pop() ?? "";
            for (const line of parts) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (payload === "[DONE]") continue;
              try {
                const parsed = JSON.parse(payload) as {
                  choices?: { delta?: { content?: string } }[];
                };
                const token = parsed.choices?.[0]?.delta?.content ?? "";
                if (token) accumulated += token;
              } catch {
                // ignore malformed upstream SSE lines
              }
            }
          }

          // ── step_complete — parse accumulated JSON and stream summary word-by-word ──
          const jsonMatch = accumulated.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]) as {
                summary?: string;
                project_name?: string;
                all_clear?: boolean;
                gathered?: string[];
                questions?: unknown[];
              };
              // Stream the summary text word by word so the client shows a typing effect
              if (parsed.summary) {
                const words = parsed.summary.split(" ");
                for (let i = 0; i < words.length; i++) {
                  const chunk = (i === 0 ? "" : " ") + words[i];
                  controller.enqueue(send({
                    type: "step_stream",
                    stepId: "intent",
                    data: { chunk, chunkType: "content" },
                  }));
                }
              }
              controller.enqueue(send({
                type: "step_complete",
                stepId: "intent",
                data: {
                  stepId: "intent",
                  status: "completed",
                  content: JSON.stringify(parsed),
                  timestamp: new Date().toISOString(),
                },
              }));
            } catch {
              controller.enqueue(send({
                type: "step_error",
                stepId: "intent",
                data: { error: "Failed to parse intent JSON", status: "failed" },
              }));
            }
          } else {
            controller.enqueue(send({
              type: "step_error",
              stepId: "intent",
              data: { error: "No JSON found in model response", status: "failed" },
            }));
          }
        } catch (err) {
          controller.enqueue(send({
            type: "step_error",
            stepId: "intent",
            data: { error: err instanceof Error ? err.message : "stream error", status: "failed" },
          }));
        } finally {
          reader.releaseLock();
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
