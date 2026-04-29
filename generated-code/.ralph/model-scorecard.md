# Model Scorecard — This Session

- **Session**: `95b01ba1-a282-46de-a7d0-cc27a08246d1`
- **Generated at**: 2026-04-29T12:09:22.050Z
- **Session composite**: **58.9 (F)**
- **Top model**: `openai/gpt-5.3-codex-20260224`
- **Weakest model**: `openai/gpt-5.3-codex-20260224`

> Scores are weighted composites across 6 dimensions: correctness (35%), taskSuccess (25%), efficiency (15%), robustness (10%), cost (10%), speed (5%). Higher is better.

## Stage `extract_real_contracts`

| Model | Role | Score | Correct | TaskSuc | Efficient | Robust | Cost | Speed | Calls | Tokens | $ |
|---|---|---|---|---|---|---|---|---|---|---|---|
 | `openai/gpt-5.3-codex-20260224` | - | **64.2 (D)** | 45 | 100 | 23 | 50 | 100 | 100 | 1 | 9.0k | $0.0436 | 

**`openai/gpt-5.3-codex-20260224` reasons**:
- Integration gate failed.
- E2E gate failed.
- Integration fix loop burned 57 iteration(s).
- Scaffold fix loop burned 50 iteration(s).
- Primary-model failures triggered 2 fallback(s).

## Stage `generate_api_contracts`

| Model | Role | Score | Correct | TaskSuc | Efficient | Robust | Cost | Speed | Calls | Tokens | $ |
|---|---|---|---|---|---|---|---|---|---|---|---|
 | `anthropic/claude-4-sonnet-20250522` | - | **64.2 (D)** | 45 | 100 | 23 | 50 | 100 | 100 | 1 | 9.3k | $0.0000 | 

**`anthropic/claude-4-sonnet-20250522` reasons**:
- Integration gate failed.
- E2E gate failed.
- Integration fix loop burned 57 iteration(s).
- Scaffold fix loop burned 50 iteration(s).
- Primary-model failures triggered 2 fallback(s).

## Stage `integration_verify_fix`

| Model | Role | Score | Correct | TaskSuc | Efficient | Robust | Cost | Speed | Calls | Tokens | $ |
|---|---|---|---|---|---|---|---|---|---|---|---|
 | `openai/gpt-5.3-codex-20260224` | primary | **54.2 (F)** | 45 | 100 | 23 | 50 | 0 | 100 | 57 | 940.0k | $1.8776 | 

**`openai/gpt-5.3-codex-20260224` reasons**:
- Integration gate failed.
- E2E gate failed.
- Integration fix loop burned 57 iteration(s).
- Scaffold fix loop burned 50 iteration(s).
- Primary-model failures triggered 2 fallback(s).

## Stage `phase_verify_fix`

| Model | Role | Score | Correct | TaskSuc | Efficient | Robust | Cost | Speed | Calls | Tokens | $ |
|---|---|---|---|---|---|---|---|---|---|---|---|
 | `openai/gpt-5.3-codex-20260224` | primary | **50.4 (F)** | 45 | 100 | 23 | 50 | 0 | 24 | 100 | 1.3M | $2.3033 | 

**`openai/gpt-5.3-codex-20260224` reasons**:
- Integration gate failed.
- E2E gate failed.
- Integration fix loop burned 57 iteration(s).
- Scaffold fix loop burned 50 iteration(s).
- Primary-model failures triggered 2 fallback(s).

## Stage `worker_codefix`

| Model | Role | Score | Correct | TaskSuc | Efficient | Robust | Cost | Speed | Calls | Tokens | $ |
|---|---|---|---|---|---|---|---|---|---|---|---|
 | `openai/gpt-5.3-codex-20260224` | - | **49.2 (F)** | 45 | 100 | 23 | 50 | 0 | 0 | 6 | 39.9k | $0.2198 | 

**`openai/gpt-5.3-codex-20260224` reasons**:
- Integration gate failed.
- E2E gate failed.
- Integration fix loop burned 57 iteration(s).
- Scaffold fix loop burned 50 iteration(s).
- Primary-model failures triggered 2 fallback(s).

## Stage `worker_codegen`

| Model | Role | Score | Correct | TaskSuc | Efficient | Robust | Cost | Speed | Calls | Tokens | $ |
|---|---|---|---|---|---|---|---|---|---|---|---|
 | `deepseek-v4-pro` | primary | **60.7 (D)** | 45 | 100 | 23 | 50 | 100 | 29 | 180 | 8.7M | $0.0000 | 

**`deepseek-v4-pro` reasons**:
- Integration gate failed.
- E2E gate failed.
- Integration fix loop burned 57 iteration(s).
- Scaffold fix loop burned 50 iteration(s).
- Primary-model failures triggered 2 fallback(s).

## Session gate context

- Tasks: 19/19 completed, 0 warnings, 0 failed
- Gates: integration=fail, runtime=skipped, e2e=fail
- Audit: passed (uncovered requirements: 0)
- Fix loops: scaffold=50, integration=57; truncations=2, stagnations=20, fallbacks=2

## Model Score History (cross-session)

> Each row shows a model's full score history across sessions for that stage. Newest scores are on the right. ↑ = improving, ↓ = declining.

### Stage `extract_real_contracts`

| Model | Runs | Avg score | Score history | Trend | Avg cost |
|---|---|---|---|---|---|
 | **`openai/gpt-5.3-codex-20260224`** ← this session | 4 | **66.7** | 64 → 75 → 64 → 64 | ↑ | $0.0502 | 
 | `anthropic/claude-4-sonnet-20250522` | 1 | **62.7** | 63 | — | $0.0000 | 

### Stage `generate_api_contracts`

| Model | Runs | Avg score | Score history | Trend | Avg cost |
|---|---|---|---|---|---|
 | **`anthropic/claude-4-sonnet-20250522`** ← this session | 5 | **65.9** | 64 → 63 → 75 → 64 → 64 | ↑ | $0.0000 | 

### Stage `integration_verify_fix`

| Model | Runs | Avg score | Score history | Trend | Avg cost |
|---|---|---|---|---|---|
 | **`openai/gpt-5.3-codex-20260224`** ← this session | 5 | **55.6** | 54 → 51 → 65 → 54 → 54 | ↑ | $1.2759 | 

### Stage `phase_verify_fix`

| Model | Runs | Avg score | Score history | Trend | Avg cost |
|---|---|---|---|---|---|
 | **`openai/gpt-5.3-codex-20260224`** ← this session | 5 | **52.1** | 49 → 53 → 60 → 49 → 50 | ↑ | $1.8882 | 

### Stage `worker_codefix`

| Model | Runs | Avg score | Score history | Trend | Avg cost |
|---|---|---|---|---|---|
 | **`openai/gpt-5.3-codex-20260224`** ← this session | 5 | **53.9** | 49 → 63 → 60 → 49 → 49 | ↑ | $0.2101 | 

### Stage `worker_codegen`

| Model | Runs | Avg score | Score history | Trend | Avg cost |
|---|---|---|---|---|---|
 | **`deepseek-v4-pro`** ← this session | 4 | **61.8** | 58 → 70 → 59 → 61 | ↑ | $0.0000 | 
 | `openai/gpt-5.3-codex-20260224` | 2 | **48.1** | 49 → 48 | ↓ | $0.7632 | 
