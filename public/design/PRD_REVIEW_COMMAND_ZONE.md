# PRD review — command zone & focus-reveal history (design spec)

**Theme:** White background, black / zinc / gray only (no purple). Matches existing Pipeline page.

**Goal:**  
1. **Next step** sits **immediately above** the bottom input (high salience), not at top of scroll.  
2. **Refinement history** lives in the **same bottom “dialog stack”** as the input; it is **hidden until the command input is focused** (Fig. 2 behavior: panel floats above the bar, then collapses on blur).

---

## Screen structure (top → bottom)

```
┌─────────────────────────────────────────────────────────────┐
│  [App chrome: Blueprint | Preparation | …]   $ tokens folder │
├─────────────────────────────────────────────────────────────┤
│  Sub-tabs: Intent | PRD  (only visible steps)                │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  MAIN SCROLL (flex-1)                                         │
│  • Tier badge row (if any)                                    │
│  • PRD document (markdown), max width ~896px, centered      │
│  • NO “Next step” here                                        │
│  • NO permanent refinement history here                       │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│  BOTTOM DOCK (flex-shrink-0, centered, max-w ~680px)        │
│                                                               │
│  ┌─ History panel (focus only) ─────────────────────────┐  │
│  │  Label: “Refinement” (xs, zinc-500)                    │  │
│  │  Rounded-2xl border border-zinc-200 bg-zinc-50          │  │
│  │  max-h ~240px overflow-y-auto (dark scrollbar)         │  │
│  │  • User bubbles: right, bg-zinc-900 text-white          │  │
│  │  • Assistant: left, border bg-white                    │  │
│  │  • Optional: thin top “handle” line (zinc-200)           │  │
│  │  Visible only when: inputFocused === true               │  │
│  │  motion: height + opacity (e.g. 0.2s)                   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─ Next step (always visible in PRD review) ─────────────┐  │
│  │  Title: “Next step” (text-sm font-semibold zinc-900)   │  │
│  │  Body: continue / refine / regenerate (xs zinc-600)     │  │
│  │  border border-zinc-200 bg-white shadow-sm rounded-xl   │  │
│  │  px-4 py-3                                               │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─ Input row (existing) ─────────────────────────────────┐  │
│  │  [ text field … ]  Quick ☐  [ Send ]                     │  │
│  └────────────────────────────────────────────────────────┘  │
│  Reset · Skip · Pencil · Debug (unchanged)                     │
└─────────────────────────────────────────────────────────────┘
```

**Stack order (bottom dock, bottom-up):**  
`[Input]` → `[Next step]` directly above → `[History]` above that **only on focus**.

*(Fig. 2 had dark glass; we keep the same *information architecture*: history floats above the bar, hidden until focus; “primary instruction” is adjacent to the bar.)*

---

## Interaction

| State | History panel |
|--------|----------------|
| Input **not** focused | Collapsed: `display: none` or `height: 0; opacity: 0; overflow: hidden; pointer-events: none` |
| Input **focused** | Expanded: show messages; scroll if needed |
| While refining (`isRefining`) | Keep panel visible if focus retained; optional small “Updating…” row inside panel |

**Optional polish:** If `chatHistory.length === 0` and focused, show one line: “Type below to refine, or `continue` to proceed.”

---

## Implementation notes (for dev pass)

- Lift **focus state** to Pipeline page (or a small wrapper around the bottom command block for PRD review only) so **one** `<input>` drives `onFocus` / `onBlur`.
- **Blur timing:** use `onBlur` with `relatedTarget` check or short `setTimeout` so clicking inside the history panel does not collapse it (if history stays focusable). If history is not focusable, blur-on-input-only is enough.
- **PrdReviewPanel:** Remove top “Next step” and in-panel history; pass `chatHistory` + `isRefining` to parent or a `PrdReviewCommandDock` child rendered next to the shared input.
- **Motion:** `motion` for history panel height/opacity per project rule.

---

## Sign-off

After you confirm this layout and stack order, implementation will:
1. Move Next step + conditional history into the bottom dock with the shared input.  
2. Trim main scroll to PRD (+ tier badge only).  
3. Add focus-gated history with motion.
