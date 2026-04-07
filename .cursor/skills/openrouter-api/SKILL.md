---
name: openrouter-api
description: >-
  Guide for OpenRouter LLM gateway integration in the Blueprint orchestration app.
  Use when working with AI agents, multi-model routing, chat completions, cost tracking,
  or modifying the OpenRouter client. All LLM requests MUST go through OpenRouter.
---

# OpenRouter API Integration

## Infrastructure Rule
**ALL LLM requests MUST route through OpenRouter.** No direct provider API calls.

## Setup
API key in `.env.local` as `OPENROUTER_API_KEY`. See `.env.example`.

## Core Library (`src/lib/openrouter.ts`)

- `chatCompletion(messages, options?)` — Standard request/response
- `streamChatCompletion(messages, options?)` — SSE stream
- `resolveModel(alias)` — Resolve shorthand to full model ID
- `estimateCost(model, usage)` — Calculate USD cost from token usage

## Model Routing Strategy

| Use Case | Model Alias | Full ID | Reason |
|----------|-------------|---------|--------|
| PRD / Writing | `gpt-4o` | openai/gpt-4o | Structured, reliable |
| Architecture | `gpt-4o` | openai/gpt-4o | Deep reasoning |
| Audit / Drift | `gemini-pro` | google/gemini-2.5-pro | Long context |
| Simple tasks | `gpt-4o-mini` | openai/gpt-4o-mini | Lowest cost |
| General | `gpt-4o` | openai/gpt-4o | Balanced |

> **Note**: Anthropic models (claude-sonnet, claude-opus) are currently
> restricted on this OpenRouter account. Use gpt-4o or gemini-pro instead.

## Agent System

All agents extend `BaseAgent` (`src/lib/agents/base-agent.ts`):
- PM Agent → PRD generation (claude-sonnet)
- Design Agent → UI specs (claude-sonnet)
- QA Agent → Audit reports (claude-sonnet)
- Verifier Agent → Drift detection (gemini-pro)

Each agent call automatically:
1. Routes through OpenRouter
2. Calculates cost via `estimateCost()`
3. Reports trace to Langfuse
4. Returns `AgentResult` with model, cost, tokens, traceId

## Rules
- Never expose `OPENROUTER_API_KEY` to client
- Always call from server-side (API routes or Electron main)
- Use model aliases for consistency
- Track costs in UI (CostTracker component)
