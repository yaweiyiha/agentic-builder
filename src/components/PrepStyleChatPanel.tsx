"use client";

import { motion, AnimatePresence } from "motion/react";
import {
  DESIGN_STYLE_PRESETS,
  type DesignStyleId,
} from "@/lib/pipeline/design-style-presets";

export type PrepDocChatMsg = {
  role: "user" | "assistant";
  content: string;
};

export const PREP_STYLE_CARD_TITLES: Record<DesignStyleId, string> = {
  glass_dark_saas: "Glass dark SaaS",
  minimal_light: "Minimal light",
  neo_brutalist: "Neo-brutalist",
  soft_pastel: "Soft pastel",
  editorial_serif: "Editorial serif",
  cyberpunk_neon: "Cyberpunk neon",
};

function StyleSvgCard({
  preset,
  active,
  busy,
  onSelect,
}: {
  preset: (typeof DESIGN_STYLE_PRESETS)[number];
  active: boolean;
  busy?: boolean;
  onSelect: () => void;
}) {
  return (
    <motion.button
      type="button"
      disabled={busy}
      layout
      whileHover={busy ? undefined : { y: -2 }}
      whileTap={busy ? undefined : { scale: 0.99 }}
      onClick={onSelect}
      className={`group relative overflow-hidden rounded-xl border text-left transition-shadow ${
        active
          ? "border-indigo-500 ring-2 ring-indigo-400/40 shadow-md"
          : "border-zinc-200 hover:border-zinc-400 hover:shadow-sm"
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <div
        className="relative w-full overflow-hidden"
        style={{ aspectRatio: "16/10" }}
        dangerouslySetInnerHTML={{ __html: preset.previewSvg }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent pointer-events-none" />
      <span className="absolute bottom-2.5 left-3 right-3 text-[13px] font-semibold leading-tight text-white drop-shadow-sm">
        {PREP_STYLE_CARD_TITLES[preset.id]}
      </span>
      {active && (
        <span className="absolute right-2 top-2 rounded-full bg-indigo-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          Selected
        </span>
      )}
    </motion.button>
  );
}

export default function PrepStyleChatPanel({
  messages,
  selectedStyleId,
  onSelectStyle,
  onContinue,
  busy,
}: {
  messages: PrepDocChatMsg[];
  selectedStyleId: DesignStyleId;
  onSelectStyle: (id: DesignStyleId) => void;
  onContinue: () => void;
  busy?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto w-full max-w-5xl space-y-5"
    >
      <div className="rounded-2xl border border-zinc-200/90 bg-white shadow-[0_4px_24px_-4px_rgba(15,23,42,0.08)]">
        <div className="max-h-[min(320px,40vh)] overflow-y-auto px-4 py-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            Preparation
          </p>
          <AnimatePresence initial={false}>
            {messages.map((m, i) => (
              <motion.div
                key={`${i}-${m.role}-${m.content.slice(0, 24)}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className={`mb-3 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[92%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm ${
                    m.role === "user"
                      ? "bg-zinc-900 text-white"
                      : "border border-zinc-200 bg-zinc-50 text-zinc-800"
                  }`}
                >
                  {m.content}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-[0_4px_24px_-4px_rgba(15,23,42,0.08)]">
        <h3 className="text-[15px] font-semibold text-zinc-900">
          Choose a style
        </h3>
        <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-500">
          Each card shows a UI mood preview. Your choice applies to Design Spec
          and Pencil and is saved in the thread above.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DESIGN_STYLE_PRESETS.map((p) => (
            <StyleSvgCard
              key={p.id}
              preset={p}
              active={p.id === selectedStyleId}
              busy={busy}
              onSelect={() => onSelectStyle(p.id)}
            />
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <motion.button
            type="button"
            disabled={busy}
            whileHover={busy ? undefined : { scale: 1.02 }}
            whileTap={busy ? undefined : { scale: 0.98 }}
            onClick={onContinue}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Continue with this style
          </motion.button>
          <span className="text-[11px] text-zinc-500">
            Or type{" "}
            <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-800">
              continue
            </kbd>{" "}
            in the command bar.
          </span>
        </div>
      </div>
    </motion.div>
  );
}

/** Read-only transcript shown after the user confirms a style. */
export function PrepStyleChatTranscript({
  messages,
}: {
  messages: PrepDocChatMsg[];
}) {
  if (messages.length === 0) return null;
  return (
    <div className="mx-auto w-full max-w-5xl rounded-xl border border-zinc-200/80 bg-zinc-50/80 px-4 py-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        Style selection
      </p>
      <div className="flex max-h-28 flex-col gap-1.5 overflow-y-auto text-[11px] leading-snug text-zinc-600 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
        {messages.map((m, i) => (
          <p key={`${i}-${m.role}`}>
            <span className="font-semibold text-zinc-700">
              {m.role === "user" ? "You" : "Assistant"}:
            </span>{" "}
            {m.content}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Inline style card grid for embedding inside table rows or panels. */
export function InlineStylePicker({
  selectedStyleId,
  onSelectStyle,
  styleReferenceImage,
  onStyleReferenceImageChange,
}: {
  selectedStyleId: DesignStyleId;
  onSelectStyle: (id: DesignStyleId) => void;
  styleReferenceImage?: string | null;
  onStyleReferenceImageChange?: (v: string | null) => void;
}) {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result;
      if (typeof result === "string") {
        onStyleReferenceImageChange?.(result);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="px-4 pb-5 pt-3">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        Design style
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {DESIGN_STYLE_PRESETS.map((p) => {
          const active = p.id === selectedStyleId;
          return (
            <motion.button
              key={p.id}
              type="button"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onSelectStyle(p.id)}
              className={`group relative overflow-hidden rounded-lg border text-left transition-all ${
                active
                  ? "border-indigo-500 ring-2 ring-indigo-400/30 shadow-sm"
                  : "border-zinc-200 hover:border-zinc-400"
              }`}
            >
              <div
                className="relative w-full overflow-hidden"
                style={{ aspectRatio: "16/10" }}
                dangerouslySetInnerHTML={{ __html: p.previewSvg }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent pointer-events-none" />
              {active && (
                <div className="absolute inset-0 ring-2 ring-inset ring-indigo-400/50 rounded-lg pointer-events-none" />
              )}
              <span className="absolute bottom-1.5 left-2 right-2 text-[10px] font-semibold leading-tight text-white drop-shadow-sm">
                {PREP_STYLE_CARD_TITLES[p.id]}
              </span>
            </motion.button>
          );
        })}
      </div>

      {onStyleReferenceImageChange && (
        <div className="mt-4 flex items-start gap-4">
          <div className="flex-1">
            <p className="mb-1.5 text-[11px] font-semibold text-zinc-600">
              Reference image{" "}
              <span className="font-normal text-zinc-400">(optional)</span>
            </p>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-zinc-300 px-3 py-2.5 text-[12px] text-zinc-500 transition-colors hover:border-zinc-400 hover:bg-zinc-50">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="shrink-0 text-zinc-400"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Upload reference image
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={handleFileChange}
              />
            </label>
          </div>
          {styleReferenceImage && (
            <div className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={styleReferenceImage}
                alt="reference"
                className="h-14 w-20 rounded-lg border border-zinc-200 object-cover"
              />
              <button
                type="button"
                onClick={() => onStyleReferenceImageChange(null)}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-800 text-white shadow"
              >
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
