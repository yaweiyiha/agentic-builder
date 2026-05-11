/**
 * Lightweight shape + integrity validator for the workflow-DAG DSL
 * emitted in TRD §8. Purely regex / string-based — full YAML parsing
 * happens at codegen consumption time. Validator's output drives
 * dashboard warnings, never blocks the pipeline.
 *
 * Current MVP scope:
 *   - Top-level shape: `version: 1` + `pipelines:` array
 *   - Each pipeline has id, nodes[]
 *   - Each node has id, service, function (optional dependsOn)
 *   - failure.strategy ∈ { abort, continue, retry-N }
 *   - dependsOn references resolve to sibling node ids
 *   - DAG is acyclic
 *   - Service names appearing in nodes match column 1 of TRD §3.1
 *     Services table (when the TRD body is provided)
 *
 * Out of scope for now: cron-format validation, compensation grammars,
 * cross-pipeline dependencies. Add if a real project surfaces the need.
 */

export type DagWarningCode =
  | "missing-version"
  | "missing-pipelines"
  | "no-pipelines"
  | "pipeline-missing-id"
  | "pipeline-missing-nodes"
  | "node-missing-id"
  | "node-missing-service"
  | "node-unknown-dependson"
  | "cycle-detected"
  | "unknown-failure-strategy"
  | "service-not-in-trd"
  | "empty-content";

export interface DagWarning {
  code: DagWarningCode;
  message: string;
}

export interface DagValidation {
  ok: boolean;
  pipelineCount: number;
  nodeCount: number;
  /** Distinct service names referenced by nodes. */
  servicesReferenced: string[];
  warnings: DagWarning[];
}

interface ParsedNode {
  id: string;
  service?: string;
  dependsOn: string[];
}

interface ParsedPipeline {
  id: string;
  nodes: ParsedNode[];
  failureStrategy?: string;
}

const STRATEGY_RE = /^(abort|continue|retry-\d+)$/;

export interface DagValidationOptions {
  /** Full TRD markdown — when provided, service names in nodes are
   *  cross-checked against column 1 of §3.1 Services table. */
  trdMarkdown?: string;
}

export function validateWorkflowDag(
  yaml: string,
  opts: DagValidationOptions = {},
): DagValidation {
  const warnings: DagWarning[] = [];

  if (!yaml.trim()) {
    return {
      ok: false,
      pipelineCount: 0,
      nodeCount: 0,
      servicesReferenced: [],
      warnings: [{ code: "empty-content", message: "DAG block is empty." }],
    };
  }

  if (!/^\s*version:\s*1\b/m.test(yaml)) {
    warnings.push({
      code: "missing-version",
      message: "Missing top-level `version: 1`.",
    });
  }

  if (!/^\s*pipelines:\s*$/m.test(yaml) && !/^\s*pipelines:\s*\[/m.test(yaml)) {
    warnings.push({
      code: "missing-pipelines",
      message: "Missing top-level `pipelines:` array.",
    });
  }

  const pipelines = parsePipelines(yaml);
  if (pipelines.length === 0) {
    warnings.push({
      code: "no-pipelines",
      message: "No pipeline entries with `id:` were found.",
    });
  }

  const allServices = new Set<string>();
  let nodeCount = 0;

  for (const p of pipelines) {
    if (!p.id) {
      warnings.push({
        code: "pipeline-missing-id",
        message: "A pipeline is missing its `id:` field.",
      });
    }
    if (p.nodes.length === 0) {
      warnings.push({
        code: "pipeline-missing-nodes",
        message: `Pipeline "${p.id || "(unnamed)"}" has no nodes.`,
      });
    }

    if (p.failureStrategy && !STRATEGY_RE.test(p.failureStrategy)) {
      warnings.push({
        code: "unknown-failure-strategy",
        message:
          `Pipeline "${p.id}" failure.strategy "${p.failureStrategy}" is ` +
          "not in the MVP set (abort, continue, retry-N).",
      });
    }

    const nodeIds = new Set(p.nodes.map((n) => n.id).filter(Boolean));

    for (const n of p.nodes) {
      nodeCount++;
      if (!n.id) {
        warnings.push({
          code: "node-missing-id",
          message: `Pipeline "${p.id}" has a node missing its \`id:\`.`,
        });
        continue;
      }
      if (!n.service) {
        warnings.push({
          code: "node-missing-service",
          message: `Node "${n.id}" in pipeline "${p.id}" missing \`service:\`.`,
        });
      } else {
        allServices.add(n.service);
      }
      for (const dep of n.dependsOn) {
        if (!nodeIds.has(dep)) {
          warnings.push({
            code: "node-unknown-dependson",
            message: `Node "${n.id}" depends on "${dep}" which is not defined in pipeline "${p.id}".`,
          });
        }
      }
    }

    if (detectCycle(p.nodes)) {
      warnings.push({
        code: "cycle-detected",
        message: `Pipeline "${p.id}" contains a cycle in its dependsOn graph.`,
      });
    }
  }

  // Service-name cross-check against TRD §3.1.
  if (opts.trdMarkdown && allServices.size > 0) {
    const trdServices = extractServicesFromTrd(opts.trdMarkdown);
    if (trdServices.size > 0) {
      const lowerSet = new Set(
        Array.from(trdServices).map((s) => s.toLowerCase()),
      );
      for (const svc of allServices) {
        if (!lowerSet.has(svc.toLowerCase())) {
          warnings.push({
            code: "service-not-in-trd",
            message:
              `DAG references service "${svc}" which is not declared in ` +
              "TRD §3.1 Services table. Either rename the node or add the " +
              "service to §3.1.",
          });
        }
      }
    }
  }

  return {
    ok: warnings.length === 0,
    pipelineCount: pipelines.length,
    nodeCount,
    servicesReferenced: Array.from(allServices).sort(),
    warnings,
  };
}

// ─── Internal: lightweight YAML extraction ──────────────────────────────────

function parsePipelines(yaml: string): ParsedPipeline[] {
  // Split into pipeline blocks. Each pipeline starts with "  - id: ...".
  // A pipeline block ends at the next "  - id:" at the same indent, or end.
  const lines = yaml.split("\n");
  const pipelineStartIdx: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s{0,2}-\s*id:\s*\S+/.test(lines[i] ?? "")) {
      pipelineStartIdx.push(i);
    }
  }

  const out: ParsedPipeline[] = [];
  for (let i = 0; i < pipelineStartIdx.length; i++) {
    const start = pipelineStartIdx[i]!;
    const end =
      i + 1 < pipelineStartIdx.length ? pipelineStartIdx[i + 1]! : lines.length;
    const body = lines.slice(start, end).join("\n");
    const id = body.match(/^\s{0,2}-\s*id:\s*(\S+)/)?.[1] ?? "";
    const failureStrategy = body
      .match(/^\s+failure:\s*\{\s*strategy:\s*([^,}\s]+)/m)?.[1]
      ?.replace(/['"]/g, "");
    out.push({
      id,
      nodes: parseNodes(body),
      failureStrategy,
    });
  }
  return out;
}

function parseNodes(pipelineBody: string): ParsedNode[] {
  // Only parse list items under a `nodes:` key — otherwise the pipeline's
  // own `- id: <pipeline>` line gets misread as a node, and any other
  // `- id:` lists (e.g. acceptanceCriteria) leak in.
  const nodesSection = extractNodesSection(pipelineBody);
  if (!nodesSection) return [];

  const nodes: ParsedNode[] = [];

  // Inline form: "- { id: x, service: y, function: z, dependsOn: [a, b] }"
  const inlineRe = /^\s*-\s*\{[^}]*\bid:\s*([^\s,}]+)[^}]*\}/gm;
  for (const m of nodesSection.matchAll(inlineRe)) {
    const segment = m[0];
    const id = (m[1] ?? "").replace(/['"]/g, "");
    const service = segment
      .match(/\bservice:\s*([^\s,}]+)/)?.[1]
      ?.replace(/['"]/g, "");
    const dependsOnMatch = segment.match(/\bdependsOn:\s*\[([^\]]*)\]/);
    const dependsOn = dependsOnMatch
      ? dependsOnMatch[1]!
          .split(",")
          .map((s) => s.trim().replace(/['"]/g, ""))
          .filter(Boolean)
      : [];
    nodes.push({ id, service, dependsOn });
  }

  // Block form: "- id: x" followed by indented "service: y" / "dependsOn: [...]"
  const blockNodeIds = Array.from(
    nodesSection.matchAll(/^(\s+)-\s*id:\s*([^\s{]+)\s*$/gm),
  );
  for (const m of blockNodeIds) {
    const indent = m[1] ?? "";
    const id = (m[2] ?? "").replace(/['"]/g, "");
    if (nodes.some((n) => n.id === id)) continue;
    const childPrefix = indent + "  ";
    const startIdx = m.index ?? 0;
    const tail = nodesSection.slice(startIdx);
    const childLines = tail.split("\n").slice(1);
    const block: string[] = [];
    for (const ln of childLines) {
      if (!ln.startsWith(childPrefix) && ln.trim() !== "") break;
      block.push(ln);
    }
    const blockText = block.join("\n");
    const service = blockText
      .match(/^\s+service:\s*([^\s,}]+)/m)?.[1]
      ?.replace(/['"]/g, "");
    const dependsOnMatch = blockText.match(/^\s+dependsOn:\s*\[([^\]]*)\]/m);
    const dependsOn = dependsOnMatch
      ? dependsOnMatch[1]!
          .split(",")
          .map((s) => s.trim().replace(/['"]/g, ""))
          .filter(Boolean)
      : [];
    nodes.push({ id, service, dependsOn });
  }

  return nodes;
}

/**
 * Slice out the indented block under a `nodes:` key. Returns null when
 * `nodes:` is absent. The body covers from the line after `nodes:` until
 * the next sibling (same indent or shallower) non-empty line.
 */
function extractNodesSection(pipelineBody: string): string | null {
  const lines = pipelineBody.split("\n");
  let startIdx = -1;
  let parentIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)nodes:\s*$/.exec(lines[i] ?? "");
    if (m) {
      startIdx = i + 1;
      parentIndent = m[1]!.length;
      break;
    }
  }
  if (startIdx < 0) return null;

  const childLines: string[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const ln = lines[i] ?? "";
    if (!ln.trim()) {
      childLines.push(ln);
      continue;
    }
    const indent = ln.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= parentIndent) break;
    childLines.push(ln);
  }
  return childLines.join("\n");
}

function detectCycle(nodes: ParsedNode[]): boolean {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, n.dependsOn);
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const n of nodes) color.set(n.id, WHITE);

  function dfs(u: string): boolean {
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v) ?? WHITE;
      if (c === GRAY) return true;
      if (c === WHITE && dfs(v)) return true;
    }
    color.set(u, BLACK);
    return false;
  }

  for (const n of nodes) {
    if ((color.get(n.id) ?? WHITE) === WHITE) {
      if (dfs(n.id)) return true;
    }
  }
  return false;
}

// ─── §3.1 service-name extraction from TRD markdown ─────────────────────────

export function extractServicesFromTrd(markdown: string): Set<string> {
  // Find the "### 3.1 Services" (or "## 3.1") heading, then parse the
  // following Markdown table's first column.
  const out = new Set<string>();
  const headingRe = /^#{1,6}\s+3\.1\s+Services\s*$/im;
  const headingMatch = headingRe.exec(markdown);
  if (!headingMatch) return out;

  const after = markdown.slice(headingMatch.index + headingMatch[0].length);
  const lines = after.split("\n");

  let inTable = false;
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line) && line.trim() !== "") break; // next heading
    if (!line.trim()) continue;
    if (/^\s*\|.*\|.*$/.test(line)) {
      // Skip header row + separator row.
      if (/^\s*\|[\s-:|]+$/.test(line)) {
        inTable = true;
        continue;
      }
      if (!inTable) continue; // header row before separator
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      const first = cells[0];
      if (first) out.add(first);
    } else if (inTable) {
      break; // table ended
    }
  }
  return out;
}
