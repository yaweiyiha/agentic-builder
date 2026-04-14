/**
 * Lightweight index of PRD requirement IDs extracted for coverage gates.
 * IDs follow conventions from PM prompts: AC-*, FR-*, US-*, IC-*.
 */
export interface PrdRequirementIndex {
  acceptanceCriteriaIds: string[];
  featureIds: string[];
  userStoryIds: string[];
  componentIds: string[];
}

// ─── Structured PRD Spec (LLM-extracted, richer than raw ID scan) ──────────

/** A single interactive UI component extracted from the PRD. */
export interface PrdInteractiveComponent {
  /** Stable component ID, e.g. CMP-001, assigned sequentially across all pages. */
  id: string;
  name: string;
  /** Broad control type: button | input | toggle | select | link | tab | form | modal | list | slider | ... */
  type: string;
  /** Which layout region it lives in (e.g. "Header", "Body", "Footer", "Sidebar"). */
  location: string;
  /** What the user does: "Click", "Type and blur", "Drag", "Toggle", etc. */
  interaction: string;
  /** Resulting UI feedback + outcome. */
  effect: string;
}

/** Specification for one page / screen extracted from the PRD. */
export interface PrdPage {
  /** Stable page ID, e.g. PAGE-001. */
  id: string;
  name: string;
  route: string;
  /** Ordered list of layout region descriptions, top-to-bottom or left-to-right. */
  layoutRegions: string[];
  /** All interactive controls on this page. */
  interactiveComponents: PrdInteractiveComponent[];
  /** Read-only / non-interactive elements (labels, counters, status text, etc.). */
  staticElements: string[];
  /** Named UI states for this page (e.g. "loading", "empty", "error", "success"). */
  states: string[];
}

/** Full structured specification extracted from the PRD via LLM. */
export interface PrdSpec {
  pages: PrdPage[];
  /** All CMP IDs across all pages — convenience for coverage gates. */
  allComponentIds: string[];
}

/** Wireframe image generated for a single PRD page. */
export interface PrdPageWireframe {
  pageId: string;
  pageName: string;
  imageUrl: string;
}

export interface GateReportBase {
  gateId: string;
  passed: boolean;
  warnings: string[];
  missingIds: string[];
}
