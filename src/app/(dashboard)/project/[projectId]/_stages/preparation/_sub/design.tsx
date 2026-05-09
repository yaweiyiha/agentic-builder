"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import StageInputBar from "@/components/StageInputBar";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import DesignStyleCard from "@/components/DesignStyleCard";
import Loading from "@/components/Loading";

type DocTab = "prd" | "design" | "trd" | "qa";
type InnerTab = "style" | "spec" | "stitch";

const DOC_TABS: { id: DocTab; label: string }[] = [
  { id: "prd", label: "PRD" },
  { id: "design", label: "Design Document" },
  { id: "trd", label: "Technical Specs" },
  { id: "qa", label: "QA Plan" },
];

const INNER_TABS: { id: InnerTab; label: string }[] = [
  { id: "style", label: "Style" },
  { id: "spec", label: "Design Spec" },
  { id: "stitch", label: "Design" },
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

// ─── Style Carousel ──────────────────────────────────────────────────────────

import type { DesignStyle } from "@/components/DesignStyleCard";

// Each slot: offset from center → visual properties
const SLOTS: Record<
  number,
  { x: string; scale: number; opacity: number; z: number }
> = {
  [-2]: { x: "-148%", scale: 0.62, opacity: 0.28, z: 0 },
  [-1]: { x: "-88%", scale: 0.78, opacity: 0.58, z: 1 },
  [0]: { x: "0%", scale: 1.0, opacity: 1.0, z: 3 },
  [1]: { x: "88%", scale: 0.78, opacity: 0.58, z: 1 },
  [2]: { x: "148%", scale: 0.62, opacity: 0.28, z: 0 },
};

/** Shortest circular distance from active to idx */
function circOffset(idx: number, active: number, total: number) {
  let d = idx - active;
  if (d > total / 2) d -= total;
  if (d < -total / 2) d += total;
  return d;
}

function StyleCarousel({
  styles,
  selectedId,
  onSelect,
}: {
  styles: DesignStyle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const total = styles.length;
  const initIdx = Math.max(
    0,
    styles.findIndex((s) => s.id === selectedId),
  );
  const [active, setActive] = useState(initIdx);

  useEffect(() => {
    const idx = styles.findIndex((s) => s.id === selectedId);
    if (idx >= 0 && idx !== active) setActive(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const goTo = useCallback(
    (idx: number) => {
      setActive(idx);
      onSelect(styles[idx].id);
    },
    [styles, onSelect],
  );

  const prev = () => goTo((active - 1 + total) % total);
  const next = () => goTo((active + 1) % total);

  if (total === 0) return null;

  return (
    <div className="flex flex-col items-center gap-4 select-none">
      <div
        className="relative w-full flex items-center justify-center"
        style={{ height: 290 }}
      >
        {/* Left arrow */}
        <button
          onClick={prev}
          className="absolute left-2 z-20 flex items-center justify-center w-8 h-8 rounded-full bg-white border border-slate-200 shadow-md hover:bg-slate-50 hover:border-[#712ae2] transition-all"
          aria-label="Previous style"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* Cards — keyed by data index for stable DOM + correct directional animation */}
        <div className="relative w-44" style={{ height: 290 }}>
          {styles.map((style, idx) => {
            const offset = circOffset(idx, active, total);
            const slot = SLOTS[offset];
            const isCenter = offset === 0;

            // Cards beyond ±2 are pushed fully off-screen (no visible jump)
            const x = slot ? slot.x : offset < 0 ? "-260%" : "260%";
            const scale = slot ? slot.scale : 0.5;
            const opacity = slot ? slot.opacity : 0;
            const z = slot ? slot.z : 0;

            return (
              <div
                key={idx}
                onClick={() => {
                  if (!isCenter && slot) goTo(idx);
                }}
                style={{
                  position: "absolute",
                  inset: 0,
                  transform: `translateX(${x}) scale(${scale})`,
                  opacity,
                  zIndex: z,
                  transition:
                    "transform 0.36s cubic-bezier(0.4,0,0.2,1), opacity 0.36s ease",
                  cursor: isCenter ? "default" : slot ? "pointer" : "default",
                  transformOrigin: "center center",
                  pointerEvents: slot ? "auto" : "none",
                }}
              >
                <div className="flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden w-full h-full shadow-sm">
                  {/* Color swatches */}
                  <div className="flex h-14 shrink-0">
                    {(
                      ["primary", "secondary", "tertiary", "neutral"] as const
                    ).map((key) => (
                      <div
                        key={key}
                        className="flex-1"
                        style={{ backgroundColor: style.colors[key] }}
                      />
                    ))}
                  </div>
                  {/* Body */}
                  <div className="p-2.5 flex flex-col gap-1.5 flex-1 min-h-0">
                    <div className="flex items-center justify-between gap-1">
                      <h3 className="text-[12px] font-bold text-slate-900 truncate">
                        {style.name}
                      </h3>
                      {isCenter && (
                        <span className="text-[8px] font-bold text-[#712ae2] bg-[rgba(113,42,226,0.08)] px-1.5 py-0.5 rounded-full shrink-0">
                          Selected
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed line-clamp-2">
                      {style.description}
                    </p>
                    <div className="flex items-center gap-2 pt-1.5 border-t border-slate-100 mt-auto">
                      <span
                        className="text-[22px] font-bold leading-none shrink-0"
                        style={{
                          color: style.colors.primary,
                          fontFamily: style.typography.headlineFont,
                        }}
                      >
                        Aa
                      </span>
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-[9px] text-slate-500 truncate">
                          {style.typography.headlineFont}
                        </span>
                        <span className="text-[9px] text-slate-400 truncate">
                          {style.typography.bodyFont}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div
                        className="text-[9px] font-semibold text-white px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: style.colors.primary }}
                      >
                        Primary
                      </div>
                      <div
                        className="text-[9px] font-semibold px-1.5 py-0.5 rounded border"
                        style={{
                          color: style.colors.secondary,
                          borderColor: style.colors.secondary,
                        }}
                      >
                        Outlined
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right arrow */}
        <button
          onClick={next}
          className="absolute right-2 z-20 flex items-center justify-center w-8 h-8 rounded-full bg-white border border-slate-200 shadow-md hover:bg-slate-50 hover:border-[#712ae2] transition-all"
          aria-label="Next style"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Dot indicators */}
      <div className="flex items-center gap-2">
        {styles.map((s, i) => (
          <button
            key={s.id}
            onClick={() => goTo(i)}
            className={`rounded-full transition-all duration-300 ${
              i === active
                ? "w-5 h-2 bg-[#712ae2]"
                : "w-2 h-2 bg-slate-300 hover:bg-slate-400"
            }`}
            aria-label={s.name}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Screenshot Carousel ─────────────────────────────────────────────────────

interface ScreenshotItem { screenId: string; title: string; screenshotUrl: string; }

function ScreenshotCarousel({
  screenshots,
  activeIdx,
  onPrev,
  onNext,
  onDot,
  projectUrl,
  projectId,
}: {
  screenshots: ScreenshotItem[];
  activeIdx: number;
  onPrev: () => void;
  onNext: () => void;
  onDot: (i: number) => void;
  projectUrl: string;
  projectId: string;
}) {
  const [zoom, setZoom] = useState(1);
  const [imgUrlCopied, setImgUrlCopied] = useState(false);
  useEffect(() => { setZoom(1); }, [activeIdx]);

  // ── Drag-to-pan ──
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ x: number; y: number; scrollX: number; scrollY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const el = scrollRef.current;
    if (!el) return;
    dragState.current = { x: e.clientX, y: e.clientY, scrollX: el.scrollLeft, scrollY: el.scrollTop };
    setIsDragging(true);
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragState.current || !scrollRef.current) return;
      const dx = e.clientX - dragState.current.x;
      const dy = e.clientY - dragState.current.y;
      scrollRef.current.scrollLeft = dragState.current.scrollX - dx;
      scrollRef.current.scrollTop  = dragState.current.scrollY - dy;
    };
    const onUp = () => {
      dragState.current = null;
      setIsDragging(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.min(4, Math.max(0.25, z - e.deltaY * 0.001)));
  };

  const cur = screenshots[activeIdx];

  const cursor = isDragging ? "grabbing" : zoom > 1 ? "grab" : "zoom-in";

  return (
    <div className="relative w-full h-full">
      {/* Scrollable image area */}
      <div
        ref={scrollRef}
        className="w-full h-full overflow-auto flex items-start justify-center p-6"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        style={{ cursor, userSelect: "none" }}
      >
        <img
          key={cur?.screenshotUrl}
          src={cur?.screenshotUrl}
          alt={cur?.title}
          draggable={false}
          className="rounded-xl shadow-2xl transition-transform duration-100"
          style={{ transform: `scale(${zoom})`, transformOrigin: "top center", maxWidth: "100%" }}
        />
      </div>

      {/* Top toolbar */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        <button
          onClick={() => {
            // lh3.googleusercontent.com URLs are publicly accessible CDN links
            const rawUrl = cur?.screenshotUrl ?? "";
            navigator.clipboard.writeText(rawUrl).then(() => {
              setImgUrlCopied(true);
              setTimeout(() => setImgUrlCopied(false), 2000);
            });
          }}
          title="复制截图链接（任何人可访问）"
          className="flex items-center gap-1 px-2 py-1 rounded-md bg-black/50 hover:bg-black/75 backdrop-blur-sm text-white text-[11px] font-medium transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          {imgUrlCopied ? "已复制!" : "复制图片链接"}
        </button>
        {cur?.screenId && (
          <a
            href={`/api/stitch-html?projectId=${encodeURIComponent(projectId)}&screenId=${encodeURIComponent(cur.screenId)}`}
            target="_blank"
            rel="noopener noreferrer"
            title="在新标签页打开交互式 HTML 预览"
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-black/50 hover:bg-black/75 backdrop-blur-sm text-white text-[11px] font-medium transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            打开 HTML 预览
          </a>
        )}
      </div>

      {/* Zoom badge */}
      {zoom !== 1 && (
        <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm text-white text-[11px] font-medium select-none">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            {zoom > 1
              ? <line x1="8" y1="11" x2="14" y2="11" />
              : <><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></>}
          </svg>
          {Math.round(zoom * 100)}%
          <button onClick={() => setZoom(1)} className="ml-1 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Left arrow */}
      {screenshots.length > 1 && (
        <button
          onClick={onPrev}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-9 h-9 rounded-full bg-black/40 hover:bg-black/70 backdrop-blur-sm text-white transition-all shadow-lg"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}

      {/* Right arrow */}
      {screenshots.length > 1 && (
        <button
          onClick={onNext}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-9 h-9 rounded-full bg-black/40 hover:bg-black/70 backdrop-blur-sm text-white transition-all shadow-lg"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      {/* Dots + counter */}
      {screenshots.length > 1 && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2 rounded-full bg-black/50 backdrop-blur-sm">
          <div className="flex items-center gap-1.5">
            {screenshots.map((s, i) => (
              <button
                key={s.screenId}
                onClick={() => onDot(i)}
                title={s.title}
                className={`rounded-full transition-all duration-200 ${
                  i === activeIdx ? "w-5 h-2 bg-white" : "w-2 h-2 bg-white/40 hover:bg-white/70"
                }`}
              />
            ))}
          </div>
          <span className="text-[11px] text-white/70 font-medium whitespace-nowrap">
            {activeIdx + 1} / {screenshots.length}
          </span>
        </div>
      )}
    </div>
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
  const loadSubStageSnapshot = usePipelineStore((s) => s.loadSubStageSnapshot);
  const goToSubStage = useStageStore((s) => s.goToSubStage);
  const isStageHydrated = useStageStore((s) => s.isStageHydrated);

  // ── Derived step state ──
  const prdContent = steps.prd?.content ?? "";
  const isDesignRunning = isRunning && currentStep === "design";

  const designContent = isDesignRunning
    ? streamingContent
    : (steps.design?.content ?? "");

  const isDesignDone = steps.design?.status === "completed";

  const hasDesignContent = !!(designContent || isDesignRunning);

  // ── Inner tab state ──
  const [innerTab, setInnerTab] = useState<InnerTab>("style");

  // Always land on "style" tab when entering this sub-stage.
  // "spec" is only shown automatically after a new generation completes (see below).
  // Never auto-jump to "stitch" — the user must explicitly proceed.

  // Auto-advance to spec tab when design doc finishes
  const prevDesignRunning = useRef(isDesignRunning);
  useEffect(() => {
    if (prevDesignRunning.current && !isDesignRunning && isDesignDone) {
      setInnerTab("spec");
    }
    prevDesignRunning.current = isDesignRunning;
  }, [isDesignRunning, isDesignDone]);

  // On mount: load the saved snapshot for this sub-stage first, so any
  // previously generated stitchResult (or other state) is restored before
  // anything else runs. Only save a fresh snapshot if no snapshot exists yet.
  const didEagerSave = useRef(false);
  useEffect(() => {
    if (!isStageHydrated) return;
    if (didEagerSave.current) return;
    if (!prdContent.trim()) return;
    didEagerSave.current = true;
    loadSubStageSnapshot("preparation", "design").then((loaded) => {
      if (!loaded) {
        saveSubStageSnapshot("preparation", "design");
      }
    });
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
  }, [
    steps.prd?.content,
    designStyles,
    designStylesPrdHash,
    designStylesLoading,
  ]);

  // ── Stitch state ──
  const [promptCopied, setPromptCopied] = useState(false);
  const [stitchScreenshots, setStitchScreenshots] = useState<{ screenId: string; title: string; screenshotUrl: string }[]>([]);
  const [stitchScreensLoading, setStitchScreensLoading] = useState(false);
  const [screenshotIdx, setScreenshotIdx] = useState(0);

  // Fetch all screen screenshots whenever stitchResult changes
  useEffect(() => {
    if (!stitchResult?.projectId) {
      setStitchScreenshots([]);
      setScreenshotIdx(0);
      return;
    }
    setStitchScreensLoading(true);
    setStitchScreenshots([]);
    setScreenshotIdx(0);
    fetch(`/api/stitch-screens?projectId=${encodeURIComponent(stitchResult.projectId)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.statusText))
      .then((data) => {
        const list = (data.screenshots ?? []) as { screenId: string; title: string; screenshotUrl: string }[];
        // If API returned nothing but we have a screenshotUrl from generation, use that
        if (list.length === 0 && stitchResult.screenshotUrl) {
          setStitchScreenshots([{ screenId: stitchResult.screenId, title: "Screen 1", screenshotUrl: stitchResult.screenshotUrl }]);
        } else {
          setStitchScreenshots(list);
        }
      })
      .catch(() => {
        // Fallback to generation-time screenshot
        if (stitchResult.screenshotUrl) {
          setStitchScreenshots([{ screenId: stitchResult.screenId, title: "Screen 1", screenshotUrl: stitchResult.screenshotUrl }]);
        }
      })
      .finally(() => setStitchScreensLoading(false));
  }, [stitchResult?.projectId]);

  const hasPencilContent = !!(stitchResult || stitchError || stitchGenerating);

  // ── Input state ──
  const [specInput, setSpecInput] = useState("");
  const [stitchInput, setStitchInput] = useState("");

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

  const handleGenerateWithStitch = (instruction?: string) => {
    if (!selectedDesignStyleId) {
      console.warn(
        "[DesignSubStage] ⚠ No selectedDesignStyleId — aborting stitch generation",
      );
      return;
    }
    runStitchGenerate(instruction);
    setInnerTab("stitch");
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
              (tab.id === "stitch" && !hasPencilContent);

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
                {tab.id === "spec" && isDesignRunning && <Loading size="sm" />}
                {tab.id === "stitch" && stitchGenerating && (
                  <Loading size="sm" />
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
                <Loading
                  size="lg"
                  text="Analyzing PRD and generating design styles…"
                />
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

                {/* Carousel */}
                <StyleCarousel
                  styles={designStyles}
                  selectedId={selectedDesignStyleId}
                  onSelect={selectDesignStyle}
                />

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
                      <Loading size="sm" />
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
              <div className="flex items-center justify-center py-20">
                <Loading size="md" text="Generating Design Spec…" />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-slate-400">
                <p className="text-sm">Waiting for design spec to generate…</p>
              </div>
            )}
          </>
        )}

        {/* ══ Stitch Design Tab ══ */}
        {innerTab === "stitch" && (
          <>
            {/* ── Stitch generating ── */}
            {stitchGenerating && (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <Loading size="lg" text="Generating with Stitch…" />
                <p className="text-[12px] text-slate-400">
                  This may take a minute. Stitch is creating your UI design.
                </p>
              </div>
            )}

            {/* ── Stitch error ── */}
            {!stitchGenerating && stitchError && (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div className="text-center max-w-sm">
                  <p className="text-[13px] font-semibold text-red-600">
                    Stitch generation failed
                  </p>
                  <p className="text-[12px] text-slate-500 mt-1 break-all">
                    {stitchError}
                  </p>
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
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#7c3aed"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-violet-700">
                      Stitch Design Generated
                    </p>
                    <p className="text-[11px] text-violet-500 font-mono truncate">
                      {stitchResult.projectUrl}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        navigator.clipboard
                          .writeText(stitchResult.projectUrl)
                          .then(() => {
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
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      Open in Stitch
                    </a>
                  </div>
                </div>

                {/* Screenshots carousel */}
                <div className="flex-1 overflow-hidden bg-slate-950 relative">
                  {stitchScreensLoading && (
                    <div className="flex items-center justify-center h-full">
                      <Loading size="lg" text="Loading design screenshots…" />
                    </div>
                  )}

                  {!stitchScreensLoading && stitchScreenshots.length > 0 && (
                    <ScreenshotCarousel
                      screenshots={stitchScreenshots}
                      activeIdx={screenshotIdx}
                      onPrev={() => setScreenshotIdx((i) => (i - 1 + stitchScreenshots.length) % stitchScreenshots.length)}
                      onNext={() => setScreenshotIdx((i) => (i + 1) % stitchScreenshots.length)}
                      onDot={setScreenshotIdx}
                      projectUrl={stitchResult.projectUrl}
                      projectId={stitchResult.projectId}
                    />
                  )}

                  {!stitchScreensLoading && stitchScreenshots.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-violet-100 flex items-center justify-center">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <path d="M3 9h18M9 21V9" />
                        </svg>
                      </div>
                      <div className="text-center">
                        <p className="text-[14px] font-semibold text-slate-700">设计已生成</p>
                        <p className="text-[12px] text-slate-400 mt-1">截图暂时不可用，请在 Stitch 中查看</p>
                      </div>
                      <a
                        href={stitchResult.projectUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-medium transition-colors"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                        在 Stitch 中打开
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Empty state ── */}
            {!stitchGenerating && !stitchResult && !stitchError && (
              <div className="flex items-center justify-center h-full text-slate-400">
                <p className="text-sm">Waiting for design to generate…</p>
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
          disabled={isDesignRunning}
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
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              Generate with Stitch
            </button>
          }
        />
      )}

      {/* ── StageInputBar — Stitch Design tab ── */}
      {innerTab === "stitch" && (
        <StageInputBar
          value={stitchInput}
          onChange={setStitchInput}
          onSubmit={() => {
            const instruction = stitchInput.trim();
            if (!instruction || isRunning) return;
            setStitchInput("");
            handleGenerateWithStitch(instruction);
          }}
          placeholder="Describe changes — a new Stitch prompt will be built…"
          disabled={isRunning}
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
