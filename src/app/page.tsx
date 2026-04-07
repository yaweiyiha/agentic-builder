"use client";

import Link from "next/link";

function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function FileTextIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}

function PaletteIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}

function FlaskIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 16.55a1 1 0 0 0 .858 1.45h12.85a1 1 0 0 0 .857-1.45l-5.07-8.127A2 2 0 0 1 14 9.527V2" />
      <path d="M8.5 2h7" />
      <path d="M7 16h10" />
    </svg>
  );
}

function ShieldCheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

const FEATURES = [
  {
    Icon: FileTextIcon,
    title: "Intent → PRD",
    desc: "PM Agent generates comprehensive PRD from feature briefs",
  },
  {
    Icon: PaletteIcon,
    title: "PRD → Design",
    desc: "Design Agent creates UI specs with Pencil integration",
  },
  {
    Icon: FlaskIcon,
    title: "Design → QA",
    desc: "QA Agent produces audit reports and test plans",
  },
  {
    Icon: ShieldCheckIcon,
    title: "Global Verifier",
    desc: "Drift detection keeps design aligned with PRD",
  },
] as const;

export default function Home() {
  return (
    <div className="flex min-h-[calc(100vh-4.5rem)] flex-col bg-[var(--background)]">
      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col items-center gap-12 px-6 py-14 pb-20 lg:px-14">
        <section className="flex w-full max-w-[920px] flex-col items-center gap-5 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-muted)] px-4 py-2 text-xs font-semibold tracking-wide text-[var(--accent-on-muted)]">
            57Blocks Blueprint Orchestration
          </span>
          <h1 className="text-[2.5rem] font-bold leading-tight tracking-tight text-[var(--foreground)] sm:text-5xl md:text-[3.25rem]">
            Build Faster with AI Agents
          </h1>
          <p className="max-w-xl text-lg text-[var(--muted)]">
            Automated PDLC from Intent to PRD to Design to QA — multi-model routing
            via OpenRouter.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <Link
              href="/pipeline"
              className="inline-flex items-center gap-2.5 rounded-xl bg-[var(--accent)] px-8 py-4 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              <PlayIcon />
              Launch Pipeline
            </Link>
            <Link
              href="/pipeline"
              className="inline-flex items-center rounded-xl border border-[var(--border-muted)] px-6 py-3.5 text-sm font-medium text-[#334155] transition-colors hover:bg-white"
            >
              View roadmap
            </Link>
          </div>
        </section>

        <section className="flex w-full max-w-5xl flex-col items-center gap-5">
          <h2 className="text-[22px] font-semibold text-[var(--foreground)]">
            Pipeline at a glance
          </h2>
          <div className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ Icon, title, desc }) => (
              <div
                key={title}
                className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-white p-6 transition-shadow hover:shadow-sm"
              >
                <Icon className="shrink-0 text-[var(--icon-muted)]" />
                <h3 className="text-[15px] font-semibold text-[var(--foreground)]">
                  {title}
                </h3>
                <p className="text-[13px] leading-snug text-[var(--muted-tertiary)]">
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer
        id="footer"
        className="border-t border-[var(--border)] bg-white py-4 text-center text-xs text-[var(--muted-footer)]"
      >
        Agentic Builder · Intent to code, orchestrated
      </footer>
    </div>
  );
}
