// ── Declarative 3-level Pipeline Flow Configuration ──────────────────────────
//
// Level 1 = Stage   (preparation / kickoff / coding / preview)
// Level 2 = Group   (input / core-docs / tech-docs / design / quality …)
// Level 3 = Step    (initial / intent / prd / trd / …)
//
// Breadcrumb renders:  Stage > Group > [Step₁ ∥ Step₂ ∥ Step₃]

// ── Tier ──────────────────────────────────────────────────────────────────────
export type ProjectTier = "S" | "M" | "L";

// ── Step ID (all 20 steps) ────────────────────────────────────────────────────
export type StepId =
  // preparation
  | "initial"
  | "intent"
  | "prd"
  | "trd"
  | "sysdesign"
  | "implguide"
  | "design"
  | "pencil"
  | "mockup"
  | "qa"
  | "verify"
  // kickoff
  | "env-setup"
  | "summary"
  | "task-breakdown"
  // coding
  | "agents"
  // preview
  | "serve"
  | "e2e";

export type GroupId =
  | "input"
  | "core-docs"
  | "tech-docs"
  | "design"
  | "quality"
  | "setup"
  | "planning"
  | "summary"
  | "agents"
  | "server"
  | "testing";

export type StageId = "preparation" | "kickoff" | "coding" | "preview";

// ── Flow Node ─────────────────────────────────────────────────────────────────
export type UiKind = "doc-viewer" | "agent-log" | "chat" | "panel" | "custom";
export type DocTabId = "prd" | "design" | "trd" | "qa";
export type AgentRole = "architect" | "backend" | "frontend" | "test";

export interface StepConfig {
  uiKind: UiKind;
  docTabId?: DocTabId;
  agentRole?: AgentRole;
  apiEndpoint?: string;
  autoTrigger?: boolean;
}

export interface FlowNode {
  id: string;
  label: string;
  level: 1 | 2 | 3;
  children?: FlowNode[];
  /** Children (level 3 steps) can run in parallel */
  parallel?: boolean;
  /** Node IDs this group/step depends on */
  dependsOn?: string[];
  /** Only visible/runnable for these tiers (omitted = all tiers) */
  tiers?: ProjectTier[];
  /** Step-specific config (level 3 only) */
  stepConfig?: StepConfig;
}

// ── Flow Definition ───────────────────────────────────────────────────────────

export const PIPELINE_FLOW: FlowNode[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // PREPARATION
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "preparation",
    label: "Preparation",
    level: 1,
    children: [
      {
        id: "initial",
        label: "Initial",
        level: 2,
        stepConfig: { uiKind: "chat" },
      },
      {
        id: "intent",
        label: "Intent",
        level: 2,
        dependsOn: ["initial"],
        stepConfig: {
          uiKind: "chat",
          apiEndpoint: "/api/agents/intent-recheck",
        },
      },
      {
        id: "prd",
        label: "PRD",
        level: 2,
        stepConfig: {
          uiKind: "doc-viewer",
          docTabId: "prd",
          apiEndpoint: "/api/agents/pipeline",
        },
      },
      {
        id: "design",
        label: "Design",
        level: 2,
        dependsOn: ["core-docs"],
        tiers: ["M", "L"],
        stepConfig: {
          uiKind: "custom",
          docTabId: "design",
          apiEndpoint: "/api/agents/parallel-generate",
        },
      },
      {
        id: "tech-docs",
        label: "Tech Docs",
        level: 2,
        dependsOn: ["core-docs"],
        tiers: ["M", "L"],
        parallel: true,
        children: [
          {
            id: "trd",
            label: "TRD",
            level: 3,
            stepConfig: {
              uiKind: "doc-viewer",
              docTabId: "trd",
              apiEndpoint: "/api/agents/parallel-generate",
            },
          },
          // {
          //   id: "sysdesign",
          //   label: "System Design",
          //   level: 3,
          //   stepConfig: {
          //     uiKind: "doc-viewer",
          //     apiEndpoint: "/api/agents/parallel-generate",
          //   },
          // },
          // {
          //   id: "implguide",
          //   label: "Impl. Guide",
          //   level: 3,
          //   stepConfig: {
          //     uiKind: "doc-viewer",
          //     apiEndpoint: "/api/agents/parallel-generate",
          //   },
          // },
        ],
      },
      {
        id: "quality",
        label: "Quality",
        level: 2,
        dependsOn: ["core-docs"],
        tiers: ["M", "L"],
        parallel: true,
        children: [
          {
            id: "qa",
            label: "QA Plan",
            level: 3,
            stepConfig: {
              uiKind: "doc-viewer",
              docTabId: "qa",
              apiEndpoint: "/api/agents/parallel-generate",
              autoTrigger: true,
            },
          },
          // {
          //   id: "verify",
          //   label: "Verify",
          //   level: 3,
          //   stepConfig: {
          //     uiKind: "doc-viewer",
          //     apiEndpoint: "/api/agents/parallel-generate",
          //     autoTrigger: true,
          //   },
          // },
        ],
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // KICK-OFF
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "kickoff",
    label: "Kick-off",
    level: 1,
    dependsOn: ["preparation"],
    children: [
      {
        id: "summary",
        label: "Summary",
        level: 2,
        stepConfig: {
          uiKind: "panel",
          apiEndpoint: "/api/agents/kickoff",
        },
      },
      {
        id: "task-breakdown",
        label: "Task Breakdown",
        level: 2,
        dependsOn: ["summary"],
        stepConfig: { uiKind: "panel" },
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CODING
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "coding",
    label: "Coding",
    level: 1,
    dependsOn: ["kickoff"],
    children: [
      {
        id: "agents",
        label: "Agents",
        level: 2,
        stepConfig: {
          uiKind: "panel",
        },
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PREVIEW
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "preview",
    label: "Preview",
    level: 1,
    dependsOn: ["coding"],
    children: [
      {
        id: "server",
        label: "Server",
        level: 2,
        children: [
          {
            id: "serve",
            label: "Dev Server",
            level: 3,
            stepConfig: { uiKind: "custom" },
          },
        ],
      },
      {
        id: "testing",
        label: "Testing",
        level: 2,
        dependsOn: ["server"],
        children: [
          {
            id: "e2e",
            label: "E2E",
            level: 3,
            stepConfig: { uiKind: "custom" },
          },
        ],
      },
    ],
  },
];

// ── Derived Helpers ───────────────────────────────────────────────────────────

/** Flat list of all StepIds in display order. */
export function getAllStepIds(): StepId[] {
  const result: StepId[] = [];
  const walk = (nodes: FlowNode[]) => {
    for (const n of nodes) {
      if (n.level === 3) {
        result.push(n.id as StepId);
      } else if (n.children) {
        walk(n.children);
      } else if (n.level === 2) {
        // Level-2 standalone step (e.g., initial, intent, prd)
        result.push(n.id as StepId);
      }
    }
  };
  walk(PIPELINE_FLOW);
  return result;
}

/** Flat list of all level-2 GroupIds in display order. */
export function getAllGroupIds(): GroupId[] {
  const result: GroupId[] = [];
  for (const stage of PIPELINE_FLOW) {
    if (stage.children) {
      for (const group of stage.children) {
        result.push(group.id as GroupId);
      }
    }
  }
  return result;
}

/** Flat list of all level-1 StageIds in display order. */
export function getAllStageIds(): StageId[] {
  return PIPELINE_FLOW.map((s) => s.id as StageId);
}

/** Map StepId → { stageId, groupId, node } for breadcrumb rendering. */
export function getNodePath(
  stepId: StepId,
): { stage: FlowNode; group: FlowNode; step: FlowNode } | null {
  for (const stage of PIPELINE_FLOW) {
    if (!stage.children) continue;
    for (const group of stage.children) {
      // Level-2 standalone step (e.g., initial, intent, prd) — the group *is* the step
      if (group.id === stepId) return { stage, group, step: group };
      if (!group.children) continue;
      for (const step of group.children) {
        if (step.id === stepId) return { stage, group, step };
      }
    }
  }
  return null;
}

/** Get a single step config by StepId. */
export function getStepConfig(stepId: StepId): StepConfig | undefined {
  for (const stage of PIPELINE_FLOW) {
    if (!stage.children) continue;
    for (const group of stage.children) {
      // Level-2 standalone step (e.g., initial, intent, prd)
      if (group.id === stepId) return group.stepConfig;
      if (!group.children) continue;
      for (const step of group.children) {
        if (step.id === stepId) return step.stepConfig;
      }
    }
  }
  return undefined;
}

/** Get full FlowNode by ID (any level). */
export function getFlowNode(id: string): FlowNode | undefined {
  const walk = (nodes: FlowNode[]): FlowNode | undefined => {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children) {
        const found = walk(n.children);
        if (found) return found;
      }
    }
    return undefined;
  };
  return walk(PIPELINE_FLOW);
}

/** Get the stage that contains a given step. */
export function getStageForStep(stepId: StepId): StageId | undefined {
  const path = getNodePath(stepId);
  return path?.stage.id as StageId | undefined;
}

/** Given a step, get its default next step respecting flow order and dependencies. */
export function getNextStep(stepId: StepId, tier: ProjectTier): StepId | null {
  const allVisible = getStepsForTier(tier);
  const idx = allVisible.indexOf(stepId);
  if (idx < 0 || idx >= allVisible.length - 1) return null;
  return allVisible[idx + 1];
}

/** Given a step, get the previous step. */
export function getPrevStep(stepId: StepId, tier: ProjectTier): StepId | null {
  const allVisible = getStepsForTier(tier);
  const idx = allVisible.indexOf(stepId);
  if (idx <= 0) return null;
  return allVisible[idx - 1];
}

/** Get flat list of steps visible for a given tier. */
export function getStepsForTier(tier: ProjectTier): StepId[] {
  const result: StepId[] = [];
  const walk = (nodes: FlowNode[]) => {
    for (const n of nodes) {
      if (n.tiers && !n.tiers.includes(tier)) continue;
      if (n.level === 3) {
        result.push(n.id as StepId);
      } else if (n.children) {
        walk(n.children);
      } else if (n.level === 2) {
        // Level-2 standalone step (e.g., initial, intent, prd)
        result.push(n.id as StepId);
      }
    }
  };
  walk(PIPELINE_FLOW);
  return result;
}

/** Get groups visible for a tier. */
export function getGroupsForTier(tier: ProjectTier): FlowNode[] {
  const result: FlowNode[] = [];
  for (const stage of PIPELINE_FLOW) {
    if (!stage.children) continue;
    for (const group of stage.children) {
      if (group.tiers && !group.tiers.includes(tier)) continue;
      // If the group has no tier filter, or tier matches, include it with
      // children filtered to visible steps.
      const visibleChildren = group.children?.filter(
        (s) => !s.tiers || s.tiers.includes(tier),
      );
      result.push({ ...group, children: visibleChildren });
    }
  }
  return result;
}

/** Check if all `dependsOn` steps for a given step are completed. */
export function areDependenciesMet(
  stepId: StepId,
  completedStepIds: Set<string>,
): boolean {
  const node = getFlowNode(stepId);
  if (!node?.dependsOn || node.dependsOn.length === 0) return true;
  return node.dependsOn.every((depId) => completedStepIds.has(depId));
}

/** Get the stage-level nodes filtered by tier. */
export function getStagesForTier(tier: ProjectTier): FlowNode[] {
  return PIPELINE_FLOW.filter((s) => !s.tiers || s.tiers.includes(tier));
}

// ── Display Labels ────────────────────────────────────────────────────────────

export const STEP_LABELS: Record<StepId, string> = {
  initial: "Initial",
  intent: "Intent",
  prd: "PRD",
  trd: "TRD",
  sysdesign: "System Design",
  implguide: "Impl. Guide",
  design: "Design Spec",
  pencil: "Pencil",
  mockup: "Mockup",
  qa: "QA",
  verify: "Verify",
  "env-setup": "Env Setup",
  summary: "Summary",
  "task-breakdown": "Task Breakdown",
  agents: "Agents",
  serve: "Dev Server",
  e2e: "E2E",
};

export const GROUP_LABELS: Record<GroupId, string> = {
  input: "Input",
  "core-docs": "Core Docs",
  "tech-docs": "Tech Docs",
  design: "Design",
  quality: "Quality",
  setup: "Setup",
  planning: "Planning",
  summary: "Summary",
  agents: "Agents",
  server: "Server",
  testing: "Testing",
};

export const STAGE_LABELS: Record<StageId, { num: string; name: string }> = {
  preparation: { num: "01", name: "Preparation" },
  kickoff: { num: "02", name: "Kick-off" },
  coding: { num: "03", name: "Coding" },
  preview: { num: "04", name: "Preview" },
};
