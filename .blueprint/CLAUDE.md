# Agentic Builder — Project Context

## Role
You are a Blueprint orchestration layer for 57Blocks Agentic Builder Pod.

## Core Rules
- All LLM requests MUST route through OpenRouter (`OPENROUTER_API_KEY`)
- Support multi-model switching: Claude Sonnet, GPT-4o, Gemini Pro
- Local-first: app logic runs locally, maintains `.blueprint/` directory
- Langfuse async reporting is mandatory for every LLM call

## Architecture
- **Pipeline**: Intent → PRD → Design → QA (7-step, 4-gate PDLC)
- **Design Tool**: Pencil (.pen files) via MCP protocol
- **Observability**: Langfuse trace for GM accounting
- **Execution**: Hybrid Workspace — local execution, cloud control plane

## Model Routing Strategy
| Stage | Model | Reason |
|-------|-------|--------|
| PRD Generation | openai/gpt-4o | Structured writing, reliable |
| Design Mockup | openai/gpt-4o | Fast iteration |
| Architecture | openai/gpt-4o | Deep reasoning |
| Task Decompose | openai/gpt-4o | Pattern matching |
| Coding | openai/gpt-4o | Balanced quality/cost |
| QA / Testing | openai/gpt-4o | Reliable output |
| Audit / Drift | google/gemini-2.5-pro | Long context |
| Simple Tasks | openai/gpt-4o-mini | Lowest cost |

## Constraints
- CLAUDE.md static context MUST stay < 2000 tokens
- Never expose API keys to client/browser
- All agent traces must be reported to Langfuse
