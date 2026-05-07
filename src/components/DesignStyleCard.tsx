"use client";

import React from "react";

export interface DesignStyle {
  id: string;
  name: string;
  description: string;
  colors: {
    primary: string;
    secondary: string;
    tertiary: string;
    neutral: string;
  };
  typography: {
    headlineFont: string;
    bodyFont: string;
    labelFont: string;
  };
  fontSizes: {
    h1: number;
    h2: number;
    h3: number;
    body: number;
    label: number;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
  };
}

export interface DesignStyleCardProps {
  style: DesignStyle;
  isSelected: boolean;
  onSelect: (styleId: string) => void;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r
    ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)]
    : null;
}

function toneStrip(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const stops = [0, 0.18, 0.38, 0.56, 0.74, 0.88, 1].map((t) => {
    const r = Math.round(rgb[0] + (255 - rgb[0]) * t);
    const g = Math.round(rgb[1] + (255 - rgb[1]) * t);
    const b = Math.round(rgb[2] + (255 - rgb[2]) * t);
    return `rgb(${r},${g},${b})`;
  });
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

const COLOR_LABELS: Array<{ key: keyof DesignStyle["colors"]; label: string }> = [
  { key: "primary", label: "Primary" },
  { key: "secondary", label: "Secondary" },
  { key: "tertiary", label: "Tertiary" },
  { key: "neutral", label: "Neutral" },
];

export default function DesignStyleCard({
  style,
  isSelected,
  onSelect,
}: DesignStyleCardProps) {
  return (
    <button
      onClick={() => onSelect(style.id)}
      className={[
        "flex flex-col rounded-xl border-2 text-left overflow-hidden w-full transition-all cursor-pointer focus:outline-none",
        isSelected
          ? "border-[#712ae2] shadow-lg shadow-[rgba(113,42,226,0.18)] ring-2 ring-[#712ae2]/20"
          : "border-[#e2e8f0] bg-white hover:border-[#c4b5fd] hover:shadow-md",
      ].join(" ")}
    >
      {/* ── Color Palette Grid ── */}
      <div className="grid grid-cols-2 gap-px bg-slate-200">
        {COLOR_LABELS.map(({ key, label }) => {
          const hex = style.colors[key];
          return (
            <div key={key} className="flex flex-col bg-white">
              {/* Label + Hex */}
              <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
                <span className="text-[10px] font-semibold text-slate-600 tracking-wide">
                  {label}
                </span>
                <span className="text-[9px] font-mono text-slate-400">{hex}</span>
              </div>
              {/* Color Block */}
              <div className="h-10" style={{ backgroundColor: hex }} />
              {/* Tone Strip */}
              <div
                className="h-2.5"
                style={{ background: toneStrip(hex) }}
              />
            </div>
          );
        })}
      </div>

      {/* ── Card Body ── */}
      <div className="p-3 bg-white flex flex-col gap-2.5">
        {/* Name + Selected Badge */}
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-bold text-slate-900 leading-tight">
            {style.name}
          </h3>
          {isSelected && (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-[#712ae2] bg-[rgba(113,42,226,0.08)] px-1.5 py-0.5 rounded-full">
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="9 12 11 14 15 10" />
              </svg>
              Selected
            </span>
          )}
        </div>

        {/* Description */}
        <p className="text-[10px] text-slate-500 leading-relaxed line-clamp-2">
          {style.description}
        </p>

        {/* Typography Preview */}
        <div className="flex items-center gap-2.5 pt-2 border-t border-slate-100">
          <span
            className="text-[28px] font-bold leading-none"
            style={{
              color: style.colors.primary,
              fontFamily: style.typography.headlineFont,
            }}
          >
            Aa
          </span>
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[9px] text-slate-500 truncate">
              Headline · {style.typography.headlineFont}
            </span>
            <span className="text-[9px] text-slate-400 truncate">
              Body · {style.typography.bodyFont}
            </span>
            <span className="text-[9px] text-slate-400 truncate">
              Label · {style.typography.labelFont}
            </span>
          </div>
        </div>

        {/* Button Preview */}
        <div className="flex items-center gap-1.5 pt-1">
          <div
            className="text-[10px] font-semibold text-white px-2.5 py-1 rounded-md"
            style={{ backgroundColor: style.colors.primary }}
          >
            Primary
          </div>
          <div
            className="text-[10px] font-semibold px-2.5 py-1 rounded-md border-[1.5px]"
            style={{
              color: style.colors.secondary,
              borderColor: style.colors.secondary,
            }}
          >
            Outlined
          </div>
        </div>
      </div>
    </button>
  );
}
