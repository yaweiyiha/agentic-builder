"use client";

import React, { useEffect, useRef, useState } from "react";
import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import StageInputBar from "@/components/StageInputBar";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import DesignStyleCard from "@/components/DesignStyleCard";

type DocTab = "prd" | "design" | "trd" | "qa";
type InnerTab = "style" | "spec" | "pencil";

const DOC_TABS: { id: DocTab; label: string }[] = [
  { id: "prd", label: "PRD" },
  { id: "design", label: "Design Document" },
  { id: "trd", label: "Technical Specs" },
  { id: "qa", label: "QA Plan" },
];

const INNER_TABS: { id: InnerTab; label: string }[] = [
  { id: "style", label: "Style" },
  { id: "spec", label: "Design Spec" },
  { id: "pencil", label: "Design" },
];

function CheckCircleIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

function SpinnerIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="animate-spin"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function PencilIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DesignSubStage() {
  const steps = usePipelineStore((s) => s.steps);
  const streamingContent = usePipelineStore((s) => s.streamingContent);
  const currentStep = usePipelineStore((s) => s.currentStep);
  const isRunning = usePipelineStore((s) => s.isRunning);
  const runDesignDoc = usePipelineStore((s) => s.runDesignDoc);
  const runPencilWithMcp = usePipelineStore((s) => s.runPencilWithMcp);
  const generateDesignStyles = usePipelineStore((s) => s.generateDesignStyles);
  const selectDesignStyle = usePipelineStore((s) => s.selectDesignStyle);
  const designStyles = usePipelineStore((s) => s.designStyles);
  const designStylesLoading = usePipelineStore((s) => s.designStylesLoading);
  const selectedDesignStyleId = usePipelineStore(
    (s) => s.selectedDesignStyleId,
  );
  const saveSubStageSnapshot = usePipelineStore(
    (s) => s.saveSubStageSnapshotForSubStage,
  );
  const goToSubStage = useStageStore((s) => s.goToSubStage);
  const isStageHydrated = useStageStore((s) => s.isStageHydrated);

  // ── Derived step state ──
  const prdContent = steps.prd?.content ?? "";
  const isDesignRunning = isRunning && currentStep === "design";
  const isPencilRunning = isRunning && currentStep === "pencil";

  const designContent = isDesignRunning
    ? streamingContent
    : (steps.design?.content ?? "");
  const pencilContent = isPencilRunning
    ? streamingContent
    : (steps.pencil?.content ?? "");

  const isDesignDone = steps.design?.status === "completed";
  const isPencilDone = steps.pencil?.status === "completed";

  const hasDesignContent = !!(designContent || isDesignRunning);
  const hasPencilContent = !!(pencilContent || isPencilRunning);

  // ── Inner tab state ──
  const [innerTab, setInnerTab] = useState<InnerTab>("style");

  // After hydration: default to deepest available tab
  const didInitTab = useRef(false);
  useEffect(() => {
    if (!isStageHydrated) return;
    if (didInitTab.current) return;
    didInitTab.current = true;
    if (steps.pencil?.content) setInnerTab("pencil");
    else if (steps.design?.content) setInnerTab("spec");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStageHydrated]);

  // Auto-advance to spec tab when design doc finishes
  const prevDesignRunning = useRef(isDesignRunning);
  useEffect(() => {
    if (prevDesignRunning.current && !isDesignRunning && isDesignDone) {
      setInnerTab("spec");
    }
    prevDesignRunning.current = isDesignRunning;
  }, [isDesignRunning, isDesignDone]);

  // Auto-advance to pencil tab when pencil doc finishes
  const prevPencilRunning = useRef(isPencilRunning);
  useEffect(() => {
    if (prevPencilRunning.current && !isPencilRunning && isPencilDone) {
      setInnerTab("pencil");
    }
    prevPencilRunning.current = isPencilRunning;
  }, [isPencilRunning, isPencilDone]);

  // Eager snapshot on mount
  const didEagerSave = useRef(false);
  useEffect(() => {
    if (!isStageHydrated) return;
    if (didEagerSave.current) return;
    if (!prdContent.trim()) return;
    didEagerSave.current = true;
    saveSubStageSnapshot("preparation", "design");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStageHydrated, prdContent]);

  // Auto-generate design styles once PRD is available
  const stylesGeneratedRef = useRef(false);
  useEffect(() => {
    if (stylesGeneratedRef.current) return;
    const prd = steps.prd?.content ?? "";
    if (!prd.trim()) return;
    if (designStyles !== null) return;
    if (designStylesLoading) return;
    stylesGeneratedRef.current = true;
    generateDesignStyles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps.prd?.content, designStyles, designStylesLoading]);

  // ── Input state ──
  const [specInput, setSpecInput] = useState("");
  const [pencilInput, setPencilInput] = useState("");

  // ── Handlers ──
  const handleOuterTabChange = (tab: DocTab) => {
    if (tab !== "design") {
      goToSubStage(tab, "preparation");
    }
  };

  const handleGenerateDesignDoc = () => {
    runDesignDoc();
    setInnerTab("spec");
  };

  const handleGeneratePencilDesign = (instruction?: string) => {
    console.log("[DesignSubStage] handleGeneratePencilDesign called", {
      selectedDesignStyleId,
      hasDesignContent: !!steps.design?.content,
      isRunning,
      instruction,
    });
    if (!selectedDesignStyleId) {
      console.warn("[DesignSubStage] ⚠ No selectedDesignStyleId — aborting pencil generation");
      return;
    }
    runPencilWithMcp(instruction);
    setInnerTab("pencil");
  };

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden">
      {/* ── Outer Document Tab Bar ── */}
      <div className="shrink-0 bg-white border-b border-[#e2e8f0] flex items-center px-8">
        <div className="flex gap-8">
          {DOC_TABS.map((tab) => {
            const isActive = tab.id === "design";
            return (
              <button
                key={tab.id}
                onClick={() => handleOuterTabChange(tab.id)}
                className={[
                  "relative flex items-center gap-2 py-4.25 text-[14px] font-semibold transition-colors",
                  isActive
                    ? "text-[#712ae2] border-b-2 border-[#712ae2]"
                    : "text-[#94a3b8] hover:text-[#64748b]",
                ].join(" ")}
              >
                <span>{tab.label}</span>
                {tab.id === "design" && isDesignDone && (
                  <span className="text-[#712ae2]">
                    <CheckCircleIcon size={15} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Inner Tab Bar (Style / Design Spec / Design) ── */}
      <div className="shrink-0 bg-slate-50 border-b border-[#e2e8f0] flex items-center justify-between px-8">
        <div className="flex gap-6">
          {INNER_TABS.map((tab) => {
            const isActive = innerTab === tab.id;
            const isDisabled =
              (tab.id === "spec" && !hasDesignContent) ||
              (tab.id === "pencil" && !hasPencilContent);

            return (
              <button
                key={tab.id}
                onClick={() => !isDisabled && setInnerTab(tab.id)}
                disabled={isDisabled}
                className={[
                  "relative flex items-center gap-1.5 py-3 text-[13px] font-medium transition-colors",
                  isActive
                    ? "text-[#712ae2] border-b-2 border-[#712ae2]"
                    : isDisabled
                      ? "text-slate-300 cursor-not-allowed"
                      : "text-slate-500 hover:text-slate-700",
                ].join(" ")}
              >
                {tab.label}
                {tab.id === "spec" && isDesignDone && (
                  <span className="text-emerald-500">
                    <CheckCircleIcon size={12} />
                  </span>
                )}
                {tab.id === "spec" && isDesignRunning && (
                  <SpinnerIcon size={11} />
                )}
                {tab.id === "pencil" && isPencilDone && (
                  <span className="text-emerald-500">
                    <CheckCircleIcon size={12} />
                  </span>
                )}
                {tab.id === "pencil" && isPencilRunning && (
                  <SpinnerIcon size={11} />
                )}
              </button>
            );
          })}
        </div>

        {/* Regenerate Styles — only on Style tab */}
        {innerTab === "style" && (
          <button
            onClick={() => generateDesignStyles()}
            disabled={designStylesLoading}
            title="Regenerate Design Styles"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 hover:text-slate-900 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={designStylesLoading ? "animate-spin" : ""}
              aria-hidden
            >
              <path d="M21 2v6h-6" />
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M3 22v-6h6" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
            {designStylesLoading ? "Regenerating…" : "Regenerate Styles"}
          </button>
        )}
      </div>

      {/* ── Main Content Area ── */}
      <div className="flex-1 overflow-y-auto">

        {/* ══ Style Tab ══ */}
        {innerTab === "style" && (
          <>
            {designStylesLoading && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center flex flex-col items-center gap-3">
                  <SpinnerIcon size={32} />
                  <p className="text-slate-600 font-medium">
                    Analyzing PRD and generating design styles…
                  </p>
                </div>
              </div>
            )}

            {!designStylesLoading && designStyles && (
              <div className="p-8 flex flex-col gap-8">
                <div>
                  <h2 className="text-[22px] font-bold text-slate-900 mb-1">
                    Choose a Design Style
                  </h2>
                  <p className="text-slate-500 text-[13px]">
                    Select the style that best fits your product vision. Each
                    style defines colors, typography, and component patterns.
                  </p>
                </div>

                {/* Cards */}
                <div className="flex gap-5 overflow-x-auto pb-2">
                  {designStyles.map((style) => (
                    <div key={style.id} className="shrink-0 w-60">
                      <DesignStyleCard
                        style={style}
                        isSelected={selectedDesignStyleId === style.id}
                        onSelect={selectDesignStyle}
                      />
                    </div>
                  ))}
                </div>

                {/* Generate Design Spec — below all cards */}
                <div className="flex flex-col items-center gap-3 pt-4 border-t border-slate-100">
                  {!selectedDesignStyleId && (
                    <p className="text-slate-400 text-[13px]">
                      Select a style above to proceed
                    </p>
                  )}
                  <button
                    onClick={handleGenerateDesignDoc}
                    disabled={!selectedDesignStyleId || isRunning}
                    className="flex items-center gap-2 px-6 py-3 bg-[#712ae2] text-white text-[14px] font-bold rounded-lg hover:bg-[#6b24da] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isDesignRunning ? (
                      <SpinnerIcon size={15} />
                    ) : (
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    )}
                    {isDesignRunning
                      ? "Generating Design Spec…"
                      : isDesignDone
                        ? "Regenerate Design Spec"
                        : "Generate Design Spec"}
                  </button>
                </div>
              </div>
            )}

            {!designStylesLoading && !designStyles && (
              <div className="flex items-center justify-center h-full text-slate-400">
                <p className="text-sm">Waiting for PRD to generate styles…</p>
              </div>
            )}
          </>
        )}

        {/* ══ Design Spec Tab ══ */}
        {innerTab === "spec" && (
          <>
            {designContent ? (
              <div className="p-6 max-w-4xl mx-auto">
                <MarkdownRenderer content={designContent} />
              </div>
            ) : isDesignRunning ? (
              <div className="flex items-center justify-center py-20 gap-2 text-[#712ae2] text-[13px]">
                <SpinnerIcon size={14} />
                Generating Design Spec…
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-slate-400">
                <p className="text-sm">Waiting for design spec to generate…</p>
              </div>
            )}
          </>
        )}

        {/* ══ Pencil Design Tab ══ */}
        {innerTab === "pencil" && (
          <>
            {/* Completed: show final markdown content */}
            {!isPencilRunning && pencilContent ? (
              <div className="p-6 max-w-4xl mx-auto">
                <MarkdownRenderer content={pencilContent} />
              </div>
            ) : isPencilRunning ? (
              // Live MCP session: show progress feed
              <div className="p-6 max-w-2xl mx-auto flex flex-col gap-4">
                <div className="flex items-center gap-2 text-[#712ae2] text-[13px] font-medium">
                  <SpinnerIcon size={14} />
                  Running Pencil MCP session…
                </div>
                {pencilContent && (
                  <div className="flex flex-col gap-2">
                    {pencilContent.split("\n\n---\n\n").filter(Boolean).map((msg, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 text-[12px] text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2"
                      >
                        <span className="text-emerald-500 mt-0.5 shrink-0">▸</span>
                        <span className="leading-relaxed">{msg}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-slate-400">
                <p className="text-sm">Waiting for pencil design to generate…</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── StageInputBar — Design Spec tab ── */}
      {innerTab === "spec" && (
        <StageInputBar
          value={specInput}
          onChange={setSpecInput}
          onSubmit={() => {
            const instruction = specInput.trim();
            if (!instruction || isDesignRunning) return;
            setSpecInput("");
            runDesignDoc(instruction);
          }}
          placeholder="Ask AgenticBuilder to revise the design spec…"
          disabled={isDesignRunning || isPencilRunning}
          actions={
            <button
              onClick={() => {
                const instruction = specInput.trim();
                console.log("[DesignSubStage] Generate Design button clicked", {
                  selectedDesignStyleId,
                  hasDesignContent: !!steps.design?.content,
                  isRunning,
                  instruction,
                });
                setSpecInput("");
                handleGeneratePencilDesign(instruction || undefined);
              }}
              disabled={
                !selectedDesignStyleId || !steps.design?.content || isRunning
              }
              className="flex items-center gap-2 shrink-0 px-4 py-2.5 bg-[#712ae2] text-white text-[13px] font-semibold rounded-full hover:bg-[#6b24da] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              title="Generate Pencil Design from current Design Spec"
            >
              <PencilIcon size={13} />
              Generate Design
            </button>
          }
        />
      )}

      {/* ── StageInputBar — Pencil Design tab ── */}
      {innerTab === "pencil" && (
        <StageInputBar
          value={pencilInput}
          onChange={setPencilInput}
          onSubmit={() => {
            const instruction = pencilInput.trim();
            if (!instruction || isPencilRunning) return;
            setPencilInput("");
            handleGeneratePencilDesign(instruction);
          }}
          placeholder="Ask AgenticBuilder to revise the pencil design…"
          disabled={isPencilRunning || isDesignRunning}
          actions={
            <button
              onClick={() => handleGeneratePencilDesign()}
              disabled={!selectedDesignStyleId || isRunning}
              className="flex items-center gap-2 shrink-0 px-4 py-2.5 bg-[#712ae2] text-white text-[13px] font-semibold rounded-full hover:bg-[#6b24da] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              title="Regenerate Pencil Design"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M21 2v6h-6" />
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M3 22v-6h6" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
              </svg>
              Regenerate
            </button>
          }
        />
      )}
    </div>
  );
}
