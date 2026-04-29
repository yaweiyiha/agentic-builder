"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useProjects } from "@/hooks/useProjects";
import { useStageStore } from "@/store/stage-store";
import { usePipelineStore } from "@/store/pipeline-store";

function FolderIcon() {
  return (
    <svg width="18" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
<<<<<<< HEAD
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
          <Link
            href="/reports"
            className={`text-sm font-medium transition-colors ${
              pathname === "/reports"
                ? "text-[var(--foreground)]"
                : "text-[var(--muted-secondary)] hover:text-[var(--foreground)]"
            }`}
          >
            Reports
          </Link>
          <Link
            href="/memory"
            className={`text-sm font-medium transition-colors ${
              pathname === "/memory"
                ? "text-[var(--foreground)]"
                : "text-[var(--muted-secondary)] hover:text-[var(--foreground)]"
            }`}
          >
            Memory
          </Link>
          <Link
            href="/pipeline"
            className="inline-flex items-center rounded-[10px] bg-[var(--accent)] px-[18px] py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
          >
            Launch Pipeline
          </Link>
        </div>
      </div>
    </header>
=======
    <svg width="6" height="4" viewBox="0 0 6 4" fill="none" aria-hidden>
      <path d="M0.5 0.5L3 3L5.5 0.5" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="15" height="12" viewBox="0 0 18 22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v5h5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M5 1v8M1 5h8" />
    </svg>
  );
}

function LogoMark() {
  return (
    <svg width="10.5" height="11.667" viewBox="0 0 12 14" fill="white" aria-hidden>
      <path d="M6 0L12 3.5V10.5L6 14L0 10.5V3.5L6 0Z" />
    </svg>
  );
}

// ── Mock project data (replace with real store / API) ─────────────────────────
// PROJECTS constant removed — now loaded from /api/projects via useProjects()

export default function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { projects, loading, createProject } = useProjects();
  const resetStage = useStageStore((s) => s.resetStage);
  const setProjectSlugForSync = useStageStore((s) => s.setProjectSlugForSync);
  const setProjectName = useStageStore((s) => s.setProjectName);
  const stageProjectId = useStageStore((s) => s.projectId);
  const stageProjectName = useStageStore((s) => s.projectName);
  const resetPipeline = usePipelineStore((s) => s.reset);
  const pipelineSetProjectSlugForSync = usePipelineStore((s) => s.setProjectSlugForSync);

  async function handleNewProject() {
    resetStage();
    resetPipeline();
    try {
      const project = await createProject("New Project");
      setProjectSlugForSync(project.id);
      pipelineSetProjectSlugForSync(project.id);
      setProjectName("New Project");
      router.push(`/project/${project.id}`);
    } catch (err) {
      console.error("[AppNav] Failed to create project:", err);
    }
  }

  const dragStyle: React.CSSProperties & { WebkitAppRegion?: string } = { WebkitAppRegion: "drag" };
  const noDragStyle: React.CSSProperties & { WebkitAppRegion?: string } = { WebkitAppRegion: "no-drag" };

  return (
    <aside
      className="fixed left-0 top-0 h-screen w-[240px] bg-[#f8fafc] border-r border-[#e2e8f0] flex flex-col justify-between z-50 pr-px py-4"
      style={dragStyle}
    >
      {/* Logo & Brand */}
      <div className="px-6 pb-8" style={noDragStyle}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-black rounded-[2px] flex items-center justify-center shrink-0">
            <LogoMark />
          </div>
          <div className="flex flex-col">
            <span className="text-[18px] font-bold tracking-[-0.45px] text-[#0f172a] leading-7">
              Agentic Builder
            </span>
            <span className="text-[10px] uppercase text-[#64748b] leading-[15px] font-space-grotesk">
              V1.0.4
            </span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 min-h-0 px-4 overflow-y-auto" style={noDragStyle}>
        <details open className="group/details">
          <summary
            style={noDragStyle}
            className="flex items-center justify-between px-2 py-2.5 rounded-sm hover:bg-[#f1f5f9] active:bg-[#e2e8f0] transition-colors cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden"
          >
            <div className="flex items-center gap-2.5">
              <span className="text-[#64748b] shrink-0"><FolderIcon /></span>
              <span className="text-[13px] font-semibold tracking-[-0.3px] text-[#475569]">Projects</span>
            </div>
            <span className="text-[#94a3b8] transition-transform duration-200 group-open/details:rotate-0 -rotate-90">
              <ChevronDownIcon />
            </span>
          </summary>

          <div className="flex flex-col gap-0.5 ml-1 mt-1">
              {loading && (
                <span className="px-3 py-2 text-[12px] text-[#94a3b8]">Loading…</span>
              )}
              {!loading && projects.length === 0 && (
                <span className="px-3 py-2 text-[12px] text-[#94a3b8]">No projects yet</span>
              )}
              {projects.map((project) => {
                const href = `/project/${project.id}`;
                const isActive = pathname?.startsWith(href);
                const displayName =
                  isActive && stageProjectId === project.id && stageProjectName
                    ? stageProjectName
                    : project.name;
                return (
                  <div
                    key={project.id}
                    className={`border-l-2 pl-0.5 transition-all ${
                      isActive ? "border-[#4f46e5]" : "border-transparent"
                    }`}
                  >
                    <div className={`rounded-sm transition-colors ${isActive ? "bg-[rgba(79,70,229,0.08)]" : ""}`}>
                      <Link
                        href={href}
                        className="flex items-center gap-3 px-3 py-2 rounded-sm transition-all hover:bg-[rgba(226,232,240,0.6)]"
                      >
                        <span className={`transition-colors shrink-0 ${isActive ? "text-[#4f46e5]" : "text-[#94a3b8]"}`}>
                          <FileIcon />
                        </span>
                        <span className={`text-[13px] tracking-[-0.3px] truncate transition-colors ${isActive ? "text-[#4f46e5] font-semibold" : "text-[#475569] font-medium"}`}>
                          {displayName}
                        </span>
                      </Link>
                    </div>
                  </div>
                );
              })}
          </div>
        </details>
      </nav>

      {/* Bottom: New Project + User Profile */}
      <div className="flex flex-col gap-6 px-4" style={noDragStyle}>
        <button
          onClick={handleNewProject}
          className="flex items-center justify-center gap-2 w-full py-2 bg-[#4f46e5] text-white text-[14px] font-bold rounded-[2px] hover:bg-[#4338ca] transition-colors"
        >
          <PlusIcon />
          <span>New Project</span>
        </button>

        <div className="border-t border-[#e2e8f0] flex items-center gap-3 pt-[17px] pb-2 px-3">
          <div className="w-8 h-8 rounded-[12px] bg-[#e2e8f0] shrink-0 overflow-hidden">
            <div className="w-full h-full bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center text-white text-[13px] font-bold">
              A
            </div>
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="text-[12px] font-bold text-[#0f172a] leading-4 truncate">Alex Chen</span>
            <span className="text-[10px] text-[#64748b] leading-[15px] truncate">Senior Architect</span>
          </div>
        </div>
      </div>
    </aside>
>>>>>>> 422487b (feat: 更新 AppNav 组件，添加项目管理功能和新图标)
  );
}
