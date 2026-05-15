/**
 * Semantic conversation compactor for long verify/fix loops.
 */
import {
  chatCompletionWithFallback,
  type ChatMessage,
} from "@/lib/openrouter";

interface CompactInput {
  messages: ChatMessage[];
  modelChain: string[];
  label: string;
  stateSummary?: string;
  thresholdChars?: number;
  keepTail?: number;
  force?: boolean;
}

export interface CompactResult {
  compacted: boolean;
  removedMessages: number;
  estimatedTokensBefore: number;
  orphanToolsRemoved: number;
}

function messageText(message: ChatMessage): string {
  const content = typeof message.content === "string" ? message.content : "";
  const toolCalls = (message.tool_calls ?? [])
    .map((call) => `[tool_call:${call.function.name}] ${call.function.arguments}`)
    .join("\n");
  const toolName = message.name ? `[tool:${message.name}]` : "";
  return [`role=${message.role}`, toolName, content, toolCalls]
    .filter(Boolean)
    .join("\n")
    .slice(0, 3000);
}

function buildDeterministicSummary(
  middle: ChatMessage[],
  stateSummary?: string,
): string {
  const actionLines: string[] = [];
  for (const message of middle) {
    if (message.role === "tool") {
      actionLines.push(`[tool result] ${String(message.content ?? "").slice(0, 240)}`);
    } else if (message.role === "assistant") {
      const calls = (message.tool_calls ?? [])
        .map((call) => call.function.name)
        .join(", ");
      if (calls) actionLines.push(`[assistant called] ${calls}`);
    }
  }
  return [
    `[Context compacted — ${middle.length} messages omitted]`,
    stateSummary ? `Validation state:\n${stateSummary}` : "",
    `Previous actions summary:\n${actionLines.slice(-40).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function summarizeMiddle(
  middle: ChatMessage[],
  modelChain: string[],
  stateSummary?: string,
): Promise<string> {
  const transcript = middle.map(messageText).join("\n\n---\n\n").slice(-32_000);
  const response = await chatCompletionWithFallback(
    [
      {
        role: "system",
        content: [
          "Summarize a long verify/fix agent conversation for continuation.",
          "Keep only actionable state. Do not invent facts.",
          "Output concise markdown with these sections: Unresolved issues, Files changed or inspected, Failed validations/tests, Decisions already made, Next repair actions.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          stateSummary ? `Current validation state:\n${stateSummary}` : "",
          "Conversation segment to compact:",
          transcript,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    modelChain,
    { temperature: 0.1, max_tokens: 3000 },
  );
  const content = response.choices[0]?.message.content?.trim();
  return content || buildDeterministicSummary(middle, stateSummary);
}

function calculateSafeTailStart(messages: ChatMessage[], desiredStart: number): number {
  let safeStart = desiredStart;
  const findAssistantIndexForTool = (
    toolIdx: number,
    toolCallId: string,
  ): number => {
    if (!toolCallId) return -1;
    for (let i = toolIdx - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg || msg.role !== "assistant") continue;
      const hasMatch = (msg.tool_calls ?? []).some(
        (toolCall) => toolCall.id === toolCallId,
      );
      if (hasMatch) return i;
    }
    return -1;
  };

  for (let i = desiredStart; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || msg.role !== "tool") continue;
    const assistantIdx = findAssistantIndexForTool(i, msg.tool_call_id ?? "");
    if (assistantIdx >= 0) safeStart = Math.min(safeStart, assistantIdx);
  }

  return Math.max(1, Math.min(safeStart, messages.length - 1));
}

function countRemovedOrphanToolMessages(messages: ChatMessage[]): number {
  const assistantToolIds = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const call of message.tool_calls ?? []) assistantToolIds.add(call.id);
  }
  let removed = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "tool") continue;
    if (message.tool_call_id && assistantToolIds.has(message.tool_call_id)) continue;
    messages.splice(i, 1);
    removed += 1;
  }
  return removed;
}

export async function compactChatMessagesSemantically(
  input: CompactInput,
): Promise<CompactResult> {
  const thresholdChars = input.thresholdChars ?? 20_000 * 4;
  const keepTail = input.keepTail ?? 6;
  const totalChars = input.messages.reduce(
    (sum, message) =>
      sum + (typeof message.content === "string" ? message.content.length : 0),
    0,
  );
  if (!input.force && totalChars < thresholdChars) {
    return {
      compacted: false,
      removedMessages: 0,
      estimatedTokensBefore: Math.round(totalChars / 4),
      orphanToolsRemoved: 0,
    };
  }

  const systemMsg = input.messages[0];
  const desiredStart = Math.max(1, input.messages.length - keepTail);
  const tailStart = calculateSafeTailStart(input.messages, desiredStart);
  const tail = input.messages.slice(tailStart);
  const middle = input.messages.slice(1, tailStart);
  if (!systemMsg || middle.length === 0) {
    return {
      compacted: false,
      removedMessages: 0,
      estimatedTokensBefore: Math.round(totalChars / 4),
      orphanToolsRemoved: 0,
    };
  }

  let summary: string;
  try {
    summary = await summarizeMiddle(middle, input.modelChain, input.stateSummary);
  } catch (error) {
    console.warn(
      `${input.label}: semantic compaction failed, using deterministic summary: ${error instanceof Error ? error.message : String(error)}`,
    );
    summary = buildDeterministicSummary(middle, input.stateSummary);
  }

  input.messages.splice(
    0,
    input.messages.length,
    systemMsg,
    { role: "assistant", content: `[Semantic context compacted]\n${summary}` },
    ...tail,
  );
  const orphanToolsRemoved = countRemovedOrphanToolMessages(input.messages);
  return {
    compacted: true,
    removedMessages: middle.length,
    estimatedTokensBefore: Math.round(totalChars / 4),
    orphanToolsRemoved,
  };
}
