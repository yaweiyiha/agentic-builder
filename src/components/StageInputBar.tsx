"use client";

/**
 * StageInputBar — shared bottom input bar used across sub-stage pages.
 *
 * Matches the visual style of the Intent sub-stage input area:
 *   [ attach? ] [ text input ........................ ] [send] | [action btn]
 *
 * The right-hand `actions` slot accepts any ReactNode (e.g. "Next Step" or
 * "Confirm PRD" buttons). Pass `null` to omit it.
 */

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface StageInputBarProps {
  /** Current input value (controlled) */
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** Show a paperclip attachment button to the left */
  showAttach?: boolean;
  onAttach?: () => void;
  /** Extra buttons rendered to the right of the send pill */
  actions?: ReactNode;
  className?: string;
}

export default function StageInputBar({
  value,
  onChange,
  onSubmit,
  placeholder = "Ask AgenticBuilder…",
  disabled = false,
  showAttach = false,
  onAttach,
  actions,
  className = "",
}: StageInputBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <div
      className={`shrink-0 px-8 py-5 bg-white/40 backdrop-blur-sm border-t border-white/40 ${className}`}
    >
      <div className="flex items-center gap-3">
        {/* ── Input pill ── */}
        <div className="flex items-center gap-2 border-2 border-slate-200 rounded-full bg-white px-2 py-2 shadow-md hover:border-slate-400 focus-within:border-slate-500 transition-colors flex-1">
          {showAttach && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-slate-400 hover:text-slate-600 rounded-full"
              onClick={onAttach}
              tabIndex={-1}
            >
              <Paperclip size={15} />
            </Button>
          )}

          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? "Processing…" : placeholder}
            disabled={disabled}
            className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 outline-none min-w-0 px-2"
          />

          {/* Send button */}
          <Button
            onClick={onSubmit}
            disabled={!value.trim() || disabled}
            size="icon"
            className="text-white bg-slate-700 hover:bg-slate-800 rounded-full h-7 w-7 shrink-0 shadow-md disabled:opacity-40"
            title="Send"
          >
            <ArrowUp size={14} />
          </Button>
        </div>

        {/* ── Right-side action slot ── */}
        {actions}
      </div>
    </div>
  );
}
