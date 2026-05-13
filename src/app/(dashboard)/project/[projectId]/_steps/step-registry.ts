// ── Step Registry ────────────────────────────────────────────────────────────
//
// Maps every StepId to its UI component and agent.
// Used by page.tsx to render the active step.

import type { StepId } from "@/_config/pipeline-flow";
import type { StepAgent, StepUIProps } from "./_shared/types";
import type { ComponentType } from "react";

// ── Preparation > Input ──
import { initialAgent } from "./preparation/input/initial/agent";
import { InitialUI } from "./preparation/input/initial/ui";
import { initialSnapshot } from "./preparation/input/initial/snapshot";

import { intentAgent } from "./preparation/input/intent/agent";
import { IntentUI } from "./preparation/input/intent/ui";
import { intentSnapshot } from "./preparation/input/intent/snapshot";

// ── Preparation > Core Docs ──
import { prdAgent } from "./preparation/core-docs/prd/agent";
import { PrdUI } from "./preparation/core-docs/prd/ui";
import { prdSnapshot } from "./preparation/core-docs/prd/snapshot";

// ── Preparation > Tech Docs ──
import { trdAgent } from "./preparation/tech-docs/trd/agent";
import { TrdUI } from "./preparation/tech-docs/trd/ui";
import { trdSnapshot } from "./preparation/tech-docs/trd/snapshot";

import { sysdesignAgent } from "./preparation/tech-docs/sysdesign/agent";
import { SysDesignUI } from "./preparation/tech-docs/sysdesign/ui";
import { sysdesignSnapshot } from "./preparation/tech-docs/sysdesign/snapshot";

import { implguideAgent } from "./preparation/tech-docs/implguide/agent";
import { ImplGuideUI } from "./preparation/tech-docs/implguide/ui";
import { implguideSnapshot } from "./preparation/tech-docs/implguide/snapshot";

// ── Preparation > Design ──
import { designAgent } from "./preparation/design-group/design/agent";
import { DesignUI } from "./preparation/design-group/design/ui";
import { designSnapshot } from "./preparation/design-group/design/snapshot";

import { pencilAgent } from "./preparation/design-group/pencil/agent";
import { PencilUI } from "./preparation/design-group/pencil/ui";
import { pencilSnapshot } from "./preparation/design-group/pencil/snapshot";

import { mockupAgent } from "./preparation/design-group/mockup/agent";
import { MockupUI } from "./preparation/design-group/mockup/ui";
import { mockupSnapshot } from "./preparation/design-group/mockup/snapshot";

// ── Preparation > Quality ──
import { qaAgent } from "./preparation/quality/qa/agent";
import { QaUI } from "./preparation/quality/qa/ui";
import { qaSnapshot } from "./preparation/quality/qa/snapshot";

import { verifyAgent } from "./preparation/quality/verify/agent";
import { VerifyUI } from "./preparation/quality/verify/ui";
import { verifySnapshot } from "./preparation/quality/verify/snapshot";

// ── Kickoff ──
import { envSetupAgent } from "./kickoff/setup/env-setup/agent";
import { EnvSetupUI } from "./kickoff/setup/env-setup/ui";
import { envSetupSnapshot } from "./kickoff/setup/env-setup/snapshot";

import { summaryAgent } from "./kickoff/summary/agent";
import { SummaryUI } from "./kickoff/summary/ui";
import { summarySnapshot } from "./kickoff/summary/snapshot";

import { taskBreakdownAgent } from "./kickoff/planning/task-breakdown/agent";
import { TaskBreakdownUI } from "./kickoff/planning/task-breakdown/ui";
import { taskBreakdownSnapshot } from "./kickoff/planning/task-breakdown/snapshot";

// ── Coding > Agents ──
import { agentsAgent } from "./coding/agents/agent";
import { AgentsUI } from "./coding/agents/ui";
import { agentsSnapshot } from "./coding/agents/snapshot";

// ── Preview ──
import { serveAgent } from "./preview/server/serve/agent";
import { ServeUI } from "./preview/server/serve/ui";
import { serveSnapshot } from "./preview/server/serve/snapshot";

import { e2eAgent } from "./preview/testing/e2e/agent";
import { E2eUI } from "./preview/testing/e2e/ui";
import { e2eSnapshot } from "./preview/testing/e2e/snapshot";

// ── Registry Map ──────────────────────────────────────────────────────────────

export interface StepEntry {
  component: ComponentType<StepUIProps>;
  agent: StepAgent;
  snapshot: { load: (projectSlug: string) => Promise<unknown>; save: (projectSlug: string, data: unknown) => Promise<void>; getContextFromPrevious: (previousSnapshot: unknown) => Record<string, unknown> };
}

export const STEP_REGISTRY: Record<StepId, StepEntry> = {
  // Preparation
  initial:      { component: InitialUI,      agent: initialAgent,      snapshot: initialSnapshot },
  intent:       { component: IntentUI,       agent: intentAgent,       snapshot: intentSnapshot },
  prd:          { component: PrdUI,          agent: prdAgent,          snapshot: prdSnapshot },
  trd:          { component: TrdUI,          agent: trdAgent,          snapshot: trdSnapshot },
  sysdesign:    { component: SysDesignUI,    agent: sysdesignAgent,    snapshot: sysdesignSnapshot },
  implguide:    { component: ImplGuideUI,    agent: implguideAgent,    snapshot: implguideSnapshot },
  design:       { component: DesignUI,       agent: designAgent,       snapshot: designSnapshot },
  pencil:       { component: PencilUI,       agent: pencilAgent,       snapshot: pencilSnapshot },
  mockup:       { component: MockupUI,       agent: mockupAgent,       snapshot: mockupSnapshot },
  qa:           { component: QaUI,           agent: qaAgent,           snapshot: qaSnapshot },
  verify:       { component: VerifyUI,       agent: verifyAgent,       snapshot: verifySnapshot },
  // Kickoff
  "env-setup":      { component: EnvSetupUI,      agent: envSetupAgent,      snapshot: envSetupSnapshot },
  summary:          { component: SummaryUI,        agent: summaryAgent,        snapshot: summarySnapshot },
  "task-breakdown": { component: TaskBreakdownUI, agent: taskBreakdownAgent, snapshot: taskBreakdownSnapshot },
  // Coding
  agents: { component: AgentsUI, agent: agentsAgent, snapshot: agentsSnapshot },
  // Preview
  serve: { component: ServeUI, agent: serveAgent, snapshot: serveSnapshot },
  e2e:   { component: E2eUI,   agent: e2eAgent,   snapshot: e2eSnapshot },
};
