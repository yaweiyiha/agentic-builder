"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Upload, X, FileImage, Code } from "lucide-react";
import { useStepStore } from "@/store/step-store";
import { getNextStep } from "@/_config/pipeline-flow";
import type { StepId } from "@/_config/pipeline-flow";
import StageInputBar from "@/components/StageInputBar";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import Loading from "@/components/Loading";
import type { StepUIProps } from "../../../_shared/types";
import {
  setDesignContext,
  generateDesignStyles,
  runStitchGenerate,
  type DesignStyle,
  type StitchGenerateResult,
} from "./agent";

// ─── Style Carousel ──────────────────────────────────────────────────────────

const SLOTS: Record<number, { x: string; scale: number; opacity: number; z: number }> = {
  [-2]: { x: "-148%", scale: 0.62, opacity: 0.28, z: 0 },
  [-1]: { x: "-88%", scale: 0.78, opacity: 0.58, z: 1 },
  [0]: { x: "0%", scale: 1.0, opacity: 1.0, z: 3 },
  [1]: { x: "88%", scale: 0.78, opacity: 0.58, z: 1 },
  [2]: { x: "148%", scale: 0.62, opacity: 0.28, z: 0 },
};

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
  const initIdx = Math.max(0, styles.findIndex((s) => s.id === selectedId));
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
        <button
          onClick={prev}
          className="absolute left-2 z-20 flex items-center justify-center w-8 h-8 rounded-full bg-white border border-slate-200 shadow-md hover:bg-slate-50 hover:border-[#712ae2] transition-all"
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
        <div className="relative w-44" style={{ height: 290 }}>
          {styles.map((style, idx) => {
            const offset = circOffset(idx, active, total);
            const slot = SLOTS[offset];
            const isCenter = offset === 0;
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
        <button
          onClick={next}
          className="absolute right-2 z-20 flex items-center justify-center w-8 h-8 rounded-full bg-white border border-slate-200 shadow-md hover:bg-slate-50 hover:border-[#712ae2] transition-all"
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

interface ScreenshotItem {
  screenId: string;
  title: string;
  screenshotUrl: string;
}

function ScreenshotCarousel({
  screenshots,
  activeIdx,
  onPrev,
  onNext,
  onDot,
  projectId,
}: {
  screenshots: ScreenshotItem[];
  activeIdx: number;
  onPrev: () => void;
  onNext: () => void;
  onDot: (i: number) => void;
  projectId: string;
}) {
  const [zoom, setZoom] = useState(1);
  const [htmlDownloading, setHtmlDownloading] = useState(false);
  useEffect(() => {
    setZoom(1);
  }, [activeIdx]);

  const handleDownloadHtml = async () => {
    const cur = screenshots[activeIdx];
    if (!cur?.screenId || htmlDownloading) return;
    setHtmlDownloading(true);
    try {
      const res = await fetch(
        `/api/stitch-html?projectId=${encodeURIComponent(projectId)}&screenId=${encodeURIComponent(cur.screenId)}`,
      );
      if (!res.ok) throw new Error(await res.text());
      const html = await res.text();
      const blob = new Blob([html], { type: "text/html" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${cur.title || "screen"}.html`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      /* ignore */
    } finally {
      setHtmlDownloading(false);
    }
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    x: number;
    y: number;
    scrollX: number;
    scrollY: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const el = scrollRef.current;
    if (!el) return;
    dragState.current = {
      x: e.clientX,
      y: e.clientY,
      scrollX: el.scrollLeft,
      scrollY: el.scrollTop,
    };
    setIsDragging(true);
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragState.current || !scrollRef.current) return;
      const dx = e.clientX - dragState.current.x;
      const dy = e.clientY - dragState.current.y;
      scrollRef.current.scrollLeft = dragState.current.scrollX - dx;
      scrollRef.current.scrollTop = dragState.current.scrollY - dy;
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
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top center",
            maxWidth: "100%",
          }}
        />
      </div>
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        {cur?.screenId && (
          <>
            <a
              href={`/api/stitch-html?projectId=${encodeURIComponent(projectId)}&screenId=${encodeURIComponent(cur.screenId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-black/50 hover:bg-black/75 backdrop-blur-sm text-white text-[11px] font-medium transition-colors"
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
              Preview
            </a>
            <button
              onClick={handleDownloadHtml}
              disabled={htmlDownloading}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-black/50 hover:bg-black/75 backdrop-blur-sm text-white text-[11px] font-medium transition-colors disabled:opacity-50"
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
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {htmlDownloading ? "Downloading…" : "Download HTML"}
            </button>
          </>
        )}
      </div>
      {zoom !== 1 && (
        <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm text-white text-[11px] font-medium select-none">
          {Math.round(zoom * 100)}%
          <button
            onClick={() => setZoom(1)}
            className="ml-1 opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}
      {screenshots.length > 1 && (
        <button
          onClick={onPrev}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-9 h-9 rounded-full bg-black/40 hover:bg-black/70 backdrop-blur-sm text-white transition-all shadow-lg"
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
      )}
      {screenshots.length > 1 && (
        <button
          onClick={onNext}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-9 h-9 rounded-full bg-black/40 hover:bg-black/70 backdrop-blur-sm text-white transition-all shadow-lg"
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
      )}
      {screenshots.length > 1 && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2 rounded-full bg-black/50 backdrop-blur-sm">
          <div className="flex items-center gap-1.5">
            {screenshots.map((s, i) => (
              <button
                key={s.screenId}
                onClick={() => onDot(i)}
                title={s.title}
                className={`rounded-full transition-all duration-200 ${
                  i === activeIdx
                    ? "w-5 h-2 bg-white"
                    : "w-2 h-2 bg-white/40 hover:bg-white/70"
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

// ─── Custom Upload — file types ──────────────────────────────────────────────

const ACCEPTED_IMAGE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
];
const ACCEPTED_HTML_MIMES = ["text/html", "application/xhtml+xml"];
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const HTML_EXTS = [".html", ".htm", ".xhtml"];

interface CustomFile {
  key: string;
  file: File;
  kind: "image" | "html";
  previewUrl: string;
  base64: string | null; // resolved async for images
  textContent: string | null; // resolved async for HTML
  loading: boolean;
}

function classifyFile(file: File): "image" | "html" | null {
  const mime = file.type.toLowerCase();
  if (ACCEPTED_IMAGE_MIMES.includes(mime)) return "image";
  if (ACCEPTED_HTML_MIMES.includes(mime)) return "html";
  const lower = file.name.toLowerCase();
  if (HTML_EXTS.some((ext) => lower.endsWith(ext))) return "html";
  if (IMAGE_EXTS.some((ext) => lower.endsWith(ext))) return "image";
  return null;
}

// ─── Phase type ───────────────────────────────────────────────────────────────

type DesignPhase = "style" | "spec" | "stitch";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePrdHash(prdContent: string): string {
  return `${prdContent.length}:${prdContent.slice(0, 100)}`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function DesignUI(props: StepUIProps) {
  // ── Step-store state (single source of truth, like PRD) ──
  const steps = useStepStore((s) => s.steps);
  const streamingContent = useStepStore((s) => s.streamingContent);
  const currentStep = useStepStore((s) => s.currentStep);
  const isRunning = useStepStore((s) => s.isRunning);
  const executeStep = useStepStore((s) => s.executeStep);
  const patchStepMeta = useStepStore((s) => s.patchStepMeta);
  const tier = useStepStore((s) => s.tier);
  const nextStep = getNextStep("design", tier as "S" | "M" | "L");
  // stitchNextStep is the step after design (pencil/mockup/qa depending on tier)
  const stitchNextStep = nextStep;

  // ── Read persisted metadata from step-store (survives navigation) ──
  const designMeta = (steps.design?.metadata ?? {}) as {
    selectedStyleId?: string | null;
    designStyles?: DesignStyle[] | null;
    designSourceMode?: "ai" | "custom";
    stitchResult?: StitchGenerateResult | null;
    prdHash?: string | null;
  };

  // ── Local design state ──────────────────────────────────────────────────
  const [phase, setPhase] = useState<DesignPhase>("style");

  // Style selection — initialized from persisted metadata
  const [designStyles, setDesignStyles] = useState<DesignStyle[] | null>(() => designMeta.designStyles ?? null);
  const [designStylesLoading, setDesignStylesLoading] = useState(false);
  const [designStylesError, setDesignStylesError] = useState<string | null>(null);
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(() => designMeta.selectedStyleId ?? null);

  // Source mode — initialized from persisted metadata
  const [designSourceMode, setDesignSourceMode] = useState<"ai" | "custom">(() => designMeta.designSourceMode ?? "ai");

  // Custom upload files
  const [customFiles, setCustomFiles] = useState<CustomFile[]>([]);

  // Stitch — initialized from persisted metadata
  const [stitchResult, setStitchResult] = useState<StitchGenerateResult | null>(() => designMeta.stitchResult ?? null);
  const [stitchGenerating, setStitchGenerating] = useState(false);
  const [stitchError, setStitchError] = useState<string | null>(null);

  // Inputs
  const [specInput, setSpecInput] = useState("");
  const [stitchInput, setStitchInput] = useState("");

  // Stitch screenshots
  const [promptCopied, setPromptCopied] = useState(false);
  const [stitchScreenshots, setStitchScreenshots] = useState<ScreenshotItem[]>([]);
  const [stitchScreensLoading, setStitchScreensLoading] = useState(false);
  const [screenshotIdx, setScreenshotIdx] = useState(0);

  // ── Derived step state ──────────────────────────────────────────────────
  const isDesignRunning = isRunning && currentStep === "design";
  const designContent = isDesignRunning
    ? streamingContent
    : (steps.design?.content ?? "");
  const isDesignDone = steps.design?.status === "completed";

  // ── PRD content + hash ───────────────────────────────────────────────────
  const prdContent = steps.prd?.content ?? "";
  const prdHash = prdContent.trim() ? makePrdHash(prdContent) : null;

  // ── Persist design metadata to step-store whenever it changes ────────────
  useEffect(() => {
    patchStepMeta("design", {
      prdHash,
      designStyles,
      selectedStyleId,
      designSourceMode,
      stitchResult,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prdHash, designStyles, selectedStyleId, designSourceMode, stitchResult]);

  // ── Auto-generate design styles once PRD content is available ────────────
  const autoGenRef = useRef(false);

  // ── Auto-advance to spec when design completes ──────────────────────────
  const prevDesignRunning = useRef(isDesignRunning);
  useEffect(() => {
    if (prevDesignRunning.current && !isDesignRunning && isDesignDone) {
      setPhase("spec");
    }
    prevDesignRunning.current = isDesignRunning;
  }, [isDesignRunning, isDesignDone]);

  // Jump to spec if design content already exists on entry
  useEffect(() => {
    if (steps.design?.content && !isDesignRunning) setPhase("spec");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-generate styles effect ──────────────────────────────────────────
  useEffect(() => {
    if (!prdContent.trim()) return;
    if (designStylesLoading) return;
    if (autoGenRef.current) return;
    // Already have styles (from persisted metadata or previous generation)
    if (Array.isArray(designStyles) && designStyles.length > 0) {
      autoGenRef.current = true;
      return;
    }
    // Trigger generation
    autoGenRef.current = true;
    setDesignStylesLoading(true);
    setDesignStylesError(null);
    generateDesignStyles(prdContent).then((result) => {
      setDesignStylesLoading(false);
      if (result.error) {
        setDesignStylesError(result.error);
      } else {
        setDesignStyles(result.styles);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prdContent]);

  // ── Stitch screenshots ──────────────────────────────────────────────────
  useEffect(() => {
    if (!stitchResult?.projectId) {
      setStitchScreenshots([]);
      setScreenshotIdx(0);
      return;
    }
    setStitchScreensLoading(true);
    setStitchScreenshots([]);
    setScreenshotIdx(0);
    fetch(
      `/api/stitch-screens?projectId=${encodeURIComponent(stitchResult.projectId)}`,
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((data) => {
        const list = (data.screenshots ?? []) as ScreenshotItem[];
        setStitchScreenshots(
          list.length === 0 && stitchResult.screenshotUrl
            ? [
                {
                  screenId: stitchResult.screenId,
                  title: "Screen 1",
                  screenshotUrl: stitchResult.screenshotUrl,
                },
              ]
            : list,
        );
      })
      .catch(() => {
        if (stitchResult.screenshotUrl)
          setStitchScreenshots([
            {
              screenId: stitchResult.screenId,
              title: "Screen 1",
              screenshotUrl: stitchResult.screenshotUrl,
            },
          ]);
      })
      .finally(() => setStitchScreensLoading(false));
  }, [stitchResult?.projectId]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleGenerateDesignDoc = () => {
    // Set design context before executing the step
    if (designSourceMode === "ai") {
      setDesignContext({
        designStyleId: selectedStyleId,
        styleReferenceImageBase64: null,
        designDirectionPrompt: null,
      });
    } else {
      // Custom mode: pass first image as base64 reference, HTML content as direction prompt
      const imageFile = customFiles.find((f) => f.kind === "image");
      const htmlFile = customFiles.find((f) => f.kind === "html");
      setDesignContext({
        designStyleId: null,
        styleReferenceImageBase64: imageFile?.base64 ?? null,
        designDirectionPrompt: htmlFile?.textContent ?? null,
      });
    }
    void executeStep("design");
    setPhase("spec");
  };

  const handleGenerateWithStitch = (instruction?: string) => {
    if (!prdContent.trim()) return;
    setStitchGenerating(true);
    setStitchError(null);
    setStitchResult(null);
    runStitchGenerate({
      prdContent,
      designStyleId: designSourceMode === "ai" ? selectedStyleId : null,
      designSpecContent: steps.design?.content ?? "",
      editInstruction: instruction,
    }).then((outcome) => {
      setStitchGenerating(false);
      if (outcome.error) {
        setStitchError(outcome.error);
      } else {
        setStitchResult(outcome.result);
      }
    });
    setPhase("stitch");
  };

  // ── Custom file handling ────────────────────────────────────────────────

  const addCustomFiles = useCallback((files: File[]) => {
    const entries: CustomFile[] = [];
    for (const file of files) {
      const kind = classifyFile(file);
      if (!kind) continue;
      const entry: CustomFile = {
        key: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        kind,
        previewUrl: kind === "image" ? URL.createObjectURL(file) : "",
        base64: null,
        textContent: null,
        loading: true,
      };
      // Read file content async
      if (kind === "image") {
        const reader = new FileReader();
        reader.onload = () => {
          setCustomFiles((prev) =>
            prev.map((f) =>
              f.key === entry.key
                ? { ...f, base64: reader.result as string, loading: false }
                : f,
            ),
          );
        };
        reader.readAsDataURL(file);
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          setCustomFiles((prev) =>
            prev.map((f) =>
              f.key === entry.key
                ? { ...f, textContent: reader.result as string, loading: false }
                : f,
            ),
          );
        };
        reader.readAsText(file);
      }
      entries.push(entry);
    }
    if (entries.length > 0) {
      setCustomFiles((prev) => [...prev, ...entries]);
    }
  }, []);

  const removeCustomFile = useCallback((key: string) => {
    setCustomFiles((prev) => {
      const target = prev.find((f) => f.key === key);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.key !== key);
    });
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (files.length > 0) addCustomFiles(files);
    },
    [addCustomFiles],
  );

  const [dragActive, setDragActive] = useState(false);
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length > 0) addCustomFiles(files);
    },
    [addCustomFiles],
  );

  // Detect interrupted PRD
  const prdInterrupted =
    steps.prd?.status === "running" && !steps.prd?.content;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden">
      {/* ── Phase nav bar (replaces breadcrumb) ── */}
      <div className="shrink-0 bg-white border-b border-[#e2e8f0] px-6 py-2 flex items-center justify-between">
        {/* Prev */}
        <button
          onClick={() => {
            if (phase === "style") props.onNavigate("prd" as StepId);
            else if (phase === "spec") setPhase("style");
            else setPhase("spec");
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          <ArrowLeft size={13} />
          {phase === "style" ? "PRD" : phase === "spec" ? "Style" : "Design Spec"}
        </button>

        {/* Current phase label */}
        <span className="text-[12px] font-semibold text-slate-500">
          {phase === "style" ? "1 · Style" : phase === "spec" ? "2 · Design Spec" : "3 · Stitch Design"}
        </span>

        {/* Next */}
        <button
          onClick={() => {
            if (phase === "style") {
              handleGenerateDesignDoc();
            } else if (phase === "spec") {
              setPhase("stitch");
            } else {
              if (stitchNextStep) props.onNavigate(stitchNextStep);
            }
          }}
          disabled={
            (phase === "style" && (
              (designSourceMode === "ai" && !selectedStyleId) ||
              (designSourceMode === "custom" && customFiles.length === 0) ||
              isDesignRunning
            )) ||
            (phase === "spec" && isDesignRunning)
          }
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {phase === "style"
            ? isDesignDone ? "Design Spec" : "Generate Spec"
            : phase === "spec" ? "Stitch Design"
            : "Next Step"}
          <ArrowRight size={13} />
        </button>
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 overflow-y-auto">
        {/* ══ Phase 1: Style Selection ══ */}
        {phase === "style" && (
          <>
            {/* ── Mode selector ── */}
            <div className="px-8 pt-6 pb-2">
              <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit">
                <button
                  onClick={() => setDesignSourceMode("ai")}
                  className={`px-4 py-1.5 text-[13px] font-medium rounded-md transition-all ${
                    designSourceMode === "ai"
                      ? "bg-white text-[#712ae2] shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  AI Generated
                </button>
                <button
                  onClick={() => setDesignSourceMode("custom")}
                  className={`px-4 py-1.5 text-[13px] font-medium rounded-md transition-all ${
                    designSourceMode === "custom"
                      ? "bg-white text-[#712ae2] shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Custom Upload
                </button>
              </div>
            </div>

            {/* ── AI mode: Style carousel ── */}
            {designSourceMode === "ai" && (
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
                        Select the style that best fits your product vision.
                      </p>
                    </div>
                    <StyleCarousel
                      styles={designStyles}
                      selectedId={selectedStyleId}
                      onSelect={setSelectedStyleId}
                    />
                  </div>
                )}
                {!designStylesLoading && !designStyles && (
                  <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-400">
                    {designStylesError ? (
                      <>
                        <p className="text-sm text-red-500">
                          Failed to generate design styles: {designStylesError}
                        </p>
                        <button
                          onClick={() => {
                            setDesignStylesLoading(true);
                            setDesignStylesError(null);
                            generateDesignStyles(prdContent).then((result) => {
                              setDesignStylesLoading(false);
                              if (result.error) {
                                setDesignStylesError(result.error);
                              } else {
                                setDesignStyles(result.styles);
                              }
                            });
                          }}
                          className="px-4 py-2 text-[13px] font-medium text-white bg-[#712ae2] rounded-lg hover:bg-[#6b24da] transition-colors"
                        >
                          Retry
                        </button>
                      </>
                    ) : prdInterrupted ? (
                      <>
                        <p className="text-sm">
                          PRD generation was interrupted. Go back to PRD to
                          complete it.
                        </p>
                        <button
                          onClick={() => props.onNavigate("prd" as StepId)}
                          className="px-4 py-2 text-[13px] font-medium text-white bg-[#712ae2] rounded-lg hover:bg-[#6b24da] transition-colors"
                        >
                          Go to PRD
                        </button>
                      </>
                    ) : (
                      <p className="text-sm">
                        Waiting for PRD to generate styles…
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ── Custom mode: File upload ── */}
            {designSourceMode === "custom" && (
              <div className="p-8 flex flex-col gap-6">
                <div>
                  <h2 className="text-[22px] font-bold text-slate-900 mb-1">
                    Upload Design References
                  </h2>
                  <p className="text-slate-500 text-[13px]">
                    Upload images or HTML documents as a reference for
                    generating your design spec.
                  </p>
                </div>

                {/* Drop zone */}
                <div
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                  className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 transition-colors ${
                    dragActive
                      ? "border-[#712ae2] bg-[rgba(113,42,226,0.04)]"
                      : "border-slate-300 bg-slate-50"
                  }`}
                >
                  <Upload
                    size={28}
                    className={
                      dragActive ? "text-[#712ae2]" : "text-slate-400"
                    }
                  />
                  <div className="text-center">
                    <p className="text-[13px] text-slate-600 font-medium">
                      Drop files here or{" "}
                      <label className="text-[#712ae2] cursor-pointer hover:underline">
                        browse
                        <input
                          type="file"
                          accept={[
                            ...ACCEPTED_IMAGE_MIMES,
                            ...ACCEPTED_HTML_MIMES,
                            ...IMAGE_EXTS,
                            ...HTML_EXTS,
                          ].join(",")}
                          multiple
                          onChange={handleFileInput}
                          className="hidden"
                        />
                      </label>
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Supports .png, .jpg, .webp, .gif, .html files
                    </p>
                  </div>
                </div>

                {/* File list */}
                {customFiles.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Uploaded files ({customFiles.length})
                    </div>
                    {customFiles.map((f) => (
                      <div
                        key={f.key}
                        className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3"
                      >
                        {/* Preview */}
                        {f.kind === "image" && f.previewUrl ? (
                          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={f.previewUrl}
                              alt={f.file.name}
                              className="h-full w-full object-cover"
                            />
                          </div>
                        ) : (
                          <div className="h-14 w-14 shrink-0 flex items-center justify-center rounded-lg border border-amber-200 bg-linear-to-br from-amber-50 to-orange-50">
                            {f.kind === "html" ? (
                              <Code size={20} className="text-amber-600" />
                            ) : (
                              <FileImage size={20} className="text-sky-600" />
                            )}
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12.5px] font-medium text-slate-800 truncate">
                              {f.file.name}
                            </span>
                            <span
                              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                                f.kind === "html"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-sky-100 text-sky-700"
                              }`}
                            >
                              {f.kind}
                            </span>
                          </div>
                          <div className="text-[10.5px] text-slate-500">
                            {(f.file.size / 1024).toFixed(1)} KB
                            {f.loading && " · Reading file…"}
                            {!f.loading && " · Ready"}
                          </div>
                        </div>

                        <button
                          onClick={() => removeCustomFile(f.key)}
                          className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ══ Phase 2: Design Spec ══ */}
        {phase === "spec" && (
          <>
            {isDesignRunning ? (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <Loading size="lg" text="Generating Design System Spec…" />
                <p className="text-[12px] text-slate-400">
                  Building your HTML design system document…
                </p>
              </div>
            ) : designContent ? (
              (() => {
                const trimmed = designContent.trimStart();
                const isHtml =
                  trimmed.startsWith("<!DOCTYPE") ||
                  trimmed.startsWith("<html") ||
                  trimmed.startsWith("<!");
                if (isHtml) {
                  return (
                    <div className="relative h-full">
                      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            const blob = new Blob([designContent], {
                              type: "text/html",
                            });
                            const a = document.createElement("a");
                            a.href = URL.createObjectURL(blob);
                            a.download = "design-system.html";
                            a.click();
                            URL.revokeObjectURL(a.href);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-white bg-black/50 hover:bg-black/70 backdrop-blur-sm rounded-md transition-all"
                        >
                          <DownloadIcon /> Download HTML
                        </button>
                        <button
                          onClick={() => {
                            const blob = new Blob([designContent], {
                              type: "text/html",
                            });
                            const url = URL.createObjectURL(blob);
                            window.open(url, "_blank");
                            setTimeout(() => URL.revokeObjectURL(url), 5000);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-white bg-black/50 hover:bg-black/70 backdrop-blur-sm rounded-md transition-all"
                        >
                          <OpenIcon /> Open in Tab
                        </button>
                      </div>
                      <iframe
                        srcDoc={designContent}
                        sandbox="allow-scripts allow-same-origin"
                        className="w-full h-full border-0"
                        title="Design System Spec"
                      />
                    </div>
                  );
                }
                return (
                  <div className="p-6 max-w-4xl mx-auto">
                    <MarkdownRenderer content={designContent} />
                  </div>
                );
              })()
            ) : (
              <div className="flex items-center justify-center h-full text-slate-400">
                <p className="text-sm">
                  Waiting for design spec to generate…
                </p>
              </div>
            )}
          </>
        )}

        {/* ══ Phase 3: Stitch Design ══ */}
        {phase === "stitch" && (
          <>
            {stitchGenerating && (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <Loading size="lg" text="Generating with Stitch…" />
                <p className="text-[12px] text-slate-400">
                  This may take a minute.
                </p>
              </div>
            )}
            {!stitchGenerating && stitchError && (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth="1.5"
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
                  className="mt-2 px-4 py-2 text-[12px] font-medium text-white bg-[#712ae2] rounded-lg hover:bg-[#6b24da] transition-colors"
                >
                  Retry
                </button>
              </div>
            )}
            {!stitchGenerating && stitchResult && (
              <div className="flex flex-col h-full">
                <div className="shrink-0 flex items-center gap-3 px-5 py-3 bg-violet-50 border-b border-violet-100">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#7c3aed"
                    strokeWidth="2"
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
                      Open in Stitch
                    </a>
                  </div>
                </div>
                <div className="flex-1 overflow-hidden bg-slate-950 relative">
                  {stitchScreensLoading && (
                    <div className="flex items-center justify-center h-full">
                      <Loading
                        size="lg"
                        text="Loading design screenshots…"
                      />
                    </div>
                  )}
                  {!stitchScreensLoading &&
                    stitchScreenshots.length > 0 && (
                      <ScreenshotCarousel
                        screenshots={stitchScreenshots}
                        activeIdx={screenshotIdx}
                        onPrev={() =>
                          setScreenshotIdx(
                            (i) =>
                              (i - 1 + stitchScreenshots.length) %
                              stitchScreenshots.length,
                          )
                        }
                        onNext={() =>
                          setScreenshotIdx(
                            (i) => (i + 1) % stitchScreenshots.length,
                          )
                        }
                        onDot={setScreenshotIdx}
                        projectId={stitchResult.projectId}
                      />
                    )}
                  {!stitchScreensLoading &&
                    stitchScreenshots.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-full gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-violet-100 flex items-center justify-center">
                          <svg
                            width="28"
                            height="28"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#7c3aed"
                            strokeWidth="1.5"
                          >
                            <rect
                              x="3"
                              y="3"
                              width="18"
                              height="18"
                              rx="2"
                            />
                            <path d="M3 9h18M9 21V9" />
                          </svg>
                        </div>
                        <div className="text-center">
                          <p className="text-[14px] font-semibold text-slate-700">
                            Design Generated
                          </p>
                          <p className="text-[12px] text-slate-400 mt-1">
                            Screenshots not yet available — view in Stitch
                          </p>
                        </div>
                        <a
                          href={stitchResult.projectUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-medium transition-colors"
                        >
                          Open in Stitch
                        </a>
                      </div>
                    )}
                </div>
              </div>
            )}
            {!stitchGenerating && !stitchResult && !stitchError && (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <p className="text-[13px] text-slate-400">Design Spec is ready. Generate Stitch mockups below.</p>
                <button
                  onClick={() => handleGenerateWithStitch()}
                  disabled={!steps.design?.content || isRunning}
                  className="flex items-center gap-2 px-6 py-2.5 bg-[#712ae2] text-white text-[13px] font-semibold rounded-lg hover:bg-[#6b24da] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Generate with Stitch
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Bottom navigation bar ── */}
      <div className="shrink-0 border-t border-[#e2e8f0] bg-white px-8 py-3 flex items-center justify-end">

          {phase === "spec" && (
            <StageInputBar
              value={specInput}
              onChange={setSpecInput}
              onSubmit={() => {
                const i = specInput.trim();
                if (!i || isDesignRunning) return;
                setSpecInput("");
                setDesignContext({
                  designStyleId:
                    designSourceMode === "ai"
                      ? selectedStyleId
                      : undefined,
                  styleReferenceImageBase64:
                    designSourceMode === "custom"
                      ? (customFiles.find((f) => f.kind === "image")
                          ?.base64 ?? null)
                      : null,
                  designDirectionPrompt:
                    designSourceMode === "custom"
                      ? (customFiles.find((f) => f.kind === "html")
                          ?.textContent ?? null)
                      : null,
                });
                void executeStep("design", i);
              }}
              placeholder="Edit the design spec…"
              disabled={isDesignRunning}
              actions={
                <div className="flex items-center gap-2 shrink-0">
                  {stitchNextStep && (
                    <button
                      onClick={() => props.onNavigate(stitchNextStep)}
                      disabled={isRunning}
                      className="flex items-center gap-2 shrink-0 px-4 py-2 text-[13px] font-semibold text-slate-600 bg-white border border-slate-200 rounded-full hover:bg-slate-50 transition-colors disabled:opacity-40"
                    >
                      Skip to Next <ArrowRight size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setSpecInput("");
                      handleGenerateWithStitch(
                        specInput.trim() || undefined,
                      );
                    }}
                    disabled={!steps.design?.content || isRunning}
                    className="flex items-center gap-2 shrink-0 px-4 py-2 bg-[#712ae2] text-white text-[13px] font-semibold rounded-full hover:bg-[#6b24da] transition-colors disabled:opacity-40"
                  >
                    Generate with Stitch
                  </button>
                </div>
              }
            />
          )}

          {phase === "stitch" && (
            <StageInputBar
              value={stitchInput}
              onChange={setStitchInput}
              onSubmit={() => {
                const i = stitchInput.trim();
                if (!i || isRunning) return;
                setStitchInput("");
                handleGenerateWithStitch(i);
              }}
              placeholder="Describe changes…"
              disabled={isRunning}
              actions={
                <button
                  onClick={() => {
                    props.onNavigate("trd");
                  }}
                  disabled={isRunning}
                  className="flex items-center gap-2 shrink-0 px-4 py-2.5 bg-[#712ae2] text-white text-[13px] font-semibold rounded-full hover:bg-[#6b24da] transition-colors disabled:opacity-40"
                >
                  Next Step <ArrowRight size={14} />
                </button>
              }
            />
          )}
        </div>
    </div>
  );
}

// ─── Inline SVG icons ────────────────────────────────────────────────────────

function DownloadIcon() {
  return (
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
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function OpenIcon() {
  return (
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
  );
}
