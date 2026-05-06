# Model Scorecard — This Session

- **Session**: `44fb392e-79c5-4cb3-9fc2-14362d8584ba`
- **Generated at**: 2026-04-29T11:58:24.180Z
- **Session composite**: **67.4 (D)**
- **Top model**: `openai/gpt-5.3-codex-20260224`
- **Weakest model**: `openai/gpt-5.3-codex-20260224`

> Scores are weighted composites across 6 dimensions: correctness (35%), taskSuccess (25%), efficiency (15%), robustness (10%), cost (10%), speed (5%). Higher is better.

## Stage `extract_real_contracts`

| Model | Role | Score | Correct | TaskSuc | Efficient | Robust | Cost | Speed | Calls | Tokens | $ |
|---|---|---|---|---|---|---|---|---|---|---|---|
 | `openai/gpt-5.3-codex-20260224` | - | **73.5 (C)** | 45 | 100 | 75 | 65 | 100 | 100 | 1 | 7.1k | $0.0324 | 

**`openai/gpt-5.3-codex-20260224` reasons**:
- Integration gate failed.
- E2E gate failed.
- Scaffold fix loop burned 50 iteration(s).
- 24 truncation event(s) during this run.

## Stage `generate_api_contracts`

| Model | Role | Score | Correct | TaskSuc | Efficient | Robust | Cost | Speed | Calls | Tokens | $ |
|---|---|---|---|---|---|---|---|---|---|---|---|
 | `anthropic/claude-4-sonnet-20250522` | - | **73.5 (C)** | 45 | 100 | 75 | 65 | 100 | 100 | 1 | 9.0k | $0.0000 | 

**`anthropic/claude-4-sonnet-20250522` reasons**:
- Integration gate failed.
- E2E gate failed.
- Scaffold fix loop burned 50 iteration(s).
- 24 truncation event(s) during this run.

## Stage `phase_verify_fix`

| Model | Role | Score | Correct | TaskSuc | Efficient | Robust | Cost | Speed | Calls | Tokens | $ |
|---|---|---|---|---|---|---|---|---|---|---|---|
 | `deepseek/deepseek-v3.2-20251201` | fallback | **70.4 (C)** | 45 | 100 | 75 | 65 | 100 | 37 | 16 | 147.7k | $0.0000 | 
 | `openai/gpt-5.3-codex-20260224` | primary | **63.5 (D)** | 45 | 100 | 75 | 65 | 0 | 100 | 50 | 614.7k | $1.1779 | 

**`deepseek/deepseek-v3.2-20251201` reasons**:
- Integration gate failed.
- E2E gate failed.
- Scaffold fix loop burned 50 iteration(s).
- 24 truncation event(s) during this run.
- Speed 15689ms/call is 2.9× slower than the fastest model.

**`openai/gpt-5.3-codex-20260224` reasons**:
- Integration gate failed.
- E2E gate failed.
- Scaffold fix loop burned 50 iteration(s).
- 24 truncation event(s) during this run.
- Cost/task $0.0620 is 36.3× the cheapest model in this session.

## Stage `worker_codefix`

| Model | Role | Score | Correct | TaskSuc | Efficient | Robust | Cost | Speed | Calls | Tokens | $ |
|---|---|---|---|---|---|---|---|---|---|---|---|
 | `deepseek/deepseek-v3.2-20251201` | - | **68.5 (D)** | 45 | 100 | 75 | 65 | 100 | 0 | 2 | 16.8k | $0.0000 | 
 | `openai/gpt-5.3-codex-20260224` | - | **58.5 (F)** | 45 | 100 | 75 | 65 | 0 | 0 | 8 | 55.0k | $0.3506 | 

**`deepseek/deepseek-v3.2-20251201` reasons**:
- Integration gate failed.
- E2E gate failed.
- Scaffold fix loop burned 50 iteration(s).
- 24 truncation event(s) during this run.
- Speed 42492ms/call is 7.8× slower than the fastest model.

**`openai/gpt-5.3-codex-20260224` reasons**:
- Integration gate failed.
- E2E gate failed.
- Scaffold fix loop burned 50 iteration(s).
- 24 truncation event(s) during this run.
- Cost/task $0.0185 is 10.8× the cheapest model in this session.

## Stage `worker_codegen`

| Model | Role | Score | Correct | TaskSuc | Efficient | Robust | Cost | Speed | Calls | Tokens | $ |
|---|---|---|---|---|---|---|---|---|---|---|---|
 | `deepseek/deepseek-v4-pro-20260423` | primary | **68.5 (D)** | 45 | 100 | 75 | 65 | 100 | 0 | 87 | 2.2M | $0.0000 | 
 | `deepseek/deepseek-v3.2-20251201` | fallback | **68.5 (D)** | 45 | 100 | 75 | 65 | 100 | 0 | 13 | 366.0k | $0.0000 | 
 | `openai/gpt-5.3-codex-20260224` | fallback | **58.5 (F)** | 45 | 100 | 75 | 65 | 0 | 0 | 2 | 46.8k | $0.1191 | 

**`deepseek/deepseek-v4-pro-20260423` reasons**:
- Integration gate failed.
- E2E gate failed.
- Scaffold fix loop burned 50 iteration(s).
- 24 truncation event(s) during this run.
- Speed 58889ms/call is 10.8× slower than the fastest model.

**`deepseek/deepseek-v3.2-20251201` reasons**:
- Integration gate failed.
- E2E gate failed.
- Scaffold fix loop burned 50 iteration(s).
- 24 truncation event(s) during this run.
- Speed 100971ms/call is 18.5× slower than the fastest model.

**`openai/gpt-5.3-codex-20260224` reasons**:
- Integration gate failed.
- E2E gate failed.
- Scaffold fix loop burned 50 iteration(s).
- 24 truncation event(s) during this run.
- Cost/task $0.0063 is 3.7× the cheapest model in this session.

## Session gate context

- Tasks: 19/19 completed, 0 warnings, 0 failed
- Gates: integration=fail, runtime=skipped, e2e=fail
- Audit: passed (uncovered requirements: 0)
- Fix loops: scaffold=50, integration=1; truncations=24, stagnations=0, fallbacks=0

## Model Score History (cross-session)

> Each row shows a model's full score history across sessions for that stage. Newest scores are on the right. ↑ = improving, ↓ = declining.

### Stage `extract_real_contracts`

| Model | Runs | Avg score | Score history | Trend | Avg cost |
|---|---|---|---|---|---|
 | **`openai/gpt-5.3-codex-20260224`** ← this session | 4 | **69.0** | 64 → 75 → 64 → 74 | ↑ | $0.0474 | 
 | `anthropic/claude-4-sonnet-20250522` | 1 | **62.7** | 63 | — | $0.0000 | 

### Stage `generate_api_contracts`

| Model | Runs | Avg score | Score history | Trend | Avg cost |
|---|---|---|---|---|---|
 | **`anthropic/claude-4-sonnet-20250522`** ← this session | 5 | **67.7** | 64 → 63 → 75 → 64 → 74 | ↑ | $0.0000 | 

### Stage `integration_verify_fix`

| Model | Runs | Avg score | Score history | Trend | Avg cost |
|---|---|---|---|---|---|
 | `openai/gpt-5.3-codex-20260224` | 4 | **55.9** | 54 → 51 → 65 → 54 | ↑ | $1.1255 | 

### Stage `phase_verify_fix`

| Model | Runs | Avg score | Score history | Trend | Avg cost |
|---|---|---|---|---|---|
 | **`deepseek/deepseek-v3.2-20251201`** ← this session | 1 | **70.4** | 70 | — | $0.0000 | 
 | **`openai/gpt-5.3-codex-20260224`** ← this session | 5 | **54.7** | 49 → 53 → 60 → 49 → 64 | ↑ | $1.6631 | 

### Stage `worker_codefix`

| Model | Runs | Avg score | Score history | Trend | Avg cost |
|---|---|---|---|---|---|
 | **`deepseek/deepseek-v3.2-20251201`** ← this session | 1 | **68.5** | 69 | — | $0.0000 | 
 | **`openai/gpt-5.3-codex-20260224`** ← this session | 5 | **55.7** | 49 → 63 → 60 → 49 → 59 | ↑ | $0.2363 | 

### Stage `worker_codegen`

| Model | Runs | Avg score | Score history | Trend | Avg cost |
|---|---|---|---|---|---|
 | **`deepseek/deepseek-v3.2-20251201`** ← this session | 1 | **68.5** | 69 | — | $0.0000 | 
 | **`deepseek/deepseek-v4-pro-20260423`** ← this session | 2 | **63.5** | 59 → 69 | ↑ | $0.0000 | 
 | **`openai/gpt-5.3-codex-20260224`** ← this session | 3 | **51.6** | 49 → 48 → 59 | ↑ | $0.5485 | 
