import { NextRequest } from "next/server";
import {
  TRDAgent,
  SysDesignAgent,
  ImplGuideAgent,
  DesignAgent,
  QAAgent,
  VerifierAgent,
} from "@/lib/agents";
import type { AgentResult } from "@/lib/agents";
import { resolveCodeOutputRoot } from "@/lib/pipeline/code-output";
import {
  runPencilLiveSession,
  type PencilLiveEvent,
} from "@/lib/pencil-host/live-runner";

/** Pencil step: LLM (up to 16k tokens) + many batch_design chunks can exceed 5 minutes. */
export const maxDuration = 600;

interface DocSpec {
  id: string;
  label: string;
  estimatedTokens: number;
}

type DocAgentFn = (
  prd: string,
  trd: string,
  sysDesign: string,
  designSpec: string,
  sessionId: string,
) => Promise<AgentResult>;

const TIER_STACK_CONSTRAINT: Record<string, string> = {
  S: `## IMPORTANT: Tech Stack Constraint (Tier S)
This is a **Tier-S (single app)** project. The frontend uses **Vite + React + TypeScript + Tailwind CSS**.
**NEVER recommend or reference Next.js.** Do not use App Router, next/router, next/link, next/image, or any Next.js API.
The build tool is Vite with @vitejs/plugin-react. Routing uses react-router-dom.`,

  M: `## IMPORTANT: Tech Stack Constraint (Tier M — monorepo)
This is a **Tier-M monorepo** project with the following stack:
- **Frontend** (\`apps/web\`): **Vite + React + TypeScript + Tailwind CSS + React Router**. **NEVER use Next.js.**
- **Backend** (\`apps/api\`): **Express + TypeScript**.
- **Shared** (\`packages/shared\`): shared types and utilities.
**NEVER recommend or reference Next.js** — no App Router, no next/router, no next/link, no next/image, no Next.js API routes, no server components.
The web app uses Vite with @vitejs/plugin-react and react-router-dom for routing.`,

  L: `## Tech Stack (Tier L — monorepo)
This is a **Tier-L monorepo** project:
- **Frontend** (\`apps/web\`): **Next.js App Router + TypeScript + Tailwind CSS**.
- **Backend** (\`apps/api\`): **Fastify + TypeScript**.
- **Shared** (\`packages/shared\`): shared types and utilities.`,
};

function buildAgentMap(tierConstraint: string): Record<string, DocAgentFn> {
  return {
    trd: (prd, _trd, _sys, _ds, sid) =>
      new TRDAgent().generateTRD(`${tierConstraint}\n\n${prd}`, undefined, sid),
    sysdesign: (prd, trd, _sys, _ds, sid) =>
      new SysDesignAgent().generateSysDesign(`${tierConstraint}\n\n${prd}`, trd, sid),
    implguide: (prd, trd, sys, _ds, sid) =>
      new ImplGuideAgent().generateImplGuide(`${tierConstraint}\n\n${prd}`, trd, sys, sid),
    design: (prd, _trd, _sys, _ds, sid) =>
      new DesignAgent().generateDesign(prd, undefined, sid),
    qa: (prd, _trd, _sys, _ds, sid) =>
      new QAAgent().generateAudit(prd, "", sid),
    verify: (prd, _trd, _sys, _ds, sid) =>
      new VerifierAgent().verifyAlignment(prd, "", sid),
  };
}

const TOKEN_ESTIMATES: Record<string, number> = {
  trd: 6000,
  sysdesign: 5000,
  implguide: 4000,
  design: 3000,
  pencil: 8000,
  qa: 2500,
  verify: 2000,
};

const DOC_LABELS: Record<string, string> = {
  trd: "TRD",
  sysdesign: "System Design",
  implguide: "Implementation Guide",
  design: "Design Spec",
  pencil: "Pencil Design",
  qa: "QA Test Cases",
  verify: "Verification",
};

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    prdContent,
    selectedDocs,
    sessionId,
    codeOutputDir,
    pencilAugmentMarkdown,
    tier,
  } = body as {
    prdContent: string;
    selectedDocs: string[];
    sessionId: string;
    codeOutputDir?: string;
    /** Structured PRD excerpt from client (steps.prd.metadata). */
    pencilAugmentMarkdown?: string;
    tier?: string;
  };

  const effectiveTier = ((tier ?? "M").toUpperCase()) as "S" | "M" | "L";

  if (!prdContent || !selectedDocs || selectedDocs.length === 0) {
    return Response.json(
      { error: "prdContent and selectedDocs are required" },
      { status: 400 },
    );
  }

  const outputRoot = resolveCodeOutputRoot(process.cwd(), codeOutputDir);
  const tierConstraint = TIER_STACK_CONSTRAINT[effectiveTier] ?? TIER_STACK_CONSTRAINT.M;
  const agentMap = buildAgentMap(tierConstraint);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: unknown) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      send({
        type: "generation_start",
        totalDocs: selectedDocs.length,
        docs: selectedDocs.map((id) => ({
          id,
          label: DOC_LABELS[id] ?? id,
          estimatedTokens: TOKEN_ESTIMATES[id] ?? 3000,
        })),
      });

      const results: Record<
        string,
        { content: string; costUsd: number; durationMs: number; tokens: number }
      > = {};

      const hasSysDesign = selectedDocs.includes("sysdesign");
      const hasImplGuide = selectedDocs.includes("implguide");
      const hasPencil = selectedDocs.includes("pencil");

      // Phase A: independent docs (trd, design, qa, verify can all run in parallel)
      const phaseA = selectedDocs.filter(
        (id) => id !== "sysdesign" && id !== "implguide" && id !== "pencil",
      );

      async function runDoc(
        docId: string,
        trd: string,
        sys: string,
        ds: string,
      ) {
        send({ type: "doc_start", docId, label: DOC_LABELS[docId] ?? docId });
        try {
          let result: AgentResult;
          if (docId === "pencil") {
            result = await runPencilLiveSession({
              prdContent,
              designSpec: ds,
              projectRoot: outputRoot,
              sessionId,
              augmentMarkdown: pencilAugmentMarkdown,
              onEvent: (event: PencilLiveEvent) => {
                send({
                  type: "doc_progress",
                  docId,
                  label: DOC_LABELS[docId] ?? docId,
                  event,
                });
              },
            });
          } else {
            const agentFn = agentMap[docId];
            if (!agentFn) throw new Error(`Unknown doc: ${docId}`);
            result = await agentFn(prdContent, trd, sys, ds, sessionId);
          }
          results[docId] = {
            content: result.content,
            costUsd: result.costUsd,
            durationMs: result.durationMs,
            tokens: result.usage.totalTokens,
          };
          send({
            type: "doc_complete",
            docId,
            label: DOC_LABELS[docId] ?? docId,
            content: result.content,
            costUsd: result.costUsd,
            durationMs: result.durationMs,
            tokens: result.usage.totalTokens,
          });
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : "Generation failed";
          send({
            type: "doc_error",
            docId,
            label: DOC_LABELS[docId] ?? docId,
            error: msg,
          });
        }
      }

      await Promise.all(phaseA.map((id) => runDoc(id, "", "", "")));

      // Phase B: sysdesign (depends on trd) + pencil (depends on design)
      const phaseBPromises: Promise<void>[] = [];
      if (hasSysDesign) {
        phaseBPromises.push(
          runDoc("sysdesign", results.trd?.content ?? "", "", ""),
        );
      }
      if (hasPencil) {
        phaseBPromises.push(
          runDoc("pencil", "", "", results.design?.content ?? ""),
        );
      }
      if (phaseBPromises.length > 0) await Promise.all(phaseBPromises);

      // Phase C: implguide (depends on trd + sysdesign)
      if (hasImplGuide) {
        await runDoc(
          "implguide",
          results.trd?.content ?? "",
          results.sysdesign?.content ?? "",
          "",
        );
      }

      const totalCost = Object.values(results).reduce(
        (s, r) => s + r.costUsd,
        0,
      );
      const totalTokens = Object.values(results).reduce(
        (s, r) => s + r.tokens,
        0,
      );

      send({
        type: "generation_complete",
        results: Object.fromEntries(
          Object.entries(results).map(([k, v]) => [
            k,
            {
              costUsd: v.costUsd,
              durationMs: v.durationMs,
              tokens: v.tokens,
            },
          ]),
        ),
        totalCostUsd: totalCost,
        totalTokens,
      });

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function GET() {
  return Response.json({
    tokenEstimates: TOKEN_ESTIMATES,
    docLabels: DOC_LABELS,
  });
}
