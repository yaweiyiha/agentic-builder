# QA / Mockup Review & Test Plan Skill

**Capability references:**

- [MOCKUP_REVIEW_AGENT_CAPABILITIES_V1.md](https://github.com/Jacobgxd/57Block_MVP_Builder/blob/main/.blueprint/agent-capabilities/MOCKUP_REVIEW_AGENT_CAPABILITIES_V1.md) — quality gate on runnable Mockup vs PRD / UI Spec / design.
- [PM_AGENT_CAPABILITIES_V1.md](https://github.com/Jacobgxd/57Block_MVP_Builder/blob/main/.blueprint/agent-capabilities/PM_AGENT_CAPABILITIES_V1.md) §2.7 — acceptance criteria (Given–When–Then) consumable by tests.

This skill supports **(A)** structured **test/audit artifacts** from PRD + Design, and **(B)** when a runnable Mockup exists, **review-style checks** aligned with Mockup Review (no direct edits to upstream or mock codebase here unless orchestration assigns implementation fixes to another agent).

## Trigger

- Design spec is available and QA phase starts, **or**
- Mockup build is ready for review / regression after regenerate.

## Runtime (protocol)

- **Full Runtime** (review-oriented): **think → plan → execute → reflect**.
- Structured `runtime` fields; `handoff_request` when owner should be PM, UI Designer, Mockup Agent, or Orchestrator—**no** `active_agent` writes.

## Part A — Test plan & audit artifact (P0)

1. Read `.blueprint/context/PRD.md` and `.blueprint/context/DESIGN.md`.
2. Map **acceptance criteria** to **components, flows, and states**; flag PRD ↔ Design inconsistencies.
3. Produce **AUDIT-style** JSON (see QA Agent prompt) with coverage matrix, suites (unit / integration / e2e as applicable), **Given–When–Then** cases.
4. Enforce gates: **≥80%** requirement coverage; all **P0** requirements have cases.
5. Output: `.blueprint/context/AUDIT.json` (or path mandated by orchestration).

## Part B — Mockup review alignment (when Mockup exists)

Apply **Mockup Review** P0 mindset:

1. **Multi-asset baseline** — PRD, UI Spec/DESIGN, design summary, mockup run output, versions. Record `input_versions`; never mix mismatched baselines.
2. **Page completeness** — P0 pages exist and are reachable from declared entry points.
3. **Flow walkthrough** — Core path navigable; CTAs/forms show credible front-end feedback (mock data OK).
4. **States** — Loading / empty / error / success / disabled where spec requires—**verifiable**, not only static screens.
5. **Spec consistency** — Page roles, modules, layout, components, interaction rules, copy skeleton vs PRD/DESIGN; cite `spec_basis` per issue.
6. **Visual drift** — Material deviations from design hierarchy (not pixel-perfect nitpicks).
7. **Severity** — `critical` | `major` | `minor` | `note`; **critical** flow/page/state gaps → `blocked`.
8. **Attribution (initial)** — `requirement_gap` | `ui_spec_gap` | `design_drift` | `mockup_implementation_issue` | `upstream_conflict` (mark low confidence when evidence is thin).
9. **Verdict** — `pass` | `pass_with_risks` | `blocked`; `can_proceed` for orchestration.
10. **Routes** — Suggest PM / UI Designer / Mockup Agent / Orchestrator per issue class.
11. **Regression** — After fixes, compare to prior issue list: resolved / unresolved / new.

## Structured outputs (partial)

`status`, `input_versions`, `review_scope`, `coverage_summary`, `issues[]`, `blocking_issue_count`, `non_blocking_issue_count`, `risk_summary`, `recommended_routes`, `can_proceed`, `resolved_issue_ids`, `unresolved_issue_ids`, `new_issue_ids`, plus audit fields for test-plan mode; `runtime`, `handoff_request`, `needs_confirmation`, `affected_assets`.

## Failure handling

- Missing PRD/Design → block; specify missing asset.
- No observable Mockup (no preview, no files) → **do not** fake pass.
- Upstream spec conflict → `upstream_conflict`, blocked, Orchestrator.

## Prohibitions

- Do **not** edit PRD, UI Spec/DESIGN, design sources, or Mockup source as the *default* action of this skill unless explicitly delegated.
- Do **not** broaden scope to Tech Spec or production backend review.
- Do **not** output **only** prose—issues and audit must be **structured**.

## LLM

- Use project default (**`gemini-3-pro-preview`** unless overridden).
