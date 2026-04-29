# Model Leaderboard (project)

- Generated at: 2026-04-29T12:09:22.054Z
- Rows aggregated: 9

> Compares models that have been used across sessions. Scores are simple means; trend column shows the most recent runs in time order (newest last).

## Stage `extract_real_contracts`

| Model | Runs | Avg Score | Success % | Avg Cost | Median Cost | Avg ms/call | Trend | Last seen |
|---|---|---|---|---|---|---|---|---|
 | `openai/gpt-5.3-codex-20260224` | 4 | **66.7** | 51.3% | $0.0502 | $0.0505 | 0ms | 64 → 75 → 64 → 64 | 2026-04-29 | 
 | `anthropic/claude-4-sonnet-20250522` | 1 | **62.7** | 45.0% | $0.0000 | $0.0000 | 0ms | 63 | 2026-04-27 | 

**Head-to-head — `openai/gpt-5.3-codex-20260224` vs `anthropic/claude-4-sonnet-20250522`**:
- Score: 66.7 vs 62.7 (Δ +4.0)
- Cost:  $0.0502 vs $0.0000 (Δ +$0.0502)
- Speed: 0ms vs 0ms/call (≈ equal)

## Stage `generate_api_contracts`

| Model | Runs | Avg Score | Success % | Avg Cost | Median Cost | Avg ms/call | Trend | Last seen |
|---|---|---|---|---|---|---|---|---|
 | `anthropic/claude-4-sonnet-20250522` | 5 | **65.9** | 50.0% | $0.0000 | $0.0000 | 0ms | 64 → 63 → 75 → 64 → 64 | 2026-04-29 | 

## Stage `integration_verify_fix`

| Model | Runs | Avg Score | Success % | Avg Cost | Median Cost | Avg ms/call | Trend | Last seen |
|---|---|---|---|---|---|---|---|---|
 | `openai/gpt-5.3-codex-20260224` | 5 | **55.6** | 50.0% | $1.2759 | $1.4047 | 8203ms | 54 → 51 → 65 → 54 → 54 | 2026-04-29 | 

## Stage `phase_verify_fix`

| Model | Runs | Avg Score | Success % | Avg Cost | Median Cost | Avg ms/call | Trend | Last seen |
|---|---|---|---|---|---|---|---|---|
 | `openai/gpt-5.3-codex-20260224` | 5 | **52.1** | 50.0% | $1.8882 | $2.3033 | 42752ms | 49 → 53 → 60 → 49 → 50 | 2026-04-29 | 

## Stage `worker_codefix`

| Model | Runs | Avg Score | Success % | Avg Cost | Median Cost | Avg ms/call | Trend | Last seen |
|---|---|---|---|---|---|---|---|---|
 | `openai/gpt-5.3-codex-20260224` | 5 | **53.9** | 50.0% | $0.2101 | $0.2198 | 1093215ms | 49 → 63 → 60 → 49 → 49 | 2026-04-29 | 

## Stage `worker_codegen`

| Model | Runs | Avg Score | Success % | Avg Cost | Median Cost | Avg ms/call | Trend | Last seen |
|---|---|---|---|---|---|---|---|---|
 | `deepseek-v4-pro` | 4 | **61.8** | 51.3% | $0.0000 | $0.0000 | 38490ms | 58 → 70 → 59 → 61 | 2026-04-29 | 
 | `deepseek/deepseek-v4-pro-20260423` | 1 | **58.5** | 45.0% | $0.0000 | $0.0000 | 143970ms | 59 | 2026-04-27 | 
 | `openai/gpt-5.3-codex-20260224` | 2 | **48.1** | 45.0% | $0.7632 | $0.7632 | 281134ms | 49 → 48 | 2026-04-27 | 

**Head-to-head — `deepseek-v4-pro` vs `deepseek/deepseek-v4-pro-20260423`**:
- Score: 61.8 vs 58.5 (Δ +3.3)
- Cost:  $0.0000 vs $0.0000 (≈ equal)
- Speed: 38490ms vs 143970ms/call (Δ -105480ms)
