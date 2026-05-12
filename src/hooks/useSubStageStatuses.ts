"use client";

import { usePipelineStore } from "@/store/pipeline-store";
import { useCodingStore } from "@/store/coding-store";
import {
  type StageId,
  type SubStageId,
  type StageStatus,
  type PreparationSubStageId,
  type KickoffSubStageId,
  type CodingSubStageId,
  type PreviewSubStageId,
  SUB_STAGE_ORDER,
} from "@/store/stage-store";
import type { PipelineStepId } from "@/lib/pipeline/types";

/**
 * Derives the status of every sub-stage by reading pipeline-store and
 * coding-store — pure selectors, zero extra state.
 *
 * Status rules per group:
 *
 * preparation
 *   "initial"      → idle until pipeline starts; completed once any prep step runs
 *   rest           → mirrors pipeline step status (running → active, completed, failed → error)
 *
 * kickoff
 *   "env-setup"    → active while kickoff step is running; completed when kickoff completes
 *   "task-breakdown" → active/completed based on metadata presence in kickoff result
 *
 * coding
 *   maps to coding agent roles: architect / backend / frontend / test / verify
 *   derived from coding-store tasks + integrationVerify
 *
 * preview
 *   "serve"  → always active/idle (no strong signal; user-driven)
 *   "e2e"    → maps to coding-store e2eVerify
 */
export function useSubStageStatuses(): Record<SubStageId, StageStatus> {
  const steps             = usePipelineStore((s) => s.steps);
  const isPipelineRunning = usePipelineStore((s) => s.isRunning);
  const currentStep       = usePipelineStore((s) => s.currentStep);
  const codingStatus      = useCodingStore((s) => s.status);
  const integrationVerify = useCodingStore((s) => s.integrationVerify);
  const e2eVerify         = useCodingStore((s) => s.e2eVerify);

  // ── Preparation sub-stages ────────────────────────────────────────────────

  const prepPipelineIds = ["intent", "prd", "trd", "sysdesign", "implguide", "design", "pencil", "mockup", "qa"] as PipelineStepId[];

  function prepStatus(subId: PreparationSubStageId): StageStatus {
    if (subId === "initial") {
      // "initial" is the prompt screen; once any prep step is touched it's done
      const anyStarted = prepPipelineIds.some((id) => steps[id] != null);
      return anyStarted ? "completed" : "idle";
    }
    const step = steps[subId as PipelineStepId];
    if (!step) return "idle";
    if (step.status === "completed") return "completed";
    if (step.status === "failed")    return "error";
    if (step.status === "running" || (isPipelineRunning && currentStep === subId)) return "active";
    return "idle";
  }

  // ── Kickoff sub-stages ────────────────────────────────────────────────────

  function kickoffStatus(subId: KickoffSubStageId): StageStatus {
    const step = steps.kickoff;
    if (!step) return "idle";

    if (subId === "env-setup" || subId === "summary") {
      if (step.status === "running") return "active";
      if (step.status === "completed") return "completed";
      if (step.status === "failed") return "error";
      return "idle";
    }

    if (subId === "task-breakdown") {
      // task breakdown is available once kickoff has metadata
      if (step.status === "failed") return "error";
      if (step.status === "completed" && step.metadata) return "completed";
      if (step.status === "running") return "active";
      return "idle";
    }

    return "idle";
  }

  // ── Coding sub-stages ─────────────────────────────────────────────────────

  function codingSubStatus(subId: CodingSubStageId): StageStatus {
    if (subId === "verify") {
      if (!integrationVerify) return "idle";
      if (integrationVerify.status === "passed")  return "completed";
      if (integrationVerify.status === "failed")  return "error";
      if (integrationVerify.status === "verifying" || integrationVerify.status === "fixing") return "active";
      return "idle";
    }

    // Map sub-stage → agent role, then inspect CodingAgentInstance (not tasks)
    const roleMap: Record<Exclude<CodingSubStageId, "verify">, string> = {
      architect: "architect",
      backend:   "backend",
      frontend:  "frontend",
      test:      "test",
    };
    const role = roleMap[subId as Exclude<CodingSubStageId, "verify">];
    // Use agents list which has per-role status
    const agents = useCodingStore.getState().agents;
    const agent = agents.find((a) => a.role === role);

    if (!agent) return "idle";
    if (agent.status === "completed") return "completed";
    if (agent.status === "failed")    return "error";
    if (agent.status === "working")   return "active";
    return "idle";
  }

  // ── Preview sub-stages ────────────────────────────────────────────────────

  function previewSubStatus(subId: PreviewSubStageId): StageStatus {
    if (subId === "serve") {
      // Dev server is user-driven; mark active when coding is done
      return codingStatus === "completed" ? "active" : "idle";
    }
    if (subId === "e2e") {
      if (!e2eVerify) return "idle";
      if (e2eVerify.status === "passed")  return "completed";
      if (e2eVerify.status === "failed")  return "error";
      if (e2eVerify.status === "verifying" || e2eVerify.status === "fixing") return "active";
      return "idle";
    }
    return "idle";
  }

  // ── Assemble all ─────────────────────────────────────────────────────────

  const result = {} as Record<SubStageId, StageStatus>;

  for (const s of SUB_STAGE_ORDER.preparation as PreparationSubStageId[]) {
    result[s] = prepStatus(s);
  }
  for (const s of SUB_STAGE_ORDER.kickoff as KickoffSubStageId[]) {
    result[s] = kickoffStatus(s);
  }
  for (const s of SUB_STAGE_ORDER.coding as CodingSubStageId[]) {
    result[s] = codingSubStatus(s);
  }
  for (const s of SUB_STAGE_ORDER.preview as PreviewSubStageId[]) {
    result[s] = previewSubStatus(s);
  }

  return result;
}

// ─── Convenience: sub-stage statuses for a single stage ──────────────────────

export function useSubStageStatusesForStage(
  stageId: StageId,
): Record<string, StageStatus> {
  const all = useSubStageStatuses();
  const ids = SUB_STAGE_ORDER[stageId];
  const out: Record<string, StageStatus> = {};
  for (const id of ids) out[id] = all[id];
  return out;
}
