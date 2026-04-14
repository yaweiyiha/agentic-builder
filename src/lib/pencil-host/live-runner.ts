import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { PencilMcpClient } from "@/lib/pencil-mcp";
import { runWithPencilMcpExclusive } from "@/lib/pencil-mcp-exclusive";
import {
  chatCompletion,
  estimateCost,
  resolveModel,
  type ChatMessage,
  type OpenRouterToolDefinition,
  type OpenRouterToolCall,
} from "@/lib/openrouter";
import { MODEL_CONFIG } from "@/lib/model-config";
import {
  createTrace,
  flushLangfuse,
  logGeneration,
} from "@/lib/observability/langfuse";
import type { AgentResult } from "@/lib/agents/shared/base-agent";

const MODEL = MODEL_CONFIG.pencilToolUse;

/** Tunable via env — defaults chosen to finish multi-screen PRDs without stopping too early. */
function envInt(
  name: string,
  defaultValue: number,
  min: number,
  max?: number,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return defaultValue;
  let v = Math.max(min, n);
  if (max !== undefined) v = Math.min(max, v);
  return v;
}

/** Max LLM turns (each may issue one or more tool calls). */
const MAX_TURNS = envInt("PENCIL_LIVE_MAX_TURNS", 56, 8, 200);
/** Per MCP guidance, keep batches ≤ ~25 ops; we default a bit below that. */
const MAX_BATCH_OP_LINES = envInt("PENCIL_LIVE_MAX_BATCH_LINES", 22, 4, 28);
/** End only after this many consecutive assistant replies with zero tool calls (recovers “forgot to call tool”). */
const MAX_CONSECUTIVE_NO_TOOL_ROUNDS = envInt(
  "PENCIL_LIVE_MAX_IDLE_ROUNDS",
  2,
  1,
  8,
);
/** Default kept moderate: OpenRouter reserves budget from max_tokens — high values fail on low credit. */
const LIVE_COMPLETION_MAX_TOKENS = envInt(
  "PENCIL_LIVE_COMPLETION_MAX_TOKENS",
  2048,
  256,
  32000,
);

export type PencilLiveEvent =
  | { type: "session_start"; message: string }
  | { type: "assistant_message"; message: string }
  | { type: "tool_call_start"; toolName: string; args: Record<string, unknown> }
  | {
      type: "tool_call_result";
      toolName: string;
      ok: boolean;
      result: string;
      artifactUrl?: string;
    }
  | { type: "session_complete"; message: string; artifactUrls: string[] }
  | { type: "session_error"; message: string };

interface PencilTranscriptEntry {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  ok: boolean;
}

interface RunPencilLiveInput {
  prdContent: string;
  designSpec: string;
  projectRoot: string;
  sessionId?: string;
  augmentMarkdown?: string;
  onEvent?: (event: PencilLiveEvent) => void;
}

function emit(onEvent: RunPencilLiveInput["onEvent"], event: PencilLiveEvent) {
  onEvent?.(event);
}

function truncate(text: string, limit = 4000): string {
  return text.length > limit ? `${text.slice(0, limit)}\n\n[truncated]` : text;
}

function buildContinueNudge(): string {
  return [
    "上一轮回复没有调用任何工具。",
    "若 PRD / Design Specification 里还有未画的主屏或未完成区域，请继续调用 batch_design（单次不超过 " +
      String(MAX_BATCH_OP_LINES) +
      " 行 DSL）、batch_get 或 get_editor_state。",
    "引用上一批之外的父节点时务必使用带引号的真实 node id。",
    "若确实已全部画完，请先 get_editor_state 或 batch_get 确认画布，再给出一句中文总结；否则请勿只输出文字而不调用工具。",
  ].join("\n");
}

function buildUserPrompt(
  prd: string,
  designSpec: string,
  augmentMarkdown?: string,
): string {
  const parts = [
    "使用可用的 Pencil 工具逐步完成设计稿绘制。",
    "",
    "要求：",
    `- 控制每批复杂度：单次 batch_design 不超过 ${String(MAX_BATCH_OP_LINES)} 行操作；多屏分多批完成。`,
    "- 每完成一个小步骤后，观察工具返回结果再继续。",
    "- 遇到语法或属性错误时，先修正再继续。",
    "- 优先完成主屏，再扩展次要屏。",
    "- 完成后给出简短中文总结。",
    "",
    "## PRD",
    truncate(prd, 24000),
    "",
    "## Design Specification",
    truncate(designSpec || "(none)", 14000),
  ];

  if (augmentMarkdown?.trim()) {
    parts.push(
      "",
      "## Structured pages / CMP components",
      truncate(augmentMarkdown, 12000),
    );
  }

  return parts.join("\n");
}

function buildSystemPrompt() {
  return [
    "你是一个直接操作 Pencil MCP 的资深 UI 设计代理。",
    "你必须通过工具完成绘制，而不是输出最终 batch script 文本。",
    "如果需要批量插入节点，请调用 batch_design，但每次只提交一个正确可执行的增量。",
    `单次 batch_design 最多 ${MAX_BATCH_OP_LINES} 行操作（多屏必须分多次调用）。`,
    "在 PRD/Design Spec 中的主屏尚未全部落地前，不要提前结束；不要仅用文字描述“已完成”。",
    "每次失败后，基于返回错误即时修正。",
    "绝对不要把自然语言句子传给 batch_design。",
    'batch_design 的 operations 必须是 Pencil DSL，每行一条操作，例如：screen=I(document,{type:"frame",layout:"vertical",width:1440,height:900,fill:"#0F172A",name:"Dashboard"})',
    "如果不确定 DSL 语法，先调用 get_guidelines，再生成下一批操作。",
    '跨多个 batch_design 调用时，之前 block 里的变量绑定会失效；复用父节点时请使用带引号的 node id，例如 I("9z9wK", {...})。',
    "不要使用 button 或 align 这类未经验证的属性/节点类型；按钮请用 rectangle + text 组合。",
    "优先使用深色 SaaS 风格，1440x900 画板。",
    "文本节点使用 content 字段，禁止 text 字段。",
    "不要更新 document，不要输出透明 fill 字符串。",
    "当所有主屏完成后，可以调用 get_screenshot 或 batch_get 检查结果。",
    "你可以在结束前调用 export_nodes，但即使不调用，宿主也会自动导出。",
  ].join("\n");
}

function buildTools(outputDir: string): OpenRouterToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "open_document",
        description: "Open a Pencil document. Use 'new' to create a new file.",
        parameters: {
          type: "object",
          properties: {
            filePathOrTemplate: { type: "string" },
          },
          required: ["filePathOrTemplate"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_editor_state",
        description: "Inspect the current Pencil editor state.",
        parameters: {
          type: "object",
          properties: {
            include_schema: { type: "boolean" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_guidelines",
        description:
          "Get Pencil design DSL guidance from the host. Preferred topics: batch_design, layout, text, icons, stroke.",
        parameters: {
          type: "object",
          properties: {
            topic: { type: "string" },
          },
          required: ["topic"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "batch_design",
        description: "Apply a small batch of Pencil design operations.",
        parameters: {
          type: "object",
          properties: {
            operations: { type: "string" },
          },
          required: ["operations"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "batch_get",
        description: "Read nodes from the current document.",
        parameters: {
          type: "object",
          properties: {
            nodeIds: { type: "array", items: { type: "string" } },
            readDepth: { type: "number" },
            searchDepth: { type: "number" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_screenshot",
        description:
          "Capture a screenshot of the current canvas or a target node.",
        parameters: {
          type: "object",
          properties: {
            nodeId: { type: "string" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "export_nodes",
        description: "Export current top-level nodes to PNG files.",
        parameters: {
          type: "object",
          properties: {
            filePath: {
              type: "string",
              default: path.join(outputDir, "design.pen"),
            },
            outputDir: { type: "string", default: outputDir },
            format: { type: "string", enum: ["png"], default: "png" },
          },
        },
      },
    },
  ];
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function looksLikeBatchDsl(operations: string): boolean {
  const lines = operations
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;
  return lines.every((line) =>
    /^(?:[A-Za-z_]\w*\s*=\s*)?[IUCDM]\s*\(/.test(line),
  );
}

function normalizeGuidelineTopic(topic: unknown): string {
  const raw = typeof topic === "string" ? topic.trim().toLowerCase() : "";
  if (["batch_design", "layout", "text", "icons", "stroke"].includes(raw)) {
    return raw;
  }
  return "batch_design";
}

function getLocalGuideline(topic: string): string {
  if (topic === "layout") {
    return [
      "Use frame nodes for containers.",
      'Use layout:"vertical" or layout:"horizontal" on frames.',
      'When a parent comes from a previous batch_design call, pass its node id as a quoted string, e.g. I("9z9wK", {...}).',
      "Bindings created inside one batch_design block do not survive into the next block.",
      "Avoid x/y for children inside flex layouts unless absolutely necessary.",
    ].join("\n");
  }
  if (topic === "text") {
    return [
      'Text nodes must use type:"text" and content:"...".',
      "Use fontFamily, fontSize, fill, name.",
      "Do not use align; rely on parent layout or spacer frames.",
    ].join("\n");
  }
  if (topic === "stroke") {
    return [
      "Stroke should be an object value if used.",
      "Prefer minimal properties that have already worked in previous calls.",
    ].join("\n");
  }
  if (topic === "icons") {
    return [
      "Prefer simple rectangle/ellipse/text placeholders instead of complex icon primitives.",
      "Keep icon blocks small and validate incrementally.",
    ].join("\n");
  }
  return [
    "batch_design expects Pencil DSL, not natural language.",
    "Each line should look like var=I(parent,{...}) or I(parent,{...}).",
    'For a new page: screen=I(document,{type:"frame",layout:"vertical",width:1440,height:900,fill:"#0F172A",name:"Dashboard"})',
    'When reusing a node from a previous batch, quote the node id string: I("9z9wK", {...}).',
    "Use only proven node types first: frame, rectangle, text.",
    "Do not use align or button unless runtime evidence proves they are supported.",
  ].join("\n");
}

function enrichToolError(toolName: string, message: string): string {
  if (toolName === "batch_design") {
    if (message.includes("Identifier directly after number")) {
      return `${message}\nHint: parent node ids from previous calls must be quoted strings, e.g. I("9z9wK",{...}).`;
    }
    if (message.includes("Unknown node type: button")) {
      return `${message}\nHint: button is unsupported here; compose buttons with rectangle + text inside the same batch_design block.`;
    }
    if (message.includes("/align unexpected property")) {
      return `${message}\nHint: remove the align property; center content via layout containers instead.`;
    }
  }
  return message;
}

function ensureSmallBatch(args: Record<string, unknown>) {
  if (typeof args.operations !== "string") return;
  const lines = args.operations
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > MAX_BATCH_OP_LINES) {
    console.warn(
      `[PencilLive] batch_design truncated: ${lines.length} → ${MAX_BATCH_OP_LINES} lines (cap PENCIL_LIVE_MAX_BATCH_LINES)`,
    );
    args.operations = lines.slice(0, MAX_BATCH_OP_LINES).join("\n");
  }
}

async function getTopLevelNodeIds(mcp: PencilMcpClient): Promise<string[]> {
  const raw = await mcp.batchGet({ readDepth: 0 });
  const idPattern = /"id"\s*:\s*"([^"]+)"/g;
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = idPattern.exec(raw)) !== null) {
    ids.push(match[1]);
  }
  return [...new Set(ids)].slice(0, 32);
}

function transcriptMarkdown(
  transcript: PencilTranscriptEntry[],
  summary: string,
  artifacts: string[],
) {
  const lines = [
    "# PencilDesign",
    "",
    summary || "Pencil live session completed.",
    "",
  ];
  if (artifacts.length > 0) {
    lines.push("## Artifacts", ...artifacts.map((item) => `- ${item}`), "");
  }
  lines.push("## Tool Transcript", "");
  transcript.forEach((entry, index) => {
    lines.push(`### ${index + 1}. ${entry.toolName}`, "");
    lines.push("Arguments:");
    lines.push("```json", JSON.stringify(entry.args, null, 2), "```", "");
    lines.push(entry.ok ? "Result:" : "Error:");
    lines.push("```text", truncate(entry.result, 4000), "```", "");
  });
  return lines.join("\n");
}

async function executeTool(
  mcp: PencilMcpClient,
  toolCall: OpenRouterToolCall,
  outputDir: string,
  onEvent?: (event: PencilLiveEvent) => void,
): Promise<PencilTranscriptEntry> {
  const args = safeParseArgs(toolCall.function.arguments);
  const name = toolCall.function.name;
  if (name === "batch_design") ensureSmallBatch(args);
  emit(onEvent, { type: "tool_call_start", toolName: name, args });

  try {
    let result = "";
    let artifactUrl: string | undefined;

    if (name === "open_document") {
      result = await mcp.openDocument(
        typeof args.filePathOrTemplate === "string"
          ? args.filePathOrTemplate
          : typeof args.filePathOrNew === "string"
            ? (args.filePathOrNew as string)
            : "new",
      );
    } else if (name === "get_editor_state") {
      result = await mcp.getEditorState(Boolean(args.include_schema));
    } else if (name === "get_guidelines") {
      result = getLocalGuideline(normalizeGuidelineTopic(args.topic));
    } else if (name === "batch_design") {
      const operations =
        typeof args.operations === "string" ? args.operations.trim() : "";
      if (!looksLikeBatchDsl(operations)) {
        throw new Error(
          'batch_design requires Pencil DSL operations like screen=I(document,{type:"frame",width:1440,height:900,name:"Dashboard"})',
        );
      }
      result = await mcp.batchDesign(operations);
    } else if (name === "batch_get") {
      result = await mcp.batchGet({
        nodeIds: Array.isArray(args.nodeIds)
          ? args.nodeIds.filter(
              (item): item is string => typeof item === "string",
            )
          : undefined,
        readDepth:
          typeof args.readDepth === "number" ? args.readDepth : undefined,
        searchDepth:
          typeof args.searchDepth === "number" ? args.searchDepth : undefined,
      });
    } else if (name === "get_screenshot") {
      result = await mcp.getScreenshot(
        typeof args.nodeId === "string" ? args.nodeId : undefined,
      );
    } else if (name === "export_nodes") {
      const nodeIds = await getTopLevelNodeIds(mcp);
      const filePath =
        typeof args.filePath === "string"
          ? args.filePath
          : path.join(outputDir, "design.pen");
      const exportDir =
        typeof args.outputDir === "string" ? args.outputDir : outputDir;
      result = await mcp.exportNodes({
        filePath,
        nodeIds,
        outputDir: exportDir,
        format: "png",
      });
      artifactUrl = exportDir;
    } else {
      throw new Error(`Unsupported tool: ${name}`);
    }

    emit(onEvent, {
      type: "tool_call_result",
      toolName: name,
      ok: true,
      result: truncate(result, 1500),
      artifactUrl,
    });

    return { toolName: name, args, result, ok: true };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = enrichToolError(name, rawMessage);
    emit(onEvent, {
      type: "tool_call_result",
      toolName: name,
      ok: false,
      result: message,
    });
    return { toolName: name, args, result: message, ok: false };
  }
}

export async function runPencilLiveSession(
  input: RunPencilLiveInput,
): Promise<AgentResult> {
  const traceId = uuidv4();
  const startedAt = Date.now();
  const model = resolveModel(MODEL);
  const outputDir = path.join(input.projectRoot, "public", "design");
  const transcript: PencilTranscriptEntry[] = [];
  const artifactUrls: string[] = [];
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content: buildUserPrompt(
        input.prdContent,
        input.designSpec,
        input.augmentMarkdown,
      ),
    },
  ];
  const tools = buildTools(outputDir);
  const mcp = PencilMcpClient.getInstance();
  let totalUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  let totalCostUsd = 0;
  let finalSummary = "";

  await fs.mkdir(outputDir, { recursive: true });

  createTrace({
    traceId,
    sessionId: input.sessionId,
    agentName: "Pencil Live Agent",
    pipelineStep: "step-pencil-live",
    model,
  });

  emit(input.onEvent, {
    type: "session_start",
    message: "Pencil live session started",
  });
  console.log("[PencilLive] config", {
    MAX_TURNS,
    MAX_BATCH_OP_LINES,
    MAX_CONSECUTIVE_NO_TOOL_ROUNDS,
    LIVE_COMPLETION_MAX_TOKENS,
  });

  await runWithPencilMcpExclusive(async () => {
    await mcp.connect();
    try {
      await mcp.openDocument("new");
      let consecutiveNoToolRounds = 0;
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const response = await chatCompletion(messages, {
          model,
          temperature: 0.3,
          max_tokens: LIVE_COMPLETION_MAX_TOKENS,
          tools,
          tool_choice: "auto",
        });
        const assistant = response.choices[0]?.message;
        const assistantContent = assistant?.content?.trim() ?? "";
        const toolCalls = assistant?.tool_calls ?? [];

        totalUsage = {
          promptTokens: totalUsage.promptTokens + response.usage.prompt_tokens,
          completionTokens:
            totalUsage.completionTokens + response.usage.completion_tokens,
          totalTokens: totalUsage.totalTokens + response.usage.total_tokens,
        };
        totalCostUsd += estimateCost(response.model, response.usage);

        logGeneration({
          traceId,
          name: `PencilLiveAgent::turn_${turn + 1}`,
          model: response.model,
          input: messages,
          output: {
            content: assistantContent,
            toolCalls,
          },
          usage: {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          },
          costUsd: estimateCost(response.model, response.usage),
          durationMs: Date.now() - startedAt,
        });

        messages.push({
          role: "assistant",
          content: assistantContent,
          tool_calls: toolCalls,
        });

        if (assistantContent) {
          emit(input.onEvent, {
            type: "assistant_message",
            message: assistantContent,
          });
          finalSummary = assistantContent;
        }

        if (toolCalls.length === 0) {
          consecutiveNoToolRounds += 1;
          if (consecutiveNoToolRounds >= MAX_CONSECUTIVE_NO_TOOL_ROUNDS) {
            console.warn(
              `[PencilLive] Stopping after ${String(consecutiveNoToolRounds)} consecutive assistant turn(s) with no tool calls (max idle rounds=${String(MAX_CONSECUTIVE_NO_TOOL_ROUNDS)}).`,
            );
            break;
          }
          const nudge = buildContinueNudge();
          messages.push({ role: "user", content: nudge });
          console.warn(
            `[PencilLive] Idle round ${String(consecutiveNoToolRounds)}/${String(MAX_CONSECUTIVE_NO_TOOL_ROUNDS)} — injecting continue nudge`,
          );
          continue;
        }

        consecutiveNoToolRounds = 0;

        for (const toolCall of toolCalls) {
          const entry = await executeTool(
            mcp,
            toolCall,
            outputDir,
            input.onEvent,
          );
          transcript.push(entry);
          messages.push({
            role: "tool",
            content: entry.ok
              ? truncate(entry.result, 6000)
              : `ERROR: ${entry.result}`,
            tool_call_id: toolCall.id,
            name: entry.toolName,
          });
        }
      }

      const nodeIds = await getTopLevelNodeIds(mcp);
      if (nodeIds.length > 0) {
        const exportResult = await mcp.exportNodes({
          filePath: path.join(outputDir, "design.pen"),
          nodeIds,
          outputDir,
          format: "png",
        });
        transcript.push({
          toolName: "export_nodes",
          args: {
            filePath: path.join(outputDir, "design.pen"),
            nodeIds,
            outputDir,
            format: "png",
          },
          result: exportResult,
          ok: true,
        });
        artifactUrls.push(outputDir);
        emit(input.onEvent, {
          type: "tool_call_result",
          toolName: "export_nodes",
          ok: true,
          result: truncate(exportResult, 1000),
          artifactUrl: outputDir,
        });
      }
    } finally {
      await mcp.disconnect();
    }
  });

  const markdown = transcriptMarkdown(transcript, finalSummary, artifactUrls);
  await fs.writeFile(
    path.join(outputDir, "PencilDesign.md"),
    markdown,
    "utf-8",
  );
  await fs.writeFile(
    path.join(outputDir, "PENCIL_DESIGN.md"),
    markdown,
    "utf-8",
  );

  await flushLangfuse();

  emit(input.onEvent, {
    type: "session_complete",
    message: finalSummary || "Pencil live session finished",
    artifactUrls,
  });

  return {
    content: markdown,
    model,
    usage: totalUsage,
    costUsd: totalCostUsd,
    durationMs: Date.now() - startedAt,
    traceId,
  };
}
