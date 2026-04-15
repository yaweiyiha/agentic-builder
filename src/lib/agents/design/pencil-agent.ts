import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs/promises";
import { PencilMcpClient } from "@/lib/pencil-mcp";
import { runWithPencilMcpExclusive } from "@/lib/pencil-mcp-exclusive";
import { chatCompletion, estimateCost, resolveModel } from "@/lib/openrouter";
import { MODEL_CONFIG } from "@/lib/model-config";
import type { ChatMessage } from "@/lib/llm-types";
import {
  createTrace,
  logGeneration,
  flushLangfuse,
} from "@/lib/observability/langfuse";
import type { AgentResult } from "../shared/base-agent";

const MODEL = MODEL_CONFIG.pencil;

const PAUSE_BETWEEN_MS = Number(process.env.PENCIL_BATCH_PAUSE_MS ?? 500);

// ── Structured design types ──

interface DesignOperation {
  op: "I" | "U" | "C" | "D" | "M";
  /** Binding variable name (I, C) */
  var?: string;
  /** Parent node reference (I, C, M) */
  parent?: string;
  /** Target node reference (U, D, M) */
  target?: string;
  /** Source node reference (C) */
  source?: string;
  /** Insertion index (M) */
  index?: number;
  /** Node properties */
  props?: Record<string, unknown>;
}

interface DesignBlock {
  screenName: string;
  operations: DesignOperation[];
}

interface DesignOutput {
  blocks: DesignBlock[];
}

// ── Serialization: structured ops → batch_design script ──

function serializeValue(v: unknown): string {
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(serializeValue).join(",")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).map(
      ([k, val]) => `${k}:${serializeValue(val)}`,
    );
    return `{${entries.join(",")}}`;
  }
  return String(v);
}

function serializeProps(props: Record<string, unknown>): string {
  const sanitized = { ...props };
  if (
    typeof sanitized.fill === "string" &&
    sanitized.fill.toLowerCase() === "transparent"
  ) {
    sanitized.fill = "#00000000";
  }

  if (typeof sanitized.stroke === "string") {
    const color = sanitized.stroke as string;
    const width =
      typeof sanitized.strokeWidth === "number"
        ? (sanitized.strokeWidth as number)
        : 1;
    sanitized.stroke = {
      align: "inside",
      fill: color,
      thickness: { top: width, right: width, bottom: width, left: width },
    };
    delete sanitized.strokeWidth;
  } else {
    delete sanitized.strokeWidth;
  }

  const entries = Object.entries(sanitized).map(
    ([k, v]) => `${k}:${serializeValue(v)}`,
  );
  return `{${entries.join(",")}}`;
}

function serializeOperation(op: DesignOperation): string | null {
  const propsStr = serializeProps(op.props ?? {});
  switch (op.op) {
    case "I": {
      if (!op.var || !op.parent) return null;
      return `${op.var}=I(${op.parent},${propsStr})`;
    }
    case "U": {
      if (!op.target) return null;
      if (op.target === "document") {
        console.warn("[PencilAgent] Dropping unsupported U(document,...)");
        return null;
      }
      return `U(${op.target},${propsStr})`;
    }
    case "C": {
      if (!op.var || !op.source || !op.parent) return null;
      return `${op.var}=C(${op.source},${op.parent},${propsStr})`;
    }
    case "D": {
      if (!op.target) return null;
      return `D(${op.target})`;
    }
    case "M": {
      if (!op.target || !op.parent) return null;
      return op.index != null
        ? `M(${op.target},${op.parent},${op.index})`
        : `M(${op.target},${op.parent})`;
    }
    default:
      return null;
  }
}

function serializeBlock(block: DesignBlock): string {
  return block.operations
    .map(serializeOperation)
    .filter((l): l is string => l !== null)
    .join("\n");
}

// ── Parsing: LLM response → design blocks ──

type ParsedDesign =
  | { mode: "structured"; blocks: DesignBlock[] }
  | { mode: "raw"; scripts: string[] };

function tryParseBlocks(content: string): DesignBlock[] | null {
  try {
    const parsed = JSON.parse(content) as DesignOutput;
    if (Array.isArray(parsed?.blocks)) {
      const blocks = parsed.blocks.filter(
        (b) => Array.isArray(b.operations) && b.operations.length > 0,
      );
      if (blocks.length > 0) return blocks;
    }
  } catch {
    /* not valid JSON */
  }
  return null;
}

/**
 * Attempt to repair truncated JSON by closing open structures
 * and extracting whatever complete blocks exist.
 */
function repairTruncatedJson(content: string): DesignBlock[] | null {
  const lastCompleteOp = content.lastIndexOf("}");
  if (lastCompleteOp === -1) return null;

  for (
    let cutoff = lastCompleteOp;
    cutoff >= 0;
    cutoff = content.lastIndexOf("}", cutoff - 1)
  ) {
    const slice = content.slice(0, cutoff + 1);
    const opens = (slice.match(/\[/g) || []).length;
    const closes = (slice.match(/\]/g) || []).length;
    const suffix = "]".repeat(Math.max(0, opens - closes)) + "}";
    const candidate = slice + suffix;

    const blocks = tryParseBlocks(candidate);
    if (blocks) {
      console.log(
        `[PencilAgent] Repaired truncated JSON — recovered ${blocks.length} block(s)`,
      );
      return blocks;
    }
  }
  return null;
}

function parseDesignOutput(content: string): ParsedDesign {
  const direct = tryParseBlocks(content);
  if (direct) {
    console.log(`[PencilAgent] JSON parsed OK — ${direct.length} block(s)`);
    return { mode: "structured", blocks: direct };
  }

  const repaired = repairTruncatedJson(content);
  if (repaired) {
    return { mode: "structured", blocks: repaired };
  }

  console.warn(
    "[PencilAgent] JSON parse failed — falling back to text block parsing",
  );
  return { mode: "raw", scripts: parseBatchBlocksLegacy(content) };
}

/**
 * Legacy text parser: extract fenced ```batch_design blocks or raw operation lines.
 * Kept as fallback when the model ignores json_object mode.
 */
function parseBatchBlocksLegacy(content: string): string[] {
  const regex = /```batch_design\s*\n([\s\S]*?)```/g;
  const batches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    const ops = m[1].trim();
    if (ops) batches.push(ops);
  }
  if (batches.length > 0) return batches;

  const opsPattern = /^[a-zA-Z_]\w*\s*=\s*[ICRUD]\s*\(|^[UD]\s*\(/;
  const rawLines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => opsPattern.test(l));
  if (rawLines.length > 0) batches.push(rawLines.join("\n"));
  return batches;
}

/**
 * Sanitize legacy raw scripts (same rules as before).
 */
function sanitizeRawScript(block: string): string {
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      if (/^U\s*\(\s*document\s*,/i.test(l)) return false;
      return true;
    })
    .map((line) =>
      line
        .replace(/fill:\s*"transparent"/gi, 'fill:"#00000000"')
        .replace(/strokeWidth\s*:\s*\d+\s*,?/g, "")
        .replace(
          /stroke\s*:\s*"(#[0-9a-fA-F]{3,8})"/g,
          'stroke:{align:"inside",fill:"$1",thickness:{top:1,right:1,bottom:1,left:1}}',
        ),
    )
    .join("\n");
}

/**
 * Convert parsed design to batch_design script strings ready for MCP.
 */
function toBatchScripts(parsed: ParsedDesign): string[] {
  if (parsed.mode === "structured") {
    return parsed.blocks.map(serializeBlock).filter((s) => s.trim().length > 0);
  }
  return parsed.scripts
    .map(sanitizeRawScript)
    .filter((s) => s.trim().length > 0);
}

/**
 * Convert parsed design to readable markdown (for PENCIL_DESIGN.md).
 */
function toMarkdown(parsed: ParsedDesign, mcpResults: string[]): string {
  const sections = [
    "# Pencil Design Operations\n",
    `Generated at ${new Date().toISOString()}\n`,
  ];

  if (parsed.mode === "structured") {
    for (let i = 0; i < parsed.blocks.length; i++) {
      const b = parsed.blocks[i];
      sections.push(
        `## ${b.screenName || `Screen ${i + 1}`}\n`,
        "```",
        serializeBlock(b),
        "```\n",
      );
    }
  } else {
    for (let i = 0; i < parsed.scripts.length; i++) {
      sections.push(`## Block ${i + 1}\n`, "```", parsed.scripts[i], "```\n");
    }
  }

  if (mcpResults.length > 0) {
    sections.push("## MCP Execution Results\n", mcpResults.join("\n"), "\n");
  }

  return sections.join("\n");
}

// ── Design Tokens: structured ops → developer-friendly markdown ──

interface DesignNode {
  varName: string;
  props: Record<string, unknown>;
  children: DesignNode[];
}

function buildNodeTree(ops: DesignOperation[]): DesignNode[] {
  const nodeMap = new Map<string, DesignNode>();
  const roots: DesignNode[] = [];

  for (const op of ops) {
    if (op.op !== "I" || !op.var) continue;
    const node: DesignNode = {
      varName: op.var,
      props: op.props ?? {},
      children: [],
    };
    nodeMap.set(op.var, node);

    if (op.parent === "document" || !op.parent) {
      roots.push(node);
    } else {
      const parentNode = nodeMap.get(op.parent);
      if (parentNode) {
        parentNode.children.push(node);
      } else {
        roots.push(node);
      }
    }
  }
  return roots;
}

function fmtDim(v: unknown): string {
  if (typeof v === "number") return `${v}px`;
  if (typeof v === "string") return v.replace(/_/g, "-");
  return String(v);
}

function fmtPadding(v: unknown): string {
  if (typeof v === "number") return `${v}px`;
  if (Array.isArray(v)) return v.map((n) => `${n}px`).join(" ");
  return String(v);
}

function renderDesignNode(node: DesignNode, depth: number): string {
  const indent = "  ".repeat(depth);
  const p = node.props;
  const type = (p.type as string) || "frame";
  const name = (p.name as string) || node.varName;
  const lines: string[] = [];

  if (type === "text") {
    const content = (p.content as string) || "";
    const parts = [`"${content}"`];
    if (p.fill) parts.push(`color ${p.fill}`);
    if (p.fontSize) parts.push(`${p.fontSize}px`);
    if (p.fontWeight) parts.push(`weight ${p.fontWeight}`);
    lines.push(`${indent}- **${name}** (text): ${parts.join(", ")}`);
  } else if (type === "icon_font") {
    const parts: string[] = [];
    if (p.iconFontFamily && p.iconFontName)
      parts.push(`${p.iconFontFamily}/${p.iconFontName}`);
    if (p.width && p.height) parts.push(`${p.width}×${p.height}`);
    if (p.fill) parts.push(`color ${p.fill}`);
    lines.push(`${indent}- **${name}** (icon): ${parts.join(", ")}`);
  } else {
    const attrs: string[] = [];
    if (p.layout) attrs.push(`layout: ${p.layout}`);
    if (p.width) attrs.push(`w: ${fmtDim(p.width)}`);
    if (p.height) attrs.push(`h: ${fmtDim(p.height)}`);
    if (p.gap) attrs.push(`gap: ${p.gap}px`);
    if (p.padding) attrs.push(`padding: ${fmtPadding(p.padding)}`);
    if (p.fill && p.fill !== "#00000000") attrs.push(`bg: ${p.fill}`);
    if (p.cornerRadius) attrs.push(`radius: ${p.cornerRadius}px`);
    if (p.alignItems) attrs.push(`align: ${p.alignItems}`);
    if (p.justifyContent)
      attrs.push(`justify: ${String(p.justifyContent).replace(/_/g, "-")}`);
    lines.push(`${indent}- **${name}**: ${attrs.join(" | ")}`);
  }

  for (const child of node.children) {
    lines.push(renderDesignNode(child, depth + 1));
  }
  return lines.join("\n");
}

/**
 * Convert structured design blocks to a developer-friendly Design Tokens
 * markdown that frontend agents can directly map to React + Tailwind code.
 */
export function toDesignTokensMarkdown(parsed: ParsedDesign): string {
  if (parsed.mode !== "structured" || parsed.blocks.length === 0) {
    return "";
  }

  const sections = ["# Design Tokens\n"];

  const allColors = new Set<string>();
  const allFontSizes = new Set<number>();

  for (const block of parsed.blocks) {
    const screenName = block.screenName || "Unnamed Screen";
    const roots = buildNodeTree(block.operations);

    const rootProps = roots[0]?.props;
    const dims =
      rootProps?.width && rootProps?.height
        ? `${rootProps.width}×${rootProps.height}`
        : "";

    sections.push(`## Screen: ${screenName}${dims ? ` (${dims})` : ""}\n`);

    for (const root of roots) {
      sections.push(renderDesignNode(root, 0));
    }
    sections.push("");

    for (const op of block.operations) {
      if (!op.props) continue;
      if (typeof op.props.fill === "string" && op.props.fill !== "#00000000")
        allColors.add(op.props.fill as string);
      if (typeof op.props.fontSize === "number")
        allFontSizes.add(op.props.fontSize as number);
    }
  }

  if (allColors.size > 0 || allFontSizes.size > 0) {
    sections.push("## Extracted Tokens\n");
    if (allColors.size > 0) {
      sections.push(
        "### Colors\n",
        [...allColors].map((c) => `- \`${c}\``).join("\n"),
        "",
      );
    }
    if (allFontSizes.size > 0) {
      const sorted = [...allFontSizes].sort((a, b) => a - b);
      sections.push(
        "### Font Sizes\n",
        sorted.map((s) => `- ${s}px`).join("\n"),
        "",
      );
    }
  }

  sections.push(
    "## Implementation Notes\n",
    "- Each **Screen** maps to a separate route or view component.",
    "- Indented items are children of the parent node — replicate this hierarchy in React components.",
    "- Use Tailwind arbitrary values for exact sizing: `w-[720px]`, `gap-[24px]`, `bg-[#1E293B]`, `text-[20px]`.",
    "- Frame `layout: horizontal` → `flex flex-row`, `layout: vertical` → `flex flex-col`.",
    "- `fill_container` → `w-full` or `h-full`, `fit_content` → `w-fit` or `h-fit`.",
    "- All colors from the design MUST be used exactly as specified.",
    "",
  );

  return sections.join("\n");
}

// ── Prompt ──

const SYSTEM_PROMPT = `You are an expert UI designer working with Pencil (.pen design tool).
Your task: create high-quality  design screens.

You MUST respond with **valid JSON only** — no markdown, no prose, no fences.

## JSON Schema

{
  "blocks": [
    {
      "screenName": "Dashboard",
      "operations": [
        { "op": "I", "var": "screen", "parent": "document", "props": { "type": "frame", "layout": "vertical", "width": 1440, "height": 900, "fill": "#0F172A", "name": "Dashboard" } },
        { "op": "I", "var": "header", "parent": "screen", "props": { "type": "frame", "layout": "horizontal", "width": "fill_container", "height": 64, "padding": [0, 24], "alignItems": "center", "fill": "#1E293B" } },
        { "op": "I", "var": "title", "parent": "header", "props": { "type": "text", "content": "Dashboard", "fill": "#F1F5F9", "fontSize": 20, "fontWeight": 600 } }
      ]
    }
  ]
}

## Operation Types

### Insert (I) — most common
{ "op": "I", "var": "<bindingName>", "parent": "<parentVar>", "props": { ... } }

### Update (U)
{ "op": "U", "target": "<varName>", "props": { ... } }
NEVER update "document" — the MCP rejects it.

### Copy (C)
{ "op": "C", "var": "<newName>", "source": "<sourceVar>", "parent": "<parentVar>", "props": { ... } }

### Delete (D)
{ "op": "D", "target": "<varName>" }

### Move (M)
{ "op": "M", "target": "<varName>", "parent": "<newParentVar>", "index": 0 }

Do NOT use image generation operations.

## Block Scoping

- Each block = one MCP batch call. Variable bindings ("var") are visible ONLY within that block.
- A new block starts fresh — only "document" is available.
- Keep one complete screen (with ALL children) in a single block. Do NOT split a screen's UI tree across blocks.
- Do NOT reference variables from a previous block.
- For multiple screens, put each in its own block, or put a wrapper frame + all screens in one block.

## Props Reference

### Layout
- layout: "vertical" | "horizontal" | "none"
- gap, padding (number | [h,v] | [t,r,b,l])
- justifyContent: "start" | "center" | "end" | "space_between"
- alignItems: "start" | "center" | "end"
- width/height: number | "fill_container" | "fit_content"

### Text
- type: "text", MUST set "fill" (no default color)
- Use "content" for the visible string — NOT "text"
- textGrowth: "auto" | "fixed-width" | "fixed-width-height"

### Icons
- type: "icon_font", iconFontFamily: "lucide", iconFontName: "<name>", set width + height + fill

### Frames
- fill for background, cornerRadius for rounding
- For multiple top-level screens: insert a row frame under document with layout:"horizontal", gap:48, then attach screens to it. Or set x on each root frame.
- Do not use fill: "transparent" — omit fill or use "#00000000".
- Each screen MUST nest real UI: headers, buttons, inputs, labels, etc. No empty placeholder frames.

### Stroke / Border
- stroke MUST be an object — NEVER a string.
- Format: { "align": "inside", "fill": "#334155", "thickness": { "bottom": 1 } }
- thickness can be { "top": n, "right": n, "bottom": n, "left": n } or any subset.
- NEVER use "stroke": "#color" or "strokeWidth" — these are INVALID and will cause errors.

`;

const MAX_PRD_CHARS = 28_000;
const MAX_DESIGN_SPEC_CHARS = 14_000;
const MAX_AUGMENT_CHARS = 12_000;

function buildUserPrompt(
  prd: string,
  designSpec: string,
  augmentMarkdown?: string,
): string {
  const prdBody =
    prd.length > MAX_PRD_CHARS
      ? `${prd.slice(0, MAX_PRD_CHARS)}\n\n[PRD truncated for length]`
      : prd;

  const specBody = designSpec.trim()
    ? designSpec.length > MAX_DESIGN_SPEC_CHARS
      ? `${designSpec.slice(0, MAX_DESIGN_SPEC_CHARS)}\n\n[Design spec truncated]`
      : designSpec
    : "(No Design Spec document in this run — use PRD and structured context below.)";

  const augmentBody =
    augmentMarkdown?.trim() &&
    (augmentMarkdown.length > MAX_AUGMENT_CHARS
      ? `${augmentMarkdown.slice(0, MAX_AUGMENT_CHARS)}\n\n[Augment truncated]`
      : augmentMarkdown.trim());

  const sections = [
    `## PRD\n\n${prdBody}`,
    `---\n\n## Design Specification\n\n${specBody}`,
  ];

  if (augmentBody) {
    sections.push(
      `---\n\n## Structured pages / CMP components\n\n${augmentBody}`,
    );
  }

  sections.push(
    `---\n\n## Your task`,
    `Create ALL primary screens from the PRD as separate top-level frames (1440×900).`,
    `- Nest real UI: cards, tables, forms, buttons, inputs, navigation, links, labels — match PRD and CMP list.`,
    `- Text nodes: use "content" for labels, never "text".`,
    `- Separate screens horizontally so they do not overlap.`,
    `Respond with valid JSON only.`,
  );

  return sections.join("\n\n");
}

// ── Agent ──

export class PencilDesignAgent {
  private mcp = PencilMcpClient.getInstance();

  async generateDesign(
    prdContent: string,
    designSpec: string,
    projectRoot: string,
    sessionId?: string,
    augmentMarkdown?: string,
  ): Promise<AgentResult> {
    const traceId = uuidv4();
    const startTime = Date.now();
    const model = resolveModel(MODEL);
    const designDir = path.join(projectRoot, "public", "design");

    createTrace({
      traceId,
      sessionId,
      agentName: "Pencil Design Agent",
      pipelineStep: "step-pencil",
      model,
    });

    await fs.mkdir(designDir, { recursive: true });

    // ── 1. LLM generates structured design operations (JSON mode) ──
    const userPrompt = buildUserPrompt(prdContent, designSpec, augmentMarkdown);
    console.log(
      "[PencilAgent] Context sizes — PRD:",
      prdContent.length,
      "designSpec:",
      designSpec.length,
      "augment:",
      augmentMarkdown?.length ?? 0,
      "userMessage:",
      userPrompt.length,
    );
    const maxTokens = (() => {
      const raw = process.env.PENCIL_BATCH_JSON_MAX_TOKENS;
      const parsed =
        raw !== undefined && raw !== "" ? Number.parseInt(raw, 10) : Number.NaN;
      const n = Number.isNaN(parsed) ? 50000 : parsed;
      return Math.min(128_000, Math.max(8_000, n));
    })();
    console.log(
      "[PencilAgent] Calling LLM (json_object mode, model:",
      model,
      ", max_tokens:",
      maxTokens,
      "env PENCIL_BATCH_JSON_MAX_TOKENS optional)...",
    );

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];

    let llmRes;
    try {
      llmRes = await chatCompletion(messages, {
        model,
        temperature: 0.6,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      });
    } catch (llmErr) {
      console.error(
        "[PencilAgent] LLM request failed:",
        llmErr instanceof Error ? llmErr.message : llmErr,
      );
      throw llmErr;
    }

    const content = llmRes.choices[0]?.message?.content ?? "";
    const usage = llmRes.usage;
    const costUsd = estimateCost(llmRes.model, usage);

    const wasTruncated = usage.completion_tokens >= maxTokens;
    console.log(
      "[PencilAgent] LLM done —",
      content.length,
      "chars, completion_tokens:",
      usage.completion_tokens,
      wasTruncated ? "(TRUNCATED — hit max_tokens limit)" : "",
    );

    logGeneration({
      traceId,
      name: "PencilDesignAgent::generate",
      model: llmRes.model,
      input: messages,
      output: content,
      usage: {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      },
      costUsd,
      durationMs: Date.now() - startTime,
    });

    // ── 2. Parse ──
    const parsed = parseDesignOutput(content);
    const batchScripts = toBatchScripts(parsed);
    const totalOps = batchScripts.reduce(
      (s, b) => s + b.split("\n").filter(Boolean).length,
      0,
    );
    console.log(
      `[PencilAgent] ${parsed.mode} — ${batchScripts.length} block(s), ${totalOps} total ops`,
    );

    if (batchScripts.length === 0) {
      console.warn("[PencilAgent] No design operations parsed — skipping MCP");
    }

    // ── 3. Execute in Pencil (best-effort) ──
    const mcpResults: string[] = [];
    let mcpSucceeded = false;

    if (batchScripts.length === 0) {
      mcpResults.push("No design operations parsed from LLM output");
    }

    try {
      if (batchScripts.length === 0)
        throw new Error("No design operations to execute");
      await runWithPencilMcpExclusive(async () => {
        console.log("[PencilAgent] Pencil MCP lock acquired — connecting...");
        await this.mcp.connect();
        try {
          const openResult = await this.mcp.openDocument("new");
          console.log(
            "[PencilAgent] Document opened:",
            openResult.slice(0, 100),
          );

          let okCount = 0;
          let failCount = 0;

          for (let i = 0; i < batchScripts.length; i++) {
            const blockNum = i + 1;
            if (PAUSE_BETWEEN_MS > 0) await sleep(PAUSE_BETWEEN_MS);
            const script = batchScripts[i];
            try {
              const r = await this.mcp.batchDesign(script);
              mcpResults.push(`block ${blockNum} OK: ${r.slice(0, 120)}`);
              okCount++;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(
                `[PencilAgent] batch_design block ${blockNum} failed:`,
                msg,
                "| ops preview:",
                script.slice(0, 200),
              );
              mcpResults.push(`block ${blockNum} FAILED: ${msg}`);
              failCount++;
            }
          }

          mcpSucceeded = okCount > 0;
          console.log(
            `[PencilAgent] MCP done: ${okCount} OK, ${failCount} failed`,
          );

          if (mcpSucceeded) {
            try {
              const topNodes = await this.getTopLevelNodeIds();
              if (topNodes.length > 0) {
                await this.mcp.exportNodes({
                  filePath: path.resolve(designDir, "design.pen"),
                  nodeIds: topNodes,
                  outputDir: designDir,
                  format: "png",
                });
                console.log("[PencilAgent] Exported PNGs:", topNodes);
              }
            } catch {
              /* non-fatal */
            }
          }
        } finally {
          await this.mcp.disconnect();
          console.log(
            "[PencilAgent] Pencil MCP disconnected (expected; Pencil UI may show session ended)",
          );
        }
      });
    } catch (mcpErr) {
      const msg = mcpErr instanceof Error ? mcpErr.message : String(mcpErr);
      console.warn("[PencilAgent] Pencil MCP failed:", msg);
      mcpResults.push(`MCP connection/setup failed: ${msg}`);
    }

    // ── 4. Save as markdown (always) ──
    const designMdPath = path.join(designDir, "PENCIL_DESIGN.md");
    await fs.writeFile(designMdPath, toMarkdown(parsed, mcpResults), "utf-8");

    const designTokens = toDesignTokensMarkdown(parsed);
    if (designTokens) {
      const tokensPath = path.join(designDir, "PencilDesignTokens.md");
      await fs.writeFile(tokensPath, designTokens, "utf-8");
    }

    await flushLangfuse();

    const durationMs = Date.now() - startTime;
    const returnContent = designTokens || toMarkdown(parsed, mcpResults);

    return {
      content: returnContent,
      model: llmRes.model,
      usage: {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
      },
      costUsd,
      durationMs,
      traceId,
    };
  }

  private async getTopLevelNodeIds(): Promise<string[]> {
    const raw = await this.mcp.batchGet({ readDepth: 0 });
    const idPattern = /"id"\s*:\s*"([^"]+)"/g;
    const ids: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = idPattern.exec(raw)) !== null) {
      ids.push(m[1]);
    }
    return [...new Set(ids)].slice(0, 10);
  }
}

/**
 * LLM-only pencil design generation (no Pencil MCP connection).
 * Used in the parallel-generate flow where we only need the design spec content.
 */
export async function generatePencilDesignContent(
  prdContent: string,
  designSpec: string,
  sessionId?: string,
  augmentMarkdown?: string,
): Promise<AgentResult> {
  const traceId = uuidv4();
  const startTime = Date.now();
  const model = resolveModel(MODEL);

  createTrace({
    traceId,
    sessionId,
    agentName: "Pencil Design Agent (LLM-only)",
    pipelineStep: "step-pencil",
    model,
  });

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: buildUserPrompt(prdContent, designSpec, augmentMarkdown),
    },
  ];

  const llmRes = await chatCompletion(messages, {
    model,
    temperature: 0.6,
    max_tokens: 16384,
    response_format: { type: "json_object" },
  });

  const content = llmRes.choices[0]?.message?.content ?? "";
  const usage = llmRes.usage;
  const costUsd = estimateCost(llmRes.model, usage);
  const durationMs = Date.now() - startTime;

  logGeneration({
    traceId,
    name: "PencilDesignAgent::generateContent",
    model: llmRes.model,
    input: messages,
    output: content,
    usage: {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    },
    costUsd,
    durationMs,
  });

  await flushLangfuse();

  const parsed = parseDesignOutput(content);
  const designTokens = toDesignTokensMarkdown(parsed);
  const returnContent = designTokens || toMarkdown(parsed, []);

  return {
    content: returnContent,
    model: llmRes.model,
    usage: {
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
    },
    costUsd,
    durationMs,
    traceId,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
