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
  /**
   * Optional domain specification — only populated when the PRD describes
   * structured domain logic that downstream codegen would otherwise have
   * to invent (rule mappings, external data adapters, scheduled jobs,
   * entity state machines). Empty / undefined for plain CRUD apps.
   *
   * Each sub-field is independently conditional: a project might have
   * variables and rules but no schedules, etc. Field-level absence is
   * fine — TRD generation falls back to its existing prompt-only flow.
   */
  domain?: PrdDomainSpec;
}

// ─── Domain spec — domain-driven structured PRD data ────────────────────────

export interface PrdDomainSpec {
  /** Discrete instances the system tracks (e.g. stablecoins to score,
   *  payment tiers, supported currencies). Codegen seeds them as
   *  fixtures or initial-data migrations. */
  entities?: PrdEntityCatalog[];
  /** Named metrics / variables the system computes. Drives both the
   *  data model and the rule input/output contract. */
  variables?: PrdVariableSpec[];
  /** Numeric-rule mapping tables (piecewise-linear, decision-table).
   *  Boundary values come from the PRD — TRD §7 should *quote* these
   *  values verbatim, not regenerate them. */
  rules?: PrdRuleSpec[];
  /** External APIs / files / scrapes the system pulls from. Drives
   *  the adapter scaffold and the runtime auth/secret requirements. */
  dataSources?: PrdDataSourceSpec[];
  /** Periodic jobs — feeds TRD §8 workflow DAG schedule + runner setup. */
  schedules?: PrdScheduleSpec[];
  /** Entity-level finite-state machines (distinct from per-page UI states
   *  in `pages[].states`). e.g. an audit record going pending →
   *  approved/rejected with an audit trail. */
  workflows?: PrdWorkflowSpec[];
  /** Alert thresholds — feeds notification service templates. */
  alerts?: PrdAlertSpec[];
}

export interface PrdEntityCatalog {
  /** Plural entity type — "stablecoins", "currencies", "tiers". */
  type: string;
  /** Each instance the system tracks. Free-form attributes keyed by
   *  name; codegen seeds these as fixtures or initial-data migrations. */
  instances: Array<Record<string, string | number | boolean | null>>;
}

export interface PrdVariableSpec {
  /** Stable ID — e.g. RQ-1, MC-5, SCORE-A. Used by rules to reference inputs/outputs. */
  id: string;
  name: string;
  /** What the variable measures, in business language. */
  description: string;
  /** Free-form unit annotation — "%", "USD", "rating(1-5)", "count". */
  unit?: string;
  /** Where the raw value comes from — references PrdDataSourceSpec.id when applicable. */
  source?: string;
  /** Historical window required for time-series computations — "7d", "30d", "none". */
  historyWindow?: string;
}

export interface PrdRuleSpec {
  /** Stable rule ID — e.g. RQ-1-NORM, SCORE-1. */
  id: string;
  name: string;
  description?: string;
  /** Currently supported by the MVP DSL renderer. Other types pass
   *  through as analytical metadata only. */
  type: "piecewise-linear" | "decision-table" | "other";
  /** For piecewise-linear: input variable id (PrdVariableSpec.id). */
  inputVariableId?: string;
  /** For piecewise-linear: each segment's boundary + output range. */
  segments?: Array<{
    from: number;
    to: number;
    outputFrom: number;
    outputTo: number;
  }>;
  /** For decision-table: ordered case list, top-to-bottom evaluation. */
  cases?: Array<{
    when: Record<string, string | number | boolean>;
    then: string | number | boolean;
  }>;
  /** For "other" — free-form natural-language formula description. */
  formula?: string;
}

export interface PrdDataSourceSpec {
  id: string;
  name: string;
  /** "http-rest" | "websocket" | "rss" | "graphql" | "pdf-extract" | "manual-fixture" */
  kind: string;
  baseUrl?: string;
  auth?: "none" | "api-key-header" | "bearer" | "oauth2" | "basic";
  /** Free-form rate limit annotation — "30 rpm", "1000 rpd". */
  rateLimit?: string;
  /** Field-level mapping hint — "id → instances.coingecko_id". */
  fieldMapping?: string;
  /** Static fallback values when live data is unavailable. Codegen
   *  injects these as `PROVIDED_*` constants in the adapter file. */
  fixtures?: Array<Record<string, string | number | boolean | null>>;
  /** Freshness contract — "fresh<5min, stale<15min, dead>30min". */
  freshness?: string;
}

export interface PrdScheduleSpec {
  id: string;
  description: string;
  /** Cron string OR human-readable interval ("every 5 minutes"). */
  cron?: string;
  intervalHuman?: string;
  /** Pipeline id this schedule triggers — references TRD §8 DAG pipelines[].id. */
  pipelineId?: string;
}

export interface PrdWorkflowSpec {
  id: string;
  entity: string;
  initial: string;
  states: string[];
  transitions: Array<{
    from: string;
    to: string;
    action: string;
    /** Field names that must be present on the action input. */
    requires?: string[];
    /** Natural-language guard description. */
    guard?: string;
  }>;
  /** Whether each transition records an audit log row. */
  auditTrail?: boolean;
}

export interface PrdAlertSpec {
  id: string;
  description: string;
  /** Free-form trigger description — "score delta >= 25 within one cycle". */
  trigger: string;
  /** Severity level — "critical" | "high" | "medium" | "low". */
  severity?: string;
  /** Delivery channel hints — "email", "push", "in-app". */
  channels?: string[];
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
