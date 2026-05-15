# Model Scorecard — This Session

- **Session**: `03c00a1d-0d78-4b82-8de1-6ed4cea6e926`
- **Generated at**: 2026-05-09T08:11:03.166Z
- **Session composite**: **74 (C)**
- **Top model**: `openai/gpt-5.3-codex-20260224`
- **Weakest model**: `deepseek-v4-pro`

> Scores are weighted composites across 6 dimensions: correctness (35%), taskSuccess (25%), efficiency (15%), robustness (10%), cost (10%), speed (5%). Higher is better.

## Stage `worker_codefix`

| Model | Role | Score | Correct | TaskSuc | Efficient | Robust | Cost | Speed | Calls | Tokens | $ |
|---|---|---|---|---|---|---|---|---|---|---|---|
 | `openai/gpt-5.3-codex-20260224` | - | **74.0 (C)** | 100 | 0 | 100 | 90 | 100 | 100 | 1 | 6.6k | $0.0306 | 

**`openai/gpt-5.3-codex-20260224` reasons**:
- 2 truncation event(s) during this run.

## Stage `worker_codegen`

| Model | Role | Score | Correct | TaskSuc | Efficient | Robust | Cost | Speed | Calls | Tokens | $ |
|---|---|---|---|---|---|---|---|---|---|---|---|
 | `deepseek-v4-pro` | primary | **74.0 (C)** | 100 | 0 | 100 | 90 | 100 | 100 | 14 | 386.7k | $0.0000 | 

**`deepseek-v4-pro` reasons**:
- 2 truncation event(s) during this run.

## Session gate context

- Tasks: 0/14 completed, 0 warnings, 0 failed
- Gates: integration=skipped, runtime=skipped, e2e=skipped
- Audit: passed (uncovered requirements: 0)
- Fix loops: scaffold=0, integration=0; truncations=2, stagnations=0, fallbacks=0

## Model Score History (cross-session)

> Each row shows a model's full score history across sessions for that stage. Newest scores are on the right. ↑ = improving, ↓ = declining.

### Stage `extract_real_contracts`

| Model | Runs | Avg score | Score history | Trend | Avg cost |
|---|---|---|---|---|---|
 | `openai/gpt-5.3-codex-20260224` | 5 | **68.0** | 64 → 75 → 64 → 74 → 64 | ↑ | $0.0465 | 

### Stage `integration_verify_fix`

| Model | Runs | Avg score | Score history | Trend | Avg cost |
|---|---|---|---|---|---|
 | `openai/gpt-5.3-codex-20260224` | 5 | **55.5** | 54 → 51 → 65 → 54 → 54 | ↑ | $1.0927 | 

### Stage `phase_verify_fix`

| Model | Runs | Avg score | Score history | Trend | Avg cost |
|---|---|---|---|---|---|
 | `openai/gpt-5.3-codex-20260224` | 6 | **53.9** | 49 → 53 → 60 → 49 → 64 → 50 | ↑ | $1.7757 | 

### Stage `worker_codefix`

| Model | Runs | Avg score | Score history | Trend | Avg cost |
|---|---|---|---|---|---|
 | **`openai/gpt-5.3-codex-20260224`** ← this session | 7 | **58.5** | 49 → 63 → 60 → 49 → 59 → 57 → 74 | ↑ | $0.1819 | 

### Stage `worker_codegen`

| Model | Runs | Avg score | Score history | Trend | Avg cost |
|---|---|---|---|---|---|
 | **`deepseek-v4-pro`** ← this session | 6 | **65.8** | 58 → 70 → 59 → 75 → 59 → 74 | ↑ | $0.0000 | 
 | `openai/gpt-5.3-codex-20260224` | 3 | **51.6** | 49 → 48 → 59 | ↑ | $0.5485 | 
