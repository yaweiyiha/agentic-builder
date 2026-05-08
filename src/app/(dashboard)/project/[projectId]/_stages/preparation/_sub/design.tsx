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
  const runTrd = usePipelineStore((s) => s.runTrd);
  const runPencilWithMcp = usePipelineStore((s) => s.runPencilWithMcp);
  const runStitchGenerate = usePipelineStore((s) => s.runStitchGenerate);
  const stitchResult = usePipelineStore((s) => s.stitchResult);
  const stitchGenerating = usePipelineStore((s) => s.stitchGenerating);
  const stitchError = usePipelineStore((s) => s.stitchError);
  const generateDesignStyles = usePipelineStore((s) => s.generateDesignStyles);
  const selectDesignStyle = usePipelineStore((s) => s.selectDesignStyle);
  const designStyles = usePipelineStore((s) => s.designStyles);
  const designStylesLoading = usePipelineStore((s) => s.designStylesLoading);
  const designStylesPrdHash = usePipelineStore((s) => s.designStylesPrdHash);
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
  // NOTE: hasPencilContent is extended below after stitchPrompt state is declared
  const hasPencilContentBase = !!(pencilContent || isPencilRunning || stitchGenerating);

  // ── Inner tab state ──
  const [innerTab, setInnerTab] = useState<InnerTab>("style");

  // After hydration: always start at "style" so the user goes through the
  // intended flow (Style → Design Spec → Design). Only restore to "spec" if
  // design content already exists — never auto-jump to "pencil".
  const didInitTab = useRef(false);
  useEffect(() => {
    if (!isStageHydrated) return;
    if (didInitTab.current) return;
    didInitTab.current = true;
    if (steps.design?.content) setInnerTab("spec");
    // pencil tab is intentionally not auto-restored so the user always
    // starts from style (or spec) and manually proceeds to Design.
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

  // Auto-generate design styles once PRD is available.
  // Re-generate whenever the PRD content changes (detected via a lightweight hash).
  const stylesGeneratedRef = useRef(false);
  useEffect(() => {
    if (stylesGeneratedRef.current) return;
    const prd = steps.prd?.content ?? "";
    if (!prd.trim()) return;
    if (designStylesLoading) return;
    // Compute a lightweight fingerprint: length + first 100 chars
    const prdHash = `${prd.length}:${prd.slice(0, 100)}`;
    // Skip if styles already exist AND were generated from the same PRD
    if (designStyles !== null && designStylesPrdHash === prdHash) return;
    stylesGeneratedRef.current = true;
    generateDesignStyles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps.prd?.content, designStyles, designStylesPrdHash, designStylesLoading]);

  // ── Stitch state (本地 UI 只保留 promptCopied) ──
  const [promptCopied, setPromptCopied] = useState(false);

  const hasPencilContent = hasPencilContentBase || !!stitchResult || !!stitchError;

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

  const handleGenerateWithStitch = (instruction?: string) => {
    if (!selectedDesignStyleId) {
      console.warn("[DesignSubStage] ⚠ No selectedDesignStyleId — aborting stitch generation");
      return;
    }
    runStitchGenerate(instruction);
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
                    disabled={!selectedDesignStyleId || isDesignRunning}
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
            {/* ── Stitch generating ── */}
            {stitchGenerating && (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <SpinnerIcon size={32} />
                <div className="text-center">
                  <p className="text-[14px] font-semibold text-slate-800">Generating with Stitch…</p>
                  <p className="text-[12px] text-slate-400 mt-1">This may take a minute. Stitch is creating your UI design.</p>
                </div>
              </div>
            )}

            {/* ── Stitch error ── */}
            {!stitchGenerating && stitchError && (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div className="text-center max-w-sm">
                  <p className="text-[13px] font-semibold text-red-600">Stitch generation failed</p>
                  <p className="text-[12px] text-slate-500 mt-1 break-all">{stitchError}</p>
                </div>
                <button
                  onClick={() => handleGenerateWithStitch()}
                  disabled={!selectedDesignStyleId}
                  className="mt-2 px-4 py-2 text-[12px] font-medium text-white bg-[#712ae2] rounded-lg hover:bg-[#6b24da] transition-colors disabled:opacity-40"
                >
                  Retry
                </button>
              </div>
            )}

            {/* ── Stitch result ── */}
            {!stitchGenerating && stitchResult && (
              <div className="flex flex-col h-full">
                {/* Result header */}
                <div className="shrink-0 flex items-center gap-3 px-5 py-3 bg-violet-50 border-b border-violet-100">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-violet-700">Stitch Design Generated</p>
                    <p className="text-[11px] text-violet-500 font-mono truncate">{stitchResult.projectUrl}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(stitchResult.projectUrl).then(() => {
                          setPromptCopied(true);
                          setTimeout(() => setPromptCopied(false), 2000);
                        });
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-violet-700 bg-white border border-violet-200 rounded-md hover:bg-violet-50 transition-colors"
                    >
                      {promptCopied ? "Copied!" : "Copy URL"}
                    </button>
                    <a
                      href={stitchResult.projectUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-white bg-violet-600 rounded-md hover:bg-violet-700 transition-colors"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      Open in Stitch
                    </a>
                  </div>
                </div>

                {/* Screenshot preview */}
                <div className="flex-1 overflow-auto flex items-start justify-center p-6">
                  {stitchResult.screenshotUrl ? (
                    <div className="flex flex-col items-center gap-4 max-w-4xl w-full">
                      <img
                        src={stitchResult.screenshotUrl}
                        alt="Stitch generated UI design"
                        className="w-full rounded-xl border border-slate-200 shadow-lg"
                      />
                      <div className="flex items-center gap-3 text-[12px] text-slate-500">
                        <span>Project ID: <code className="font-mono text-violet-700">{stitchResult.projectId}</code></span>
                        <span>·</span>
                        <span>Screen ID: <code className="font-mono text-violet-700">{stitchResult.screenId}</code></span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-6 w-full max-w-lg mx-auto py-8">
                      {/* Card */}
                      <div className="w-full rounded-2xl border border-slate-200 bg-linear-to-br from-violet-50 to-slate-50 shadow-md overflow-hidden">
                        {/* Header bar */}
                        <div className="flex items-center gap-2 px-4 py-3 bg-white border-b border-slate-100">
                          <div className="flex gap-1.5">
                            <span className="w-3 h-3 rounded-full bg-red-400" />
                            <span className="w-3 h-3 rounded-full bg-yellow-400" />
                            <span className="w-3 h-3 rounded-full bg-green-400" />
                          </div>
                          <span className="text-[11px] text-slate-400 font-mono truncate flex-1 text-center pr-6">
                            stitch.withgoogle.com/projects/{stitchResult.projectId}
                          </span>
                        </div>
                        {/* Body */}
                        <div className="flex flex-col items-center gap-5 px-8 py-10">
                          <div className="w-16 h-16 rounded-2xl bg-violet-100 flex items-center justify-center shadow-inner">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="3" width="18" height="18" rx="2" />
                              <path d="M3 9h18M9 21V9" />
                            </svg>
                          </div>
                          <div className="text-center">
                            <p className="text-[15px] font-semibold text-slate-800">设计已生成</p>
                            <p className="text-[12px] text-slate-500 mt-1">Stitch 不允许嵌入预览，请在新标签页中查看完整设计</p>
                          </div>
                          <a
                            href={stitchResult.projectUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-medium transition-colors shadow"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                              <polyline points="15 3 21 3 21 9" />
                              <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                            在 Stitch 中打开
                          </a>
                          <div className="flex items-center gap-3 text-[11px] text-slate-400">
                            <span>Project: <code className="font-mono text-violet-600">{stitchResult.projectId}</code></span>
                            {stitchResult.screenId && (<><span>·</span><span>Screen: <code className="font-mono text-violet-600">{stitchResult.screenId}</code></span></>)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Legacy pencil content ── */}
            {!stitchGenerating && !stitchResult && !stitchError && !isPencilRunning && pencilContent ? (
              <div className="p-6 max-w-4xl mx-auto">
                <MarkdownRenderer content={pencilContent} />
              </div>
            ) : !stitchGenerating && !stitchResult && !stitchError && isPencilRunning ? (
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
            ) : !stitchGenerating && !stitchResult && !stitchError && !isPencilRunning && !pencilContent ? (
              <div className="flex items-center justify-center h-full text-slate-400">
                <p className="text-sm">Waiting for design to generate…</p>
              </div>
            ) : null}
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
                setSpecInput("");
                handleGenerateWithStitch(instruction || undefined);
              }}
              disabled={
                !selectedDesignStyleId || !steps.design?.content || isRunning
              }
              className="flex items-center gap-2 shrink-0 px-4 py-2.5 bg-[#712ae2] text-white text-[13px] font-semibold rounded-full hover:bg-[#6b24da] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              title="Generate design via Google Stitch"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              Generate with Stitch
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
            handleGenerateWithStitch(instruction);
          }}
          placeholder="Describe changes — a new Stitch prompt will be built…"
          disabled={isPencilRunning || isDesignRunning}
          actions={
            <button
              onClick={() => {
                runTrd();
                goToSubStage("trd", "preparation");
              }}
              disabled={isRunning}
              className="flex items-center gap-2 shrink-0 px-4 py-2.5 bg-[#712ae2] text-white text-[13px] font-semibold rounded-full hover:bg-[#6b24da] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              title="Generate TRD and proceed to next step"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M5 12h14" />
                <path d="M12 5l7 7-7 7" />
              </svg>
              Next Step
            </button>
          }
        />
      )}
    </div>
  );
}
