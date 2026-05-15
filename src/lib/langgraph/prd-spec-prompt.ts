/**
 * PrdSpec → frontend-worker prompt helpers.
 *
 * Given a task's `coversRequirementIds` and the structured PrdSpec, pick
 * only the pages / interactive components this task is supposed to
 * implement and render them as a compact markdown block. Keeps the worker
 * focused on concrete ids rather than making it re-read the full PRD.
 */

import type { PrdSpec, PrdPage } from "@/lib/requirements/prd-spec-types";
import type { CodingTask } from "@/lib/pipeline/types";

const MAX_PRD_SPEC_CHARS = 2_000;

/**
 * Extract the subset of PrdSpec entries relevant to this task. Returns an
 * empty string when the task covers no PAGE / CMP ids or the spec is empty.
 */
export function pickPrdSpecEntriesForTask(
  task: CodingTask,
  spec: PrdSpec | null | undefined,
): string {
  if (!spec || !Array.isArray(spec.pages) || spec.pages.length === 0) return "";

  const coveredIds = new Set(
    (task.coversRequirementIds ?? []).map((id) => id.toUpperCase()),
  );
  const pageIds = new Set<string>();
  const componentIds = new Set<string>();
  for (const id of coveredIds) {
    if (id.startsWith("PAGE-")) pageIds.add(id);
    else if (id.startsWith("CMP-")) componentIds.add(id);
  }

  if (pageIds.size === 0 && componentIds.size === 0) return "";

  const relevantPages: Array<{
    page: PrdPage;
    cmpFilter: Set<string> | null;
  }> = [];

  for (const page of spec.pages) {
    const pageHit = pageIds.has(page.id.toUpperCase());
    const pageComponents = page.interactiveComponents ?? [];
    const cmpHits = pageComponents.filter((c) =>
      componentIds.has(c.id.toUpperCase()),
    );

    if (pageHit) {
      relevantPages.push({ page, cmpFilter: null }); // include all components
    } else if (cmpHits.length > 0) {
      relevantPages.push({
        page,
        cmpFilter: new Set(cmpHits.map((c) => c.id.toUpperCase())),
      });
    }
  }

  if (relevantPages.length === 0) return "";

  const lines: string[] = [
    "## PRD Spec — concrete work for this task",
    "",
    "Implement the following pages / interactive components. Every `PAGE-*`",
    "and `CMP-*` listed here MUST map to a matching view / component in the",
    "generated code (e.g. a route file, a React component, or wiring code).",
    "",
  ];
  for (const { page, cmpFilter } of relevantPages) {
    lines.push(
      `### ${page.id} — ${page.name} (route: \`${page.route}\`)`,
    );
    if (Array.isArray(page.layoutRegions) && page.layoutRegions.length > 0) {
      lines.push(`**Layout:** ${page.layoutRegions.join(" | ")}`);
    }
    if (Array.isArray(page.states) && page.states.length > 0) {
      lines.push(`**States:** ${page.states.join(", ")}`);
    }
    const components = (page.interactiveComponents ?? []).filter((c) =>
      cmpFilter ? cmpFilter.has(c.id.toUpperCase()) : true,
    );
    if (components.length > 0) {
      lines.push("**Interactive components:**");
      for (const c of components) {
        lines.push(
          `- \`${c.id}\` **${c.name}** (${c.type}, ${c.location}) — ${c.interaction} → ${c.effect}`,
        );
      }
    }
    lines.push("");
  }

  const block = lines.join("\n");
  return block.length > MAX_PRD_SPEC_CHARS
    ? block.slice(0, MAX_PRD_SPEC_CHARS) + "\n… (truncated)"
    : block;
}
