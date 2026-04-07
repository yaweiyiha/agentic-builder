---
name: blueprint-pipeline
description: >-
  Guide for the Blueprint PDLC pipeline system. Use when working on the automated
  Intent → PRD → Design → QA → Verification pipeline, agent orchestration,
  .blueprint/ context management, HITL gates, or pipeline UI.
---

# Blueprint PDLC Pipeline

## Pipeline: 7 Steps, 4 Gates

| Step | Agent | Output | Gate |
|------|-------|--------|------|
| 1 | PM Agent | PRD.md | Gate 1: PM Review |
| 2 | Design Agent | DESIGN.md | Gate 2: Design Review |
| 3 | Dev Agent | TECH_SPEC.md | Gate 3: Arch Review |
| 4 | Dev Agent | TASKS.md | — |
| 5 | Coding Agents | Code + PR | — |
| 6 | QA Agent | AUDIT.json | — |
| 7 | Human Supervisor | Merged PR | Gate 4: PR Review |

Currently implemented: Steps 1-2 + QA Audit + Global Verifier.

## Key Files

- `src/lib/pipeline/engine.ts` — Pipeline orchestrator
- `src/lib/pipeline/types.ts` — Pipeline types (PipelineRun, StepResult)
- `src/lib/agents/*.ts` — Agent implementations
- `src/app/api/agents/pipeline/route.ts` — Pipeline API endpoint
- `src/app/(dashboard)/pipeline/page.tsx` — Pipeline UI
- `src/store/pipeline-store.ts` — Zustand state

## `.blueprint/` Directory

```
.blueprint/
├── CLAUDE.md              # Static project context (<2000 tokens)
├── NOTES.md               # Cross-session memory
├── context/               # Pipeline output artifacts
│   ├── PRD.md
│   ├── DESIGN.md
│   ├── TECH_SPEC.md
│   └── AUDIT.json
├── skills/                # Agent skills
│   ├── pm/
│   ├── design/
│   ├── dev/
│   └── qa/
└── checkpoints/           # HITL gate records
    ├── gate-1-prd-approved.md
    └── gate-2-design-approved.md
```

## Context Injection (3 Layers)

1. **CLAUDE.md** — Static base (<2000 tokens), auto-injected
2. **`.blueprint/context/`** — Dynamic, RAG retrieval per task
3. **NOTES.md** — Cross-session memory, auto-loaded

## Adding a New Pipeline Step

1. Create agent in `src/lib/agents/`
2. Register in `src/lib/pipeline/engine.ts`
3. Add step type to `src/lib/pipeline/types.ts`
4. Update UI in pipeline page

## Drift Detection

The Verifier Agent (gemini-pro) compares PRD vs Design:
- Score < 70% → ESCALATE_TO_HUMAN
- Score 70-85% → REVISE_DESIGN
- Score 85-95% → PROCEED with warnings
- Score 95%+ → PROCEED

API: `POST /api/verify` with `{ prdContent, designContent }`
