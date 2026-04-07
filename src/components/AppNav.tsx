"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  );
}

export default function AppNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between px-6 lg:px-14">
        <Link
          href="/"
          className="flex items-center gap-2 text-[var(--foreground)] transition-opacity hover:opacity-80"
        >
          <SparklesIcon className="shrink-0 text-[var(--accent)]" />
          <span className="text-[17px] font-semibold tracking-tight">
            Agentic Builder
          </span>
        </Link>

        <div className="flex items-center gap-7">
          <Link
            href="/pipeline"
            className={`text-sm font-medium transition-colors ${
              pathname === "/pipeline"
                ? "text-[var(--foreground)]"
                : "text-[var(--muted-secondary)] hover:text-[var(--foreground)]"
            }`}
          >
            Pipeline
          </Link>
          <span
            className="cursor-default text-sm font-medium text-[var(--muted-secondary)]"
            title="Coming soon"
          >
            Docs
          </span>
          <Link
            href="/pipeline"
            className="inline-flex items-center rounded-[10px] bg-[var(--accent)] px-[18px] py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
          >
            Launch Pipeline
          </Link>
        </div>
      </div>
    </header>
  );
}
