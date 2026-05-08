"use client";

import { useState, useEffect, useCallback } from "react";
import { type Project } from "@/types/project";

interface UseProjectsReturn {
  projects: Project[];
  loading: boolean;
  /** Create a new project by name. Returns the created project. */
  createProject: (name: string) => Promise<Project>;
  /**
   * Add a placeholder project to local state only — no API call.
   * Inserted at the front of the list so it appears first in the sidebar.
   */
  addLocalProject: (name?: string) => Project;
  refresh: () => Promise<void>;
}

export function useProjects(): UseProjectsReturn {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const data = (await res.json()) as { projects: Project[] };
      setProjects(data.projects ?? []);
    } catch {
      // silently ignore network errors; keep stale data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createProject = useCallback(
    async (name: string): Promise<Project> => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { message?: string };
        throw new Error(err.message ?? "Failed to create project.");
      }

      const data = (await res.json()) as { project: Project };
      setProjects((prev) => [...prev, data.project]);
      return data.project;
    },
    [],
  );

  const addLocalProject = useCallback((name = "New Project"): Project => {
    const slug =
      name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || `project-${Date.now()}`;

    const project: Project = {
      id: crypto.randomUUID(),
      slug,
      name,
      createdAt: new Date().toISOString(),
    };

    // Insert at the front so it's first in the sidebar
    setProjects((prev) => [project, ...prev]);
    return project;
  }, []);

  return { projects, loading, createProject, addLocalProject, refresh };
}
