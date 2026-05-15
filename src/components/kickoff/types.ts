/**
 * Shared types for the split kickoff views.
 *
 * `KickoffStepData` is the shape returned by `useKickoffStepData()` — all
 * state, computed values, and handlers needed by both summary and tasks
 * views. Both views accept it as a prop so the wrapper (KickoffStepPanel)
 * can compute it once and share, while standalone sub-stages compute it
 * independently.
 */

import type { Dispatch, SetStateAction } from "react";
import type { KickoffWorkItem } from "@/lib/pipeline/types";
import type { SessionCheckpoint } from "@/lib/pipeline/session-checkpoint";

export type TaskBreakdownReviewSuggestion = {
  id: string;
  title: string;
  reason: string;
  instruction: string;
  severity: "high" | "medium" | "low";
};

export interface KickoffStepData {
  // ─── Parsed from result.metadata ───
  tasks: KickoffWorkItem[];
  taskBreakdownConfirmed: boolean;
  parseFailed: boolean;
  parseError: string;
  rawTaskBreakdownOutput: string;
  reviewSuggestions: TaskBreakdownReviewSuggestion[];

  // ─── Derived stats ───
  totalHours: number;
  aiHours: number;
  humanHours: number;
  totalTokens: number;
  totalCost: number;
  phases: string[];
  priorities: { P0: number; P1: number; P2: number };

  // ─── Failure-tasks retry support ───
  checkpoint: SessionCheckpoint | null;
  matchingFailedIds: string[];
  hasFailedTasks: boolean;

  // ─── Pipeline runtime state (read-only mirrors) ───
  codingStatus: string;
  isRunning: boolean;
  currentStep: string | null;
  codeOutputDir: string;

  // ─── Local UI state ───
  retryingBreakdown: boolean;
  retryBreakdownError: string | null;
  reviewingBreakdown: boolean;
  reviewBreakdownError: string | null;
  regeneratingWithSuggestions: boolean;
  selectedSuggestionIds: string[];
  setSelectedSuggestionIds: Dispatch<SetStateAction<string[]>>;

  // ─── Action handlers ───
  handleConfirmAndCode: () => void;
  handleRetryFailed: () => void;
  handleRetryKickoffBreakdown: () => Promise<void>;
  handleAnalyzeTaskBreakdown: () => Promise<void>;
  handleRegenerateWithSelectedSuggestions: () => Promise<void>;
  handleConfirmTaskBreakdown: () => void;
}
