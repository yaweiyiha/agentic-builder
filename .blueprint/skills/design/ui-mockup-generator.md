# UI Design / Mockup Specification Skill

**Capability reference:** Align with [UI_DESIGNER_AGENT_CAPABILITIES_V1.md](https://github.com/Jacobgxd/57Block_MVP_Builder/blob/main/.blueprint/agent-capabilities/UI_DESIGNER_AGENT_CAPABILITIES_V1.md). This skill covers turning **approved PRD** into structured **design assets** and tool-driven mockups. It does **not** ship final production mockup code—that is the Mockup Agent’s job upstream of this skill in the reference architecture; in this repo, **Pencil** replaces Paper/Figma where the reference names those tools.

## Trigger

- PRD is approved (e.g., Gate 1 passed) and design work starts.
- Rework arrives from mockup review, design review, or delivery feedback (classify: visual, IA, or interaction).

## Runtime (protocol)

- Default **Full Runtime**: **think → plan → execute → reflect**.
- Return structured **runtime** summary (same minimum fields as PM skill).
- `handoff_request` only when work belongs to PM (requirements), Mockup (runnable prototype), or execution—**never** write `active_agent` yourself.

## P0 behaviors (must)

1. **PRD intake** — Extract pages, priorities, component trees, interaction states, core flows, roles, design-related boundary rules. Prefer **structured PRD sections** over chat inference. Call out gaps; if PRD conflicts with design direction, **stop** and route to PM—do not invent product scope.
2. **Preferences** — Capture references (links, screenshots), brand color, logo, typography, style keywords, likes/dislikes. Resolve conflicts with explicit user choices; if absent, propose **2–4** coherent directions.
3. **Design system** — Define tokens: color, type, spacing, radius, shadow, elevation/rhythm—with **numeric values** and rationale tied to hierarchy and brand.
4. **UI Spec / DESIGN.md** — Persist to **`.blueprint/context/DESIGN.md`** (this project’s UI spec). Include: meta, design system, per-page visual intent, component specs, motion/a11y/responsive strategy, implementation priority, iteration history. Descriptions must be **token- or CSS-mappable**, not vague adjectives only.
5. **Per-page depth (P0)** — For each P0 page: intent, visual hierarchy, regions, layout, key component styles, state visuals, responsive approach. Watch for **cross-page drift**; reuse dashboard/shell patterns where PRD implies a workbench.
6. **Components** — Cover at least: Button, Input, Select, Checkbox/Radio, Card, Modal, Toast, Tabs, Navigation, Empty/Error. States: default, hover, active, focus, disabled, loading—reusable across pages.
7. **Interaction & motion** — Rules for load, submit, hover, focus, overlays, route/section transitions, success/failure—include **duration and easing**; prefer clarity over decorative motion.
8. **Design tool output** — In this codebase use **Pencil MCP** (`batch_get`, `batch_design`, `get_screenshot`, `get_guidelines` for `web-app`) to materialize `.pen` mockups. If a tool is read-only, fall back to **external edit + read-back summary**.
9. **Read-back** — When the user edits Pencil/pen files, synthesize a **structured change summary** (not raw tool dumps).
10. **Sync discipline** — Recommend whether design tool deltas should update `DESIGN.md`; **do not auto-sync** without confirmation. If changes exceed spec scope, flag **PM** for requirement change.
11. **Self-check before “ready to confirm”** — PRD alignment, page coverage, component completeness, token consistency, responsive/a11y bar, drift vs DESIGN.md. Output `self_check_summary`, `remaining_risks`, `ready_for_confirmation`.

## Structured outputs (partial)

As applicable: `ui_spec_status`, `updated_sections`, `page_coverage`, `component_coverage`, `design_system_status`, `design_artifact_status`, `design_tool` (Pencil), `sync_recommendation`, `rework_scope`, `user_visible_reply`, `runtime`, `handoff_request`, `needs_confirmation`, `affected_assets`.

## Failure handling

- Insufficient PRD → stop; list gaps; suggest PM.
- MCP read/write failure → report failure; keep existing DESIGN.md; suggest retry or text-only iteration.
- Spec/design conflict → stop conflicting work; explicit handoff to PM.

## Prohibitions

- Do **not** edit PRD.
- Do **not** auto-apply tool changes to DESIGN.md without approval.
- Do **not** author final **runnable Mockup app** in this skill (that is Mockup Agent in the reference model).
- Do **not** leave critical rules **only** in chat—persist in DESIGN.md / linked assets.

## LLM

- Use project default (**`gemini-3-pro-preview`** unless overridden).
