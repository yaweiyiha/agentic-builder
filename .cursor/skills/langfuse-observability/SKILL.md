---
name: langfuse-observability
description: >-
  Guide for Langfuse observability integration. Use when working with LLM trace
  logging, cost accounting, GM calculation, agent execution tracking, or the
  observability layer of the Blueprint pipeline.
---

# Langfuse Observability

## Infrastructure Rule
**Langfuse async reporting is MANDATORY** for every OpenRouter LLM call.
Used for GM (Gross Margin) accounting.

## Setup
Keys in `.env.local`:
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_BASE_URL` — **must match your Langfuse Cloud region** (keys are not valid across regions):
  - **EU:** `https://cloud.langfuse.com` (also the SDK fallback when unset)
  - **US:** `https://us.cloud.langfuse.com`
- If you see `401 Unauthorized` / “Confirm that you've configured the correct host”, fix the host first; keys alone are not enough.
- Avoid a space after `=` in `.env` (values are trimmed in code, but wrong host still fails).

## Core Library (`src/lib/observability/langfuse.ts`)

- `getLangfuse()` — Singleton Langfuse client
- `createTrace(ctx)` — Start a trace for an agent step
- `logGeneration(event)` — Log LLM generation with cost
- `flushLangfuse()` — Flush pending events

## Auto-Integration

`BaseAgent.run()` automatically:
1. Creates a trace with `agentName` + `pipelineStep`
2. Logs generation with model, tokens, cost, duration
3. Flushes after each call

## Trace Structure

```
Trace: "step-1-prd::PM Agent"
├── Generation: "PM Agent::step-1-prd"
│   ├── model: anthropic/claude-sonnet-4
│   ├── tokens: { prompt: X, completion: Y }
│   ├── costUsd: $0.0XXX
│   └── durationMs: XXXXms
```

## GM Accounting
- Each trace includes `costUsd` in metadata
- Filter by `pipelineStep` to see cost per phase
- Filter by `sessionId` to see cost per pipeline run
- Aggregate for monthly GM reports

## Rules
- Never skip Langfuse reporting (even if keys not set — graceful degradation)
- Include `sessionId` for pipeline runs (groups related traces)
- Cost data is calculated client-side via `estimateCost()` before logging
