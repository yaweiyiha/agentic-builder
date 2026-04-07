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
import { PencilDesignAgent } from "@/lib/agents/design/pencil-agent";
import { resolveCodeOutputRoot } from "@/lib/pipeline/code-output";

/** Pencil step: LLM (up to 16k tokens) + many batch_design chunks can exceed 5 minutes. */
export const maxDuration = 600;

interface DocSpec {
  id: string;
  label: string;
  estimatedTokens: number;
}

type DocAgentFn = (prd: string, trd: string, sysDesign: string, designSpec: string, sessionId: string) => Promise<AgentResult>;

function buildAgentMap(
  codeOutputDir: string,
  pencilAugmentMarkdown?: string,
): Record<string, DocAgentFn> {
  const outputRoot = resolveCodeOutputRoot(process.cwd(), codeOutputDir);
  const augment = pencilAugmentMarkdown?.trim() || undefined;
  return {
    trd: (prd, _trd, _sys, _ds, sid) => new TRDAgent().generateTRD(prd, undefined, sid),
    sysdesign: (prd, trd, _sys, _ds, sid) => new SysDesignAgent().generateSysDesign(prd, trd, sid),
    implguide: (prd, trd, sys, _ds, sid) => new ImplGuideAgent().generateImplGuide(prd, trd, sys, sid),
    design: (prd, _trd, _sys, _ds, sid) => new DesignAgent().generateDesign(prd, undefined, sid),
    pencil: (prd, _trd, _sys, ds, sid) =>
      new PencilDesignAgent().generateDesign(prd, ds, outputRoot, sid, augment),
    qa: (prd, _trd, _sys, _ds, sid) => new QAAgent().generateAudit(prd, "", sid),
    verify: (prd, _trd, _sys, _ds, sid) => new VerifierAgent().verifyAlignment(prd, "", sid),
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
  const { prdContent, selectedDocs, sessionId, codeOutputDir, pencilAugmentMarkdown } =
    body as {
      prdContent: string;
      selectedDocs: string[];
      sessionId: string;
      codeOutputDir?: string;
      /** Structured PRD excerpt from client (steps.prd.metadata). */
      pencilAugmentMarkdown?: string;
    };

  if (!prdContent || !selectedDocs || selectedDocs.length === 0) {
    return Response.json(
      { error: "prdContent and selectedDocs are required" },
      { status: 400 },
    );
  }

  const agentMap = buildAgentMap(codeOutputDir ?? "", pencilAugmentMarkdown);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: unknown) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
        );
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

      const results: Record<string, { content: string; costUsd: number; durationMs: number; tokens: number }> = {};

      const hasSysDesign = selectedDocs.includes("sysdesign");
      const hasImplGuide = selectedDocs.includes("implguide");
      const hasPencil = selectedDocs.includes("pencil");

      // Phase A: independent docs (trd, design, qa, verify can all run in parallel)
      const phaseA = selectedDocs.filter(
        (id) => id !== "sysdesign" && id !== "implguide" && id !== "pencil",
      );

      async function runDoc(docId: string, trd: string, sys: string, ds: string) {
        send({ type: "doc_start", docId, label: DOC_LABELS[docId] ?? docId });
        try {
          const agentFn = agentMap[docId];
          if (!agentFn) throw new Error(`Unknown doc: ${docId}`);
          const result = await agentFn(prdContent, trd, sys, ds, sessionId);
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
          const msg = error instanceof Error ? error.message : "Generation failed";
          send({ type: "doc_error", docId, label: DOC_LABELS[docId] ?? docId, error: msg });
        }
      }

      await Promise.all(phaseA.map((id) => runDoc(id, "", "", "")));

      // Phase B: sysdesign (depends on trd) + pencil (depends on design)
      const phaseBPromises: Promise<void>[] = [];
      if (hasSysDesign) {
        phaseBPromises.push(runDoc("sysdesign", results.trd?.content ?? "", "", ""));
      }
      if (hasPencil) {
        phaseBPromises.push(runDoc("pencil", "", "", results.design?.content ?? ""));
      }
      if (phaseBPromises.length > 0) await Promise.all(phaseBPromises);

      // Phase C: implguide (depends on trd + sysdesign)
      if (hasImplGuide) {
        await runDoc("implguide", results.trd?.content ?? "", results.sysdesign?.content ?? "", "");
      }

      const totalCost = Object.values(results).reduce((s, r) => s + r.costUsd, 0);
      const totalTokens = Object.values(results).reduce((s, r) => s + r.tokens, 0);

      send({
        type: "generation_complete",
        results: Object.fromEntries(
          Object.entries(results).map(([k, v]) => [k, {
            costUsd: v.costUsd,
            durationMs: v.durationMs,
            tokens: v.tokens,
          }]),
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
