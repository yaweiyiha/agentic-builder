import { BaseAgent } from "../shared/base-agent";
import { MODEL_CONFIG } from "@/lib/model-config";
import type {
  PrdDomainSpec,
  PrdRuleSpec,
} from "@/lib/requirements/prd-spec-types";

const SYSTEM_PROMPT = `You are a senior Technical Architect Agent.

## Your Role
Transform a PRD into a comprehensive **Technical Requirements Document (TRD)**.
Your TRD must be production-grade — the kind of document a staff engineer would write
for a Series-B startup shipping to thousands of users.

## Output Format — Markdown

# Technical Requirements Document: [Product Name]

## 1. Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
(Cover: frontend framework, rendering, state management, realtime transport, backend framework,
 primary DB, cache, object storage, search, auth, plugin/extension runtime, message queue,
 CDN/edge, infrastructure, observability, CI/CD.)

## 2. Frontend Architecture
### 2.1 Application Shell
(SPA vs MPA, code-split routes, primary zones.)
### 2.2 Rendering Pipeline
(Layers, scene graph, dirty tracking if applicable.)
### 2.3 State Management & Realtime
(Local state, CRDT or OT if collaborative, command bus, undo/redo.)
### 2.4 Plugin / Extension SDK
(Runtime, sandboxing, capability-gated API namespaces.)

## 3. Backend Architecture
### 3.1 Services
| Service | Responsibility | Tech |
|---------|---------------|------|
### 3.2 Data Models
(Core tables/collections with key columns and notes.)
### 3.3 API Specification Summary
| Group | Base Path | Key Endpoints |
|-------|-----------|---------------|
### 3.4 File / Data Format
(Open format spec if applicable; schema versioning strategy.)

## 4. Security Requirements
| Area | Requirement | Implementation |
|------|------------|----------------|
(Auth, authz, transport, plugin sandbox, upload validation, injection prevention, CSRF,
 secrets management, audit logging.)

## 5. Non-Functional Targets
| Category | Metric | Target |
|----------|--------|--------|
(Performance, scalability, availability, browser support.)

## 6. Shared Schema (REQUIRED)

After the five sections above, output a single TypeScript file as a fenced
code block in this **exact** format (the language tag and \`file:\` header
are how downstream tooling extracts it):

\`\`\`typescript file:shared/schema.ts
// Source of truth for every type that crosses the API boundary or that
// frontend AND backend code both touch. Both sides MUST import from this
// module rather than redefine. No \`any\`. ISO 8601 strings for timestamps.

export type ProjectId = string;

export interface Project {
  id: ProjectId;
  name: string;
  status: "active" | "archived";
  createdAt: string;
}

export interface CreateProjectRequest { name: string; }
export interface CreateProjectResponse { project: Project; }
\`\`\`

### Rules for the schema block
- **Cover every entity** from §3.2 with an interface or type alias. No \`any\`.
- **Cover every endpoint** from §3.3 with a Request and Response interface
  named after the operation, e.g. \`CreateTaskRequest\` / \`CreateTaskResponse\`.
  GET endpoints with no body still get a Response interface.
- Use **string literal unions** for enum-like fields (\`status: "todo" | "in_progress" | "done"\`).
- Timestamps are **ISO 8601 strings** (\`createdAt: string\`), not \`Date\`.
- Optional fields: \`field?: T\`. Nullable fields: \`field: T | null\`. Distinct concepts.
- Cross-reference ids by branded alias (\`UserId\`, \`ProjectId\`) where it aids readability.
- Keep names PascalCase for types, camelCase for fields. Match exactly the field names
  used in the API responses described in §3.3.
- The block should be self-contained — no imports from external modules.

## 7. Business Rules DSL (CONDITIONAL)

If — and only if — the PRD describes rule-heavy domain logic such as scoring,
pricing, eligibility / qualification gates, risk grading, leveling, tax or
discount tiers, or other piecewise-deterministic numeric/categorical
computations, output a YAML block in this **exact** format:

\`\`\`yaml file:business-rules.dsl.yaml
version: 1
rules:
  - id: SCORE-1
    name: "Quality score from satisfaction rating"
    description: "Maps 1-5 customer rating to a 0-100 quality score."
    type: piecewise-linear
    inputUnit: "rating"
    outputRange: [0, 100]
    segments:
      - { from: 1.0, to: 2.0, outputFrom: 0,  outputTo: 25 }
      - { from: 2.0, to: 3.5, outputFrom: 25, outputTo: 60 }
      - { from: 3.5, to: 5.0, outputFrom: 60, outputTo: 100 }
  - id: ELIG-1
    name: "Loan tier eligibility"
    description: "Top-down decision table picking premium / standard / basic."
    type: decision-table
    inputs:
      - { name: creditScore, type: number }
      - { name: incomeUsd,   type: number }
    output: { name: tier, type: string }
    cases:
      - when: { creditScore: ">=750", incomeUsd: ">=80000" }
        then: "premium"
      - when: { creditScore: ">=650" }
        then: "standard"
      - when: { }
        then: "basic"
\`\`\`

### DSL rules
- Supported \`type\` values for the MVP are **only** \`piecewise-linear\` and
  \`decision-table\`. State machines, composite formulas, and other shapes
  remain in worker codegen for now.
- For \`piecewise-linear\`: segments must be **contiguous** (each segment's
  \`from\` equals the previous segment's \`to\`) and ordered. \`outputFrom\` /
  \`outputTo\` may be monotonic increasing or decreasing.
- For \`decision-table\`: cases evaluate top-to-bottom; first match wins. An
  empty \`when: { }\` is the default fallback and **must be last** if present.
- If the project has no rule-heavy logic (CRUD app, dashboard, content site,
  generic chat UI, etc.), **omit §7 entirely**. Do not emit an empty rules
  block, and do not include a heading without a body.

### Authoritative source for boundary values
If the user message contains a section titled "## PRD-provided domain
rules", those rules are **authoritative**. Copy every \`id\`, \`type\`,
\`inputVariableId\`, segment boundary, and decision case **verbatim** into
§7. Do NOT round numbers, do NOT add/remove segments, do NOT invent new
rules beyond what is listed. You may add a \`description\` field if absent
and reformat the YAML for clarity, but the numeric values are fixed.

## 8. Workflow DAG (CONDITIONAL)

If — and only if — the system has any **multi-step deterministic pipeline**
that chains two or more services in a fixed order (e.g. periodic scoring
cycles, ETL aggregation, multi-stage data ingestion, batch jobs that read,
transform, persist, then notify), output a YAML block:

\`\`\`yaml file:pipeline-dag.yaml
version: 1
pipelines:
  - id: scoring-cycle
    description: "5-minute stablecoin scoring run"
    schedule: { cron: "*/5 * * * *" }
    failure: { strategy: abort, retries: 0, compensation: skip-cycle }
    nodes:
      - { id: collect,   service: DataCollectionService,   function: collectAllSources }
      - { id: normalize, service: NormalizationService,    function: executeNormalization, dependsOn: [collect] }
      - { id: score,     service: ScoringEngine,           function: calculateComposite,   dependsOn: [normalize] }
      - { id: alert,     service: AlertService,            function: createAlerts,         dependsOn: [score] }
\`\`\`

### DAG rules
- \`id\` must be unique within a pipeline.
- \`service\` MUST match a service name listed in column 1 of §3.1 Services.
  The validator will flag any drift.
- \`dependsOn\` references must resolve to sibling \`id\`s in the same pipeline.
  The graph must be acyclic.
- \`failure.strategy\` is one of \`abort\`, \`continue\`, or \`retry-N\` (e.g.
  \`retry-3\`). Other values are reserved for later phases.
- A pipeline with a single node still belongs in §8 if its execution must be
  deterministic / scheduled — it documents the contract.
- If the system has **no** such pipelines (pure CRUD app, request/response
  only, no jobs), **omit §8 entirely**.

## Rules
- Be specific: name exact libraries, versions, rationale.
- Every table row must have a clear "why".
- Reference the PRD feature IDs (FR-xxx, US-xxx) where decisions stem from a requirement.
- Include at least one architecture diagram as an ASCII box diagram.
- Keep the human-readable Markdown (§1-5) in the 2000–5000 word range.
- The §6 schema block, §7 DSL, and §8 DAG (when present) are **not** counted
  in that word budget — emit them in full no matter how large.`;

export class TRDAgent extends BaseAgent {
  constructor() {
    super({
      name: "TRD Agent",
      role: "Technical Architect",
      systemPrompt: SYSTEM_PROMPT,
      defaultModel: MODEL_CONFIG.trd,
      temperature: 0.5,
      // Bumped from 16384 to fit the §6 schema block (often 300-800 lines
      // of TS for non-trivial projects) plus the human-readable doc.
      maxTokens: 24576,
    });
  }

  async generateTRD(
    prdContent: string,
    additionalContext?: string,
    sessionId?: string,
    /** Optional structured PRD spec — when its `domain.rules` is non-empty,
     *  the rules are injected into the prompt as authoritative source so
     *  the LLM cannot invent its own boundary values for §7. */
    prdSpec?: { domain?: PrdDomainSpec } | null,
    /** When provided, switches to streaming mode and calls onChunk for each content delta. */
    onChunk?: (chunk: string) => void,
  ) {
    const rulesBlock = renderAuthoritativeRulesBlock(prdSpec?.domain?.rules);
    const augmentedContext = [additionalContext, rulesBlock]
      .filter((s) => s && s.trim().length > 0)
      .join("\n\n");
    const message = `Generate a comprehensive Technical Requirements Document (TRD) based on the following PRD:\n\n${prdContent}`;
    const ctx = augmentedContext.length > 0 ? augmentedContext : undefined;
    if (onChunk) {
      return this.streamRun(message, (chunk) => onChunk(chunk), ctx, "step-trd", sessionId);
    }
    return this.run(message, ctx, "step-trd", sessionId);
  }
}

/**
 * Render PRD-extracted rules as a YAML-friendly authoritative source
 * block for the TRD prompt. The LLM is instructed (in SYSTEM_PROMPT) to
 * copy these values verbatim into §7. Returns empty string when there
 * are no rules — the prompt then falls back to its existing "if
 * applicable, emit §7" behavior.
 *
 * Only rules whose `type` is in the MVP set (piecewise-linear,
 * decision-table) are rendered with full structure; "other" rules pass
 * through with their formula text so the LLM has the description but
 * knows not to claim it's a typed rule.
 */
export function renderAuthoritativeRulesBlock(
  rules: PrdRuleSpec[] | undefined,
): string {
  if (!rules || rules.length === 0) return "";

  const lines: string[] = [
    "## PRD-provided domain rules",
    "",
    "The following rules were extracted from the PRD and are AUTHORITATIVE.",
    "Copy every numeric value verbatim into §7 of your TRD output. Do NOT",
    "invent new boundaries, add/remove segments, or round any number.",
    "",
    "```yaml",
    "rules:",
  ];
  for (const r of rules) {
    lines.push(`  - id: ${yamlSafe(r.id)}`);
    lines.push(`    name: ${yamlString(r.name)}`);
    if (r.description) {
      lines.push(`    description: ${yamlString(r.description)}`);
    }
    lines.push(`    type: ${r.type}`);
    if (r.inputVariableId) {
      lines.push(`    inputVariableId: ${yamlSafe(r.inputVariableId)}`);
    }
    if (r.type === "piecewise-linear" && r.segments?.length) {
      lines.push(`    segments:`);
      for (const s of r.segments) {
        lines.push(
          `      - { from: ${s.from}, to: ${s.to}, outputFrom: ${s.outputFrom}, outputTo: ${s.outputTo} }`,
        );
      }
    }
    if (r.type === "decision-table" && r.cases?.length) {
      lines.push(`    cases:`);
      for (const c of r.cases) {
        const whenStr = Object.keys(c.when).length === 0
          ? "{}"
          : `{ ${Object.entries(c.when)
              .map(([k, v]) => `${k}: ${yamlString(String(v))}`)
              .join(", ")} }`;
        lines.push(
          `      - { when: ${whenStr}, then: ${yamlString(String(c.then))} }`,
        );
      }
    }
    if (r.type === "other" && r.formula) {
      lines.push(`    formula: ${yamlString(r.formula)}`);
    }
  }
  lines.push("```");
  return lines.join("\n");
}

function yamlSafe(s: string): string {
  return /^[a-zA-Z0-9_-]+$/.test(s) ? s : yamlString(s);
}

function yamlString(s: string): string {
  // Conservative double-quoting; escape backslashes and double-quotes.
  const escaped = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}
