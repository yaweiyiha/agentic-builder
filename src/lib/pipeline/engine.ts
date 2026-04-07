import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs/promises";
import type {
  PrdRequirementIndex,
  PrdSpec,
} from "@/lib/requirements/prd-spec-types";
import { extractPrdRequirementIndex } from "@/lib/requirements/extract-prd-spec";
import { extractPrdSpec } from "@/lib/requirements/prd-spec-extractor";
import {
  runPrdSpecGate,
  runQaCoverageGate,
  runTaskCoverageGate,
} from "@/lib/pipeline/gates";
import {
  PMAgent,
  TRDAgent,
  SysDesignAgent,
  ImplGuideAgent,
  DesignAgent,
  PencilDesignAgent,
  MockupAgent,
  QAAgent,
  VerifierAgent,
  classifyProject,
} from "@/lib/agents";
import type { AgentResult } from "@/lib/agents";
import type { ProjectTier, ProjectClassification } from "@/lib/agents";
import type {
  PipelineRun,
  PipelineStepId,
  StepResult,
  PipelineEvent,
} from "./types";
import {
  resolveCodeOutputRoot,
  writeCodegenFileMap,
  buildGitInitInstructions,
} from "./code-output";
import { runKickoffIntegrations } from "./kickoff-integrations";
import { buildTaskBreakdownFromDocuments } from "./kickoff-task-breakdown";

type EventHandler = (event: PipelineEvent) => void;

export interface ExecutePipelineOptions {
  codeOutputDir?: string;
  /**
   * When true: after PRD, skip TRD / SysDesign / ImplGuide / Design / Pencil / Mockup / QA / Verify
   * — go straight to kick-off with PRD.md written from the PRD content.
   */
  fastFromPrd?: boolean;
  /**
   * When true: pause after PRD generation for user review/refinement.
   * Downstream docs (TRD, SysDesign, etc.) will be triggered separately
   * via the parallel-generate API after user confirms the PRD.
   */
  pauseAfterPrd?: boolean;
}

/**
 * Determines which preparation steps to run based on the project tier.
 *
 * | Tier | TRD | SystemDesign | ImplGuide | QA | Verify |
 * |------|-----|-------------|-----------|-----|--------|
 * | S    | no  | no          | no        | no  | no     |
 * | M    | no  | no          | no        | yes | yes    |
 * | L    | yes | yes         | yes       | yes | yes    |
 */
function stepsForTier(tier: ProjectTier) {
  return {
    needsTrd: tier === "L",
    needsSysDesign: tier === "L",
    needsImplGuide: tier === "L",
    needsQa: tier !== "S",
    needsVerify: tier !== "S",
  };
}

export const STATIC_PRD_RELATIVE_PATH = path.join(".blueprint", "PRD.md");
const STATIC_DESIGN_RELATIVE_PATH = path.join(".blueprint", "DESIGN.md");

const FAST_MODE_DESIGN_FALLBACK = `## Design specification (fast mode)

Implement the product using React 18, TypeScript, and Tailwind CSS only.
Follow the PRD for information architecture, screens, and user flows.
Use a cohesive dark UI (zinc-950 / zinc-900 backgrounds, zinc-100 text, indigo accents).
`;

export class PipelineEngine {
  private trdAgent = new TRDAgent();
  private sysDesignAgent = new SysDesignAgent();
  private implGuideAgent = new ImplGuideAgent();
  private designAgent = new DesignAgent();
  private pencilAgent = new PencilDesignAgent();
  private mockupAgent = new MockupAgent();
  private qaAgent = new QAAgent();
  private verifierAgent = new VerifierAgent();
  private onEvent?: EventHandler;
  private projectRoot: string;

  constructor(onEvent?: EventHandler, projectRoot?: string) {
    this.onEvent = onEvent;
    this.projectRoot = projectRoot ?? process.cwd();
  }

  createRun(featureBrief: string): PipelineRun {
    const now = new Date().toISOString();
    return {
      id: uuidv4(),
      sessionId: uuidv4(),
      featureBrief,
      status: "idle",
      currentStep: null,
      steps: {
        intent: null,
        prd: null,
        trd: null,
        sysdesign: null,
        implguide: null,
        design: null,
        pencil: null,
        mockup: null,
        qa: null,
        verify: null,
        kickoff: null,
      },
      totalCostUsd: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Full pipeline:
   * 1. Classify project → tier S/M/L
   * 2. Preparation: Intent → PRD(tier-aware) → [TRD] → [SysDesign] → [ImplGuide] → Design → Pencil → Mockup → [QA] → [Verify]
   * 3. Kick-off
   *
   * Steps in [] are conditionally skipped based on project tier.
   */
  async executePipeline(
    run: PipelineRun,
    options: ExecutePipelineOptions = {},
  ): Promise<PipelineRun> {
    run.status = "running";
    run.updatedAt = new Date().toISOString();
    const fast = options.fastFromPrd === true;
    const outputRoot = resolveCodeOutputRoot(
      this.projectRoot,
      options.codeOutputDir,
    );

    // ── Intent ──
    run.steps.intent = this.buildStepResult("intent", "completed", {
      content: run.featureBrief,
    });

    // ── Classify project complexity (lightweight LLM call, ~200 tokens) ──
    let classification: ProjectClassification | null = null;
    let tier: ProjectTier = "L";
    try {
      classification = await classifyProject(run.featureBrief);
      tier = classification.tier;
      run.totalCostUsd += classification.costUsd;

      this.emit({
        type: "step_complete",
        runId: run.id,
        stepId: "intent",
        data: {
          ...run.steps.intent,
          metadata: {
            classification: {
              tier: classification.tier,
              type: classification.type,
              needsBackend: classification.needsBackend,
              needsDatabase: classification.needsDatabase,
              reasoning: classification.reasoning,
            },
          },
        },
      });
    } catch {
      tier = "L";
    }

    const plan = stepsForTier(tier);

    // ── PRD (tier-aware prompt) ──
    const pmAgent = new PMAgent(tier);

    let staticPrd = await this.readStaticPrd();
    if (staticPrd === null && fast) {
      const outputDocs = await this.readExistingDocsFromOutput(outputRoot);
      staticPrd = outputDocs.prd;
    }
    if (staticPrd !== null) {
      run = this.applyStaticPrdStep(run, staticPrd);
    } else {
      run = await this.executeStep(run, "prd", () =>
        pmAgent.generatePRD(
          run.featureBrief,
          undefined,
          run.sessionId,
        ),
      );
      if (run.status === "failed") return run;
    }

    run = this.attachPrdSpecGateToPrdStep(run);
    run = await this.attachPrdStructuredSpec(run);
    this.emitPrdStepCompleteRefresh(run);

    const prdContent = run.steps.prd?.content ?? "";

    // Pause after PRD for user review/refinement (HITL gate)
    if (options.pauseAfterPrd) {
      this.emit({
        type: "pipeline_complete",
        runId: run.id,
        stepId: "prd",
        data: {
          status: "completed",
          metadata: {
            pausedAfterPrd: true,
            tier,
            classification: classification
              ? {
                  tier: classification.tier,
                  type: classification.type,
                  reasoning: classification.reasoning,
                }
              : undefined,
          },
        },
      });
      run.status = "completed";
      run.currentStep = null;
      run.updatedAt = new Date().toISOString();
      return run;
    }

    if (fast) {
      const existingDocs = await this.readExistingDocsFromOutput(outputRoot);

      if (plan.needsTrd) {
        run = this.emitStubCompleted(
          run,
          "trd",
          existingDocs.trd || "TRD skipped in quick start.",
          {
            skipped: !existingDocs.trd,
            ...(existingDocs.trd ? { source: "file:TRD.md" } : {}),
          },
        );
      } else {
        run = this.emitStubCompleted(
          run,
          "trd",
          `TRD not required for Tier ${tier} project (${classification?.type ?? "app"}).`,
          { skipped: true, reason: "tier_skip", tier },
        );
      }

      if (plan.needsSysDesign) {
        run = this.emitStubCompleted(
          run,
          "sysdesign",
          existingDocs.sysDesign || "System Design skipped in quick start.",
          {
            skipped: !existingDocs.sysDesign,
            ...(existingDocs.sysDesign
              ? { source: "file:SystemDesign.md" }
              : {}),
          },
        );
      } else {
        run = this.emitStubCompleted(
          run,
          "sysdesign",
          `System Design not required for Tier ${tier} project.`,
          { skipped: true, reason: "tier_skip", tier },
        );
      }

      if (plan.needsImplGuide) {
        run = this.emitStubCompleted(
          run,
          "implguide",
          existingDocs.implGuide ||
            "Implementation Guide skipped in quick start.",
          {
            skipped: !existingDocs.implGuide,
            ...(existingDocs.implGuide
              ? { source: "file:ImpelementGuide.md" }
              : {}),
          },
        );
      } else {
        run = this.emitStubCompleted(
          run,
          "implguide",
          `Implementation Guide not required for Tier ${tier} project.`,
          { skipped: true, reason: "tier_skip", tier },
        );
      }

      const designBody =
        existingDocs.designSpec || (await this.readStaticDesign());
      run = this.emitStubCompleted(run, "design", designBody, {
        skipped: !existingDocs.designSpec,
        source: existingDocs.designSpec
          ? "file:DesignSpec.md"
          : designBody.startsWith("## Design specification (fast mode)")
            ? "fallback-stub"
            : "file:.blueprint/DESIGN.md",
      });
      // Pencil: stubbed in fast mode (step disabled for now)
      run = this.emitStubCompleted(run, "pencil", "Pencil step disabled.", {
        skipped: true,
      });
      // Mockup: stubbed in fast mode (step disabled for now)
      run = this.emitStubCompleted(run, "mockup", "Mockup step disabled.", {
        skipped: true,
      });
    } else {
      if (plan.needsTrd) {
        run = await this.executeStep(run, "trd", () =>
          this.trdAgent.generateTRD(prdContent, undefined, run.sessionId),
        );
        if (run.status === "failed") return run;
      } else {
        run = this.emitStubCompleted(
          run,
          "trd",
          `TRD not required — Tier ${tier} project does not need a separate technical requirements document.`,
          { skipped: true, reason: "tier_skip", tier },
        );
      }

      const trdContent = run.steps.trd?.content ?? "";

      if (plan.needsSysDesign) {
        run = await this.executeStep(run, "sysdesign", () =>
          this.sysDesignAgent.generateSysDesign(
            prdContent,
            trdContent,
            run.sessionId,
          ),
        );
        if (run.status === "failed") return run;
      } else {
        run = this.emitStubCompleted(
          run,
          "sysdesign",
          `System Design not required — Tier ${tier} project uses a straightforward architecture.`,
          { skipped: true, reason: "tier_skip", tier },
        );
      }

      const sysDesignContent = run.steps.sysdesign?.content ?? "";

      if (plan.needsImplGuide) {
        run = await this.executeStep(run, "implguide", () =>
          this.implGuideAgent.generateImplGuide(
            prdContent,
            trdContent,
            sysDesignContent,
            run.sessionId,
          ),
        );
        if (run.status === "failed") return run;
      } else {
        run = this.emitStubCompleted(
          run,
          "implguide",
          `Implementation Guide not required — Tier ${tier} project can be implemented directly from PRD.`,
          { skipped: true, reason: "tier_skip", tier },
        );
      }

      // ── Design Spec (always run) ──
      run = await this.executeStep(run, "design", () =>
        this.designAgent.generateDesign(prdContent, undefined, run.sessionId),
      );
      if (run.status === "failed") return run;

      // ── Pencil (disabled — preserved for future re-enable) ──
      // const designContent = run.steps.design?.content ?? "";
      // run = await this.executeStep(run, "pencil", () =>
      //   this.pencilAgent.generateDesign(
      //     prdContent,
      //     designContent,
      //     this.projectRoot,
      //     run.sessionId,
      //   ),
      // );
      // if (run.status === "failed") return run;
      run = this.emitStubCompleted(run, "pencil", "Pencil step disabled.", {
        skipped: true,
      });
    }

    // ── Mockup (disabled — preserved for future re-enable) ──
    // const designContent = run.steps.design?.content ?? "";
    // const pencilOutput = run.steps.pencil?.content ?? "";
    // if (!fast) {
    //   run = await this.executeStep(run, "mockup", () =>
    //     this.mockupAgent.generateMockup(
    //       designContent,
    //       prdContent,
    //       pencilOutput,
    //       run.sessionId,
    //     ),
    //   );
    //   if (run.status === "failed") return run;
    //   const mockupContent = run.steps.mockup?.content ?? "";
    //   fileMap = MockupAgent.parseFileMap(mockupContent);
    //   if (run.steps.mockup) {
    //     run.steps.mockup.metadata = { fileMap, fileCount: Object.keys(fileMap).length };
    //   }
    // }
    let fileMap: Record<string, string>;
    if (fast) {
      fileMap = this.buildPrdOnlyKickoffFileMap(prdContent);
    } else {
      fileMap = { "PRD.md": prdContent };
    }
    run = this.emitStubCompleted(run, "mockup", "Mockup step disabled.", {
      skipped: true,
      fileMap,
      fileCount: Object.keys(fileMap).length,
    });

    const designSpecContent = run.steps.design?.content ?? "";

    // ── QA ──
    if (fast || !plan.needsQa) {
      run = this.emitStubCompleted(
        run,
        "qa",
        fast
          ? "QA skipped in quick start (assumed passed)."
          : `QA not required for Tier ${tier} project.`,
        { skipped: true, ...(fast ? {} : { reason: "tier_skip", tier }) },
      );
    } else {
      run = await this.executeStep(run, "qa", () =>
        this.qaAgent.generateAudit(
          prdContent,
          designSpecContent,
          run.sessionId,
        ),
      );
      if (run.status === "failed") return run;
      run = this.attachQaCoverageGate(run, prdContent);
    }

    // ── Verify ──
    if (fast || !plan.needsVerify) {
      run = this.emitStubCompleted(
        run,
        "verify",
        fast
          ? "Verification skipped in quick start (assumed passed)."
          : `Verification not required for Tier ${tier} project.`,
        { skipped: true, ...(fast ? {} : { reason: "tier_skip", tier }) },
      );
    } else {
      run = await this.executeStep(run, "verify", () =>
        this.verifierAgent.verifyAlignment(
          prdContent,
          designSpecContent,
          run.sessionId,
        ),
      );
      if (run.status === "failed") return run;
    }

    if (run.status === "failed") return run;

    // ── Kick-off ──
    run = await this.runKickoffStep(run, fileMap, outputRoot, tier);

    if (run.status !== "failed") {
      run.status = "completed";
      run.currentStep = null;
      run.updatedAt = new Date().toISOString();
      this.emit({
        type: "pipeline_complete",
        runId: run.id,
        stepId: "kickoff",
        data: { status: "completed" },
      });
    }

    return run;
  }

  /**
   * Run only the kick-off step with pre-populated steps.
   * Used when parallel generation has already produced the docs.
   */
  async executeKickoffOnly(
    run: PipelineRun,
    outputRoot: string,
  ): Promise<PipelineRun> {
    run.status = "running";
    run.updatedAt = new Date().toISOString();

    const fileMap: Record<string, string> = {};
    if (run.steps.prd?.content) fileMap["PRD.md"] = run.steps.prd.content;
    if (run.steps.trd?.content && !run.steps.trd.metadata?.skipped)
      fileMap["TRD.md"] = run.steps.trd.content;
    if (run.steps.sysdesign?.content && !run.steps.sysdesign.metadata?.skipped)
      fileMap["SystemDesign.md"] = run.steps.sysdesign.content;
    if (run.steps.implguide?.content && !run.steps.implguide.metadata?.skipped)
      fileMap["ImplementationGuide.md"] = run.steps.implguide.content;
    if (run.steps.design?.content && !run.steps.design.metadata?.skipped)
      fileMap["DesignSpec.md"] = run.steps.design.content;
    if (run.steps.pencil?.content && !run.steps.pencil.metadata?.skipped)
      fileMap["PencilDesign.md"] = run.steps.pencil.content;

    if (Object.keys(fileMap).length === 0) {
      fileMap["PRD.md"] = "(empty)";
    }

    const tierFromMeta =
      (
        run.steps.intent?.metadata?.classification as
          | { tier?: ProjectTier }
          | undefined
      )?.tier ?? "L";

    run = await this.runKickoffStep(run, fileMap, outputRoot, tierFromMeta);

    if (run.status !== "failed") {
      run.status = "completed";
      run.currentStep = null;
      run.updatedAt = new Date().toISOString();
      this.emit({
        type: "pipeline_complete",
        runId: run.id,
        stepId: "kickoff",
        data: { status: "completed" },
      });
    }

    return run;
  }

  // ── Kick-off step ──

  private async runKickoffStep(
    run: PipelineRun,
    fileMap: Record<string, string>,
    outputRoot: string,
    tier: ProjectTier = "L",
  ): Promise<PipelineRun> {
    run.currentStep = "kickoff";
    this.emit({
      type: "step_start",
      runId: run.id,
      stepId: "kickoff",
      data: { status: "running" },
    });

    const keys = Object.keys(fileMap);
    if (keys.length === 0) {
      const err =
        "No files to write (empty PRD or missing mockup output) — nothing to write.";
      run.steps.kickoff = this.buildStepResult("kickoff", "failed", {
        error: err,
      });
      run.status = "failed";
      run.updatedAt = new Date().toISOString();
      this.emit({
        type: "step_error",
        runId: run.id,
        stepId: "kickoff",
        data: { error: err, status: "failed" },
      });
      return run;
    }

    try {
      const { written, errors } = await writeCodegenFileMap(
        outputRoot,
        fileMap,
      );

      const prdBody = run.steps.prd?.content ?? "";
      const trdBody = run.steps.trd?.content ?? "";
      const sysDesignBody = run.steps.sysdesign?.content ?? "";
      const implGuideBody = run.steps.implguide?.content ?? "";
      const designSpecBody = run.steps.design?.content ?? "";

      const prdSpec =
        (run.steps.prd?.metadata?.prdSpec as PrdSpec | undefined) ?? null;

      const {
        tasks: taskBreakdown,
        costUsd: tbCost,
        durationMs: tbDuration,
      } = await buildTaskBreakdownFromDocuments({
        prd: prdBody,
        trd: trdBody || undefined,
        sysDesign: sysDesignBody || undefined,
        implGuide: implGuideBody || undefined,
        designSpec: designSpecBody || undefined,
        prdSpec,
        sessionId: run.sessionId,
        tier,
      });

      const { markdown: integrationMd, metadata: integrationMeta } =
        await runKickoffIntegrations({
          runId: run.id,
          sessionId: run.sessionId,
          featureBrief: run.featureBrief,
          codeOutputRoot: outputRoot,
          writtenFiles: written,
          prdExcerpt: prdBody,
        });

      const prdIndexForTasks =
        (run.steps.prd?.metadata?.prdRequirementIndex as
          | PrdRequirementIndex
          | undefined) ?? extractPrdRequirementIndex(prdBody);
      const taskCoverageGate = runTaskCoverageGate(
        prdIndexForTasks,
        taskBreakdown,
      );

      let coverageWarningBlock = "";
      if (!taskCoverageGate.passed && taskCoverageGate.missingIds.length > 0) {
        const missingList = taskCoverageGate.missingIds
          .slice(0, 10)
          .map((id) => `- \`${id}\``)
          .join("\n");
        const moreCount =
          taskCoverageGate.missingIds.length > 10
            ? `\n- ...and ${taskCoverageGate.missingIds.length - 10} more`
            : "";
        coverageWarningBlock = [
          "",
          "### Coverage Gate Warning",
          "",
          `**${taskCoverageGate.missingIds.length}** PRD requirement(s) not referenced by any task:`,
          "",
          missingList + moreCount,
          "",
          "These requirements may not be implemented. Consider adding tasks that reference these IDs,",
          "or verify the task breakdown covers them implicitly.",
        ].join("\n");
      }

      const tbSummary =
        taskBreakdown.length > 0
          ? `Task breakdown generated: **${taskBreakdown.length}** coding tasks (see sub-tab).`
          : "Task breakdown could not be generated from documents.";
      const summary = [
        "## Project kick-off",
        "",
        `Scaffold written to disk. ${tbSummary}`,
        "",
        `### Output\n\n**${written.length}** file(s) → \`${outputRoot}\``,
        "",
        written.length
          ? `#### Files\n\n${written.map((w) => `- \`${w}\``).join("\n")}`
          : "",
        errors.length
          ? `#### Path warnings\n\n${errors.map((e) => `- ${e}`).join("\n")}`
          : "",
        integrationMd,
        coverageWarningBlock,
      ]
        .filter(Boolean)
        .join("\n\n");

      const stepResult = this.buildStepResult("kickoff", "completed", {
        content: summary,
        model: "kickoff",
        costUsd: tbCost,
        durationMs: tbDuration,
        tokenUsage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
        metadata: {
          runId: run.id,
          outputRoot,
          written,
          errors,
          fileCount: written.length,
          integrations: integrationMeta,
          taskBreakdown,
          taskBreakdownSimulated: false,
          taskCoverageGate,
        },
      });

      run.steps.kickoff = stepResult;
      run.updatedAt = new Date().toISOString();

      this.emit({
        type: "step_complete",
        runId: run.id,
        stepId: "kickoff",
        data: stepResult,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      run.steps.kickoff = this.buildStepResult("kickoff", "failed", {
        error: msg,
      });
      run.status = "failed";
      run.updatedAt = new Date().toISOString();
      this.emit({
        type: "step_error",
        runId: run.id,
        stepId: "kickoff",
        data: { error: msg, status: "failed" },
      });
    }

    return run;
  }

  // ── Helpers ──

  /** Appends PRD requirement index + gate report to the PRD step (does not add a new pipeline step). */
  private attachPrdSpecGateToPrdStep(run: PipelineRun): PipelineRun {
    const prd = run.steps.prd;
    if (!prd?.content || prd.status !== "completed") return run;
    const gate = runPrdSpecGate(prd.content);
    run.steps.prd = {
      ...prd,
      metadata: {
        ...prd.metadata,
        prdRequirementIndex: gate.index,
        prdSpecGate: { passed: gate.passed, warnings: gate.warnings },
      },
    };
    return run;
  }

  /**
   * LLM-based structured PRD extraction. Attaches `prdSpec` to `steps.prd.metadata`.
   * Non-blocking — errors are logged but never fail the pipeline.
   */
  private async attachPrdStructuredSpec(run: PipelineRun): Promise<PipelineRun> {
    const prd = run.steps.prd;
    if (!prd?.content || prd.status !== "completed") return run;

    let prdSpec: PrdSpec | null = null;
    try {
      prdSpec = await extractPrdSpec(prd.content, run.sessionId);
    } catch (e) {
      console.warn("[Pipeline] PrdSpec extraction failed:", e instanceof Error ? e.message : e);
    }

    if (!prdSpec) return run;

    run.steps.prd = {
      ...prd,
      metadata: {
        ...prd.metadata,
        prdSpec,
        wireframes: [],
      },
    };
    return run;
  }

  /**
   * Re-emits `step_complete` for PRD so clients receive `prdSpec` and gate metadata
   * (the initial emit happens before async extraction completes).
   */
  private emitPrdStepCompleteRefresh(run: PipelineRun): void {
    const prd = run.steps.prd;
    if (!prd || prd.status !== "completed") return;
    this.emit({
      type: "step_complete",
      runId: run.id,
      stepId: "prd",
      data: prd,
    });
  }

  /** QA coverage gate: compares QA audit text against PRD AC ids (metadata only). */
  private attachQaCoverageGate(
    run: PipelineRun,
    prdContent: string,
  ): PipelineRun {
    const qa = run.steps.qa;
    if (!qa?.content || qa.status !== "completed") return run;
    const prdIndex =
      (run.steps.prd?.metadata?.prdRequirementIndex as
        | PrdRequirementIndex
        | undefined) ?? extractPrdRequirementIndex(prdContent);
    const gate = runQaCoverageGate(prdIndex, qa.content);
    run.steps.qa = {
      ...qa,
      metadata: { ...qa.metadata, qaCoverageGate: gate },
    };
    return run;
  }

  private buildPrdOnlyKickoffFileMap(
    prdContent: string,
  ): Record<string, string> {
    const readme = [
      "# Scaffold",
      "",
      "Generated via Agentic Builder quick path (PRD → kick-off only).",
      "Implement the product from PRD.md.",
      "",
    ].join("\n");
    return {
      "PRD.md": prdContent.trim().length > 0 ? prdContent : "# PRD\n\n(empty)",
      "README.md": readme,
    };
  }

  private emitStubCompleted(
    run: PipelineRun,
    stepId: PipelineStepId,
    content: string,
    metadata?: Record<string, unknown>,
  ): PipelineRun {
    run.currentStep = stepId;
    this.emit({
      type: "step_start",
      runId: run.id,
      stepId,
      data: { status: "running" },
    });

    const isFromFile =
      metadata?.source &&
      typeof metadata.source === "string" &&
      metadata.source.startsWith("file:");
    const stepResult = this.buildStepResult(stepId, "completed", {
      content,
      model: isFromFile
        ? `static:${(metadata!.source as string).replace("file:", "")}`
        : "skipped:quick-start",
      costUsd: 0,
      durationMs: 0,
      tokenUsage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      metadata,
    });

    run.steps[stepId] = stepResult;
    run.updatedAt = new Date().toISOString();

    this.emit({
      type: "step_complete",
      runId: run.id,
      stepId,
      data: stepResult,
    });

    return run;
  }

  private async executeStep(
    run: PipelineRun,
    stepId: PipelineStepId,
    executor: () => Promise<AgentResult>,
  ): Promise<PipelineRun> {
    run.currentStep = stepId;

    this.emit({
      type: "step_start",
      runId: run.id,
      stepId,
      data: { status: "running" },
    });

    try {
      const result = await executor();

      const stepResult = this.buildStepResult(stepId, "completed", {
        content: result.content,
        model: result.model,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        tokenUsage: result.usage,
        traceId: result.traceId,
      });

      run.steps[stepId] = stepResult;
      run.totalCostUsd += result.costUsd;
      run.updatedAt = new Date().toISOString();

      this.emit({
        type: "step_complete",
        runId: run.id,
        stepId,
        data: stepResult,
      });

      return run;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";

      run.steps[stepId] = this.buildStepResult(stepId, "failed", {
        error: errorMsg,
      });
      run.status = "failed";
      run.updatedAt = new Date().toISOString();

      this.emit({
        type: "step_error",
        runId: run.id,
        stepId,
        data: { error: errorMsg, status: "failed" },
      });

      return run;
    }
  }

  private buildStepResult(
    stepId: PipelineStepId,
    status: StepResult["status"],
    partial: Partial<StepResult> = {},
  ): StepResult {
    return {
      stepId,
      status,
      timestamp: new Date().toISOString(),
      ...partial,
    };
  }

  private emit(event: PipelineEvent) {
    this.onEvent?.(event);
  }

  private async readStaticPrd(): Promise<string | null> {
    const abs = path.join(this.projectRoot, STATIC_PRD_RELATIVE_PATH);
    try {
      const raw = await fs.readFile(abs, "utf-8");
      const trimmed = raw.trim();
      return trimmed.length > 0 ? raw : null;
    } catch {
      return null;
    }
  }

  private async readStaticDesign(): Promise<string> {
    const abs = path.join(this.projectRoot, STATIC_DESIGN_RELATIVE_PATH);
    try {
      const raw = await fs.readFile(abs, "utf-8");
      if (raw.trim().length > 0) return raw;
    } catch {
      /* use fallback */
    }
    return FAST_MODE_DESIGN_FALLBACK;
  }

  /**
   * In fast mode, try to read existing document files from the code output directory.
   * Supports common filename variations.
   */
  private async readExistingDocsFromOutput(outputRoot: string): Promise<{
    prd: string | null;
    trd: string | null;
    sysDesign: string | null;
    implGuide: string | null;
    designSpec: string | null;
  }> {
    const tryRead = async (names: string[]): Promise<string | null> => {
      for (const name of names) {
        try {
          const raw = await fs.readFile(path.join(outputRoot, name), "utf-8");
          if (raw.trim().length > 0) return raw;
        } catch {
          /* try next */
        }
      }
      return null;
    };

    const [prd, trd, sysDesign, implGuide, designSpec] = await Promise.all([
      tryRead(["PRD.md", "prd.md"]),
      tryRead(["TRD.md", "trd.md"]),
      tryRead([
        "SystemDesign.md",
        "system-design.md",
        "SysDesign.md",
        "SYSTEM_DESIGN.md",
      ]),
      tryRead([
        "ImpelementGuide.md",
        "ImplementGuide.md",
        "ImplementationGuide.md",
        "impl-guide.md",
        "IMPLEMENTATION_GUIDE.md",
      ]),
      tryRead(["DesignSpec.md", "design-spec.md", "DESIGN.md", "Design.md"]),
    ]);

    return { prd, trd, sysDesign, implGuide, designSpec };
  }

  private applyStaticPrdStep(run: PipelineRun, content: string): PipelineRun {
    run.currentStep = "prd";
    this.emit({
      type: "step_start",
      runId: run.id,
      stepId: "prd",
      data: { status: "running" },
    });

    const stepResult = this.buildStepResult("prd", "completed", {
      content,
      model: "static:.blueprint/PRD.md",
      costUsd: 0,
      durationMs: 0,
      tokenUsage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      metadata: { source: "static-prd-file", path: STATIC_PRD_RELATIVE_PATH },
    });

    run.steps.prd = stepResult;
    run.updatedAt = new Date().toISOString();

    this.emit({
      type: "step_complete",
      runId: run.id,
      stepId: "prd",
      data: stepResult,
    });

    return run;
  }
}
