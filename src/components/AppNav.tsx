"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useProjects } from "@/hooks/useProjects";
import { useStageStore, STAGE_META, type StageId } from "@/store/stage-store";
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
  const activeStage = useStageStore((s) => s.activeStage);
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
      className="fixed left-0 top-0 h-screen w-60 bg-white border-r border-slate-200 flex flex-col justify-between z-50 pr-px py-4"
      style={dragStyle}
    >
      {/* Logo & Brand */}
      <div className="px-6 pb-8" style={noDragStyle}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-slate-900 rounded-xs flex items-center justify-center shrink-0">
            <svg width="10.5" height="11.667" viewBox="0 0 12 14" fill="white" aria-hidden>
              <path d="M6 0L12 3.5V10.5L6 14L0 10.5V3.5L6 0Z" />
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="text-[18px] font-bold tracking-[-0.45px] text-slate-900 leading-7">
              Agentic Builder
            </span>
            <span className="text-xs uppercase text-slate-600 leading-3.75 font-space-grotesk">
              V1.0.4
            </span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 min-h-0 px-4 overflow-y-auto" style={noDragStyle}>
        <div className="mb-4">
          <h3 className="text-[12px] uppercase font-semibold text-slate-600 px-2 mb-3 tracking-wide">Projects</h3>
          
          {loading && (
            <span className="px-3 py-2 text-[12px] text-slate-600 block">Loading…</span>
          )}
          {!loading && projects.length === 0 && (
            <span className="px-3 py-2 text-[12px] text-slate-600 block">No projects yet</span>
          )}
          
          <div className="flex flex-col gap-2">
            {projects.map((project) => {
              const href = `/project/${project.id}`;
              const isActive = pathname?.startsWith(href);
              const isCurrentStageProject = isActive && stageProjectId === project.id;
              const displayName =
                isCurrentStageProject && stageProjectName
                  ? stageProjectName
                  : project.name;
              const stageMeta = isCurrentStageProject
                ? STAGE_META[activeStage as StageId]
                : null;

              return (
                <Link
                  key={project.id}
                  href={href}
                  className={`group flex flex-col gap-1.5 p-3 rounded-lg border transition-all ${
                    isActive
                      ? "bg-slate-100 border-slate-200 shadow-sm"
                      : "bg-slate-50 border-slate-200 hover:bg-slate-100 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`transition-colors shrink-0 ${isActive ? "text-slate-600" : "text-slate-500 group-hover:text-slate-600"}`}>
                      <FileIcon />
                    </span>
                    <span className={`text-[13px] tracking-[-0.3px] truncate transition-colors font-medium ${isActive ? "text-slate-900" : "text-slate-700 group-hover:text-slate-900"}`}>
                      {displayName}
                    </span>
                  </div>
                  <div className={`h-px bg-linear-to-r ${isActive ? "from-slate-400 to-transparent" : "from-slate-300 to-transparent"}`}></div>
                  {stageMeta ? (
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                      <span className="text-[11px] text-slate-700 font-medium">
                        {stageMeta.name}
                      </span>
                      <span className="text-[10px] text-slate-500 truncate">
                        — {stageMeta.desc}
                      </span>
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-500">Ready</span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Bottom: New Project + User Profile */}
      <div className="flex flex-col gap-6 px-4" style={noDragStyle}>
        <button
          onClick={handleNewProject}
          className="flex items-center justify-center gap-2 w-full py-2.5 bg-slate-950 text-white text-[14px] font-bold rounded-lg hover:bg-slate-800 hover:shadow-md hover:scale-105 transition-all active:bg-slate-950 active:scale-95"
        >
          <PlusIcon />
          <span>New Project</span>
        </button>

        <div className="border-t border-slate-200 flex items-center gap-3 pt-4.25 pb-2 px-3">
          <div className="w-8 h-8 rounded-xl bg-slate-200 shrink-0 overflow-hidden">
            <div className="w-full h-full bg-linear-to-br from-slate-400 to-slate-500 flex items-center justify-center text-white text-sm font-bold">
              A
            </div>
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="text-[12px] font-bold text-slate-900 leading-4 truncate">Alex Chen</span>
            <span className="text-xs text-slate-600 leading-3.75 truncate">Senior Architect</span>
          </div>
        </div>
      </div>
    </aside>
>>>>>>> 422487b (feat: 更新 AppNav 组件，添加项目管理功能和新图标)
  );
}
