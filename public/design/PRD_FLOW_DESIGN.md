# PRD Confirmation + Parallel Generation Flow — UI Design

## Background: White (#FFFFFF), Accent: Indigo-600

---

## Phase 1: PRD Review & Refinement

After PRD generation completes, the pipeline **pauses** and shows a HITL gate.

```
┌─────────────────────────────────────────────────────────────────┐
│  ┌─ Preparation ─────────────────────────────────────────────┐  │
│  │  Intent ✓ │ PRD ● │ TRD ○ │ SysDesign ○ │ ...           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─ PRD Review ────────────────────────────────────────────┐   │
│  │                                                          │   │
│  │  ┌── Tier Badge ──────────────────────────────────────┐  │   │
│  │  │ Tier S │ Simple · tool │ Pomodoro timer, no backend│  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  │                                                          │   │
│  │  ┌── PRD Content (Markdown rendered) ─────────────────┐  │   │
│  │  │                                                     │  │   │
│  │  │  # PRD: Pomodoro Timer                              │  │   │
│  │  │  ## 1. Overview                                     │  │   │
│  │  │  A simple pomodoro timer...                         │  │   │
│  │  │  ## 2. Core Features                                │  │   │
│  │  │  ...                                                │  │   │
│  │  │                                                     │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  │                                                          │   │
│  │  ┌── Chat Refinement Area ────────────────────────────┐  │   │
│  │  │                                                     │  │   │
│  │  │  ┌─ Chat History ───────────────────────────────┐   │  │   │
│  │  │  │ 🤖 PRD generated for Pomodoro Timer.         │   │  │   │
│  │  │  │    Tier S detected. 5 features identified.   │   │  │   │
│  │  │  │                                               │   │  │   │
│  │  │  │ 👤 Please add a statistics feature to track   │   │  │   │
│  │  │  │    daily focus time                           │   │  │   │
│  │  │  │                                               │   │  │   │
│  │  │  │ 🤖 Updated PRD with F-06: Focus Statistics.  │   │  │   │
│  │  │  └───────────────────────────────────────────────┘   │  │   │
│  │  │                                                     │  │   │
│  │  │  ┌─────────────────────────────────┐ ┌───────────┐  │  │   │
│  │  │  │ Suggest changes to the PRD...   │ │  Send ➤   │  │  │   │
│  │  │  └─────────────────────────────────┘ └───────────┘  │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  │                                                          │   │
│  │  ┌── Action Buttons ──────────────────────────────────┐  │   │
│  │  │                                                     │  │   │
│  │  │  [ ✓ Confirm PRD & Continue ]    [ ↺ Regenerate ]  │  │   │
│  │  │                                                     │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Interaction:
- User can type refinement requests in the chat input
- Each message triggers an LLM call to update the PRD
- Updated PRD re-renders in the content area above
- Chat history persists the conversation
- "Confirm PRD & Continue" moves to Phase 2
- "Regenerate" re-generates from scratch

---

## Phase 2: Token Estimation & Generation Confirmation

After PRD confirmation, show what will be generated based on project tier.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ┌── Generation Plan ────────────────────────────────────────┐  │
│  │                                                            │  │
│  │  Based on your PRD (Tier M), the following documents       │  │
│  │  will be generated in parallel:                            │  │
│  │                                                            │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │                                                    │    │  │
│  │  │  Document              Est. Tokens   Est. Cost     │    │  │
│  │  │  ─────────────────────────────────────────────     │    │  │
│  │  │  ☐ Implementation Guide   ~4,000      ~$0.006     │    │  │
│  │  │  ☐ Design Spec            ~3,000      ~$0.005     │    │  │
│  │  │  ☐ QA Test Cases          ~2,500      ~$0.004     │    │  │
│  │  │  ─────────────────────────────────────────────     │    │  │
│  │  │  Total                    ~9,500      ~$0.015     │    │  │
│  │  │                                                    │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────────────────────────┐      │  │
│  │  │ ℹ  TRD and System Design skipped (Tier M)       │      │  │
│  │  └──────────────────────────────────────────────────┘      │  │
│  │                                                            │  │
│  │  [ ✓ Generate All ]          [ ⚙ Customize Selection ]    │  │
│  │                                                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Tier L version (all docs):
```
│  Document                  Est. Tokens   Est. Cost     │
│  ───────────────────────────────────────────────────    │
│  ☑ TRD                       ~6,000      ~$0.009       │
│  ☑ System Design             ~5,000      ~$0.008       │
│  ☑ Implementation Guide      ~4,000      ~$0.006       │
│  ☑ Design Spec               ~3,000      ~$0.005       │
│  ☑ QA Test Cases             ~2,500      ~$0.004       │
│  ☑ Verification              ~2,000      ~$0.003       │
│  ───────────────────────────────────────────────────    │
│  Total                      ~22,500      ~$0.035       │
```

### Tier S version (minimal):
```
│  Document                  Est. Tokens   Est. Cost     │
│  ───────────────────────────────────────────────────    │
│  ☑ Design Spec               ~2,000      ~$0.003       │
│  ───────────────────────────────────────────────────    │
│  Total                       ~2,000      ~$0.003       │
│                                                         │
│  ℹ  TRD, System Design, Impl Guide, QA, Verify         │
│     skipped for Tier S (simple) projects                │
```

---

## Phase 3: Parallel Generation Progress

After confirmation, all selected documents generate simultaneously.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ┌── Parallel Generation ────────────────────────────────────┐  │
│  │                                                            │  │
│  │  Generating 5 documents in parallel...                     │  │
│  │                                                            │  │
│  │  ✅ TRD                     4,231 tokens   $0.007  12.3s  │  │
│  │  ✅ System Design           5,102 tokens   $0.008  14.1s  │  │
│  │  ⏳ Implementation Guide    ████████░░░░   generating...   │  │
│  │  ✅ Design Spec             2,891 tokens   $0.005  10.8s  │  │
│  │  ⏳ QA Test Cases           ██████░░░░░░   generating...   │  │
│  │                                                            │  │
│  │  Progress: 3/5 complete    Total: $0.020   Elapsed: 15s   │  │
│  │                                                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌── Click any completed document to preview ─────────────────┐ │
│  │                                                             │ │
│  │  (Rendered markdown of selected completed doc)              │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Hierarchy

```
PipelinePage
├── Sidebar (existing)
├── Main Content
│   ├── Phase Bar (existing)
│   ├── Prep Sub-tab Bar (existing)
│   └── Content Area
│       ├── PrdReviewPanel (NEW — when step=prd & status=completed & !confirmed)
│       │   ├── TierBadge
│       │   ├── MarkdownRenderer (PRD content)
│       │   ├── PrdChatRefinement
│       │   │   ├── ChatHistory
│       │   │   └── ChatInput
│       │   └── ActionButtons (Confirm / Regenerate)
│       ├── GenerationPlanPanel (NEW — when PRD confirmed, pre-generate)
│       │   ├── EstimationTable
│       │   ├── SkippedStepsInfo
│       │   └── ActionButtons (Generate All / Customize)
│       └── ParallelProgressPanel (NEW — during parallel generation)
│           ├── ProgressRow[] (per document)
│           └── PreviewArea
```

## State Flow

```
PRD generated
    │
    ▼
[PRD Review Mode] ◄──── user sends chat message ────┐
    │                        │                        │
    │                   LLM updates PRD               │
    │                        │                        │
    │                   re-render PRD ────────────────┘
    │
    ▼ (user clicks "Confirm PRD")
    │
[Generation Plan] ◄──── user toggles docs
    │
    ▼ (user clicks "Generate All")
    │
[Parallel Generation] ── all selected docs generated via Promise.all
    │
    ▼ (all complete)
    │
[Continue to Kick-off]
```
