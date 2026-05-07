# Model Leaderboard (project)

- Generated at: 2026-04-29T11:58:24.187Z
- Rows aggregated: 12

> Compares models that have been used across sessions. Scores are simple means; trend column shows the most recent runs in time order (newest last).

## Stage `extract_real_contracts`

| Model | Runs | Avg Score | Success % | Avg Cost | Median Cost | Avg ms/call | Trend | Last seen |
|---|---|---|---|---|---|---|---|---|
 | `openai/gpt-5.3-codex-20260224` | 4 | **69.0** | 51.3% | $0.0474 | $0.0505 | 0ms | 64 → 75 → 64 → 74 | 2026-04-29 | 
 | `anthropic/claude-4-sonnet-20250522` | 1 | **62.7** | 45.0% | $0.0000 | $0.0000 | 0ms | 63 | 2026-04-27 | 

**Head-to-head — `openai/gpt-5.3-codex-20260224` vs `anthropic/claude-4-sonnet-20250522`**:
- Score: 69.0 vs 62.7 (Δ +6.3)
- Cost:  $0.0474 vs $0.0000 (Δ +$0.0474)
- Speed: 0ms vs 0ms/call (≈ equal)

## Stage `generate_api_contracts`

| Model | Runs | Avg Score | Success % | Avg Cost | Median Cost | Avg ms/call | Trend | Last seen |
|---|---|---|---|---|---|---|---|---|
 | `anthropic/claude-4-sonnet-20250522` | 5 | **67.7** | 50.0% | $0.0000 | $0.0000 | 0ms | 64 → 63 → 75 → 64 → 74 | 2026-04-29 | 

## Stage `integration_verify_fix`

| Model | Runs | Avg Score | Success % | Avg Cost | Median Cost | Avg ms/call | Trend | Last seen |
|---|---|---|---|---|---|---|---|---|
 | `openai/gpt-5.3-codex-20260224` | 4 | **55.9** | 51.3% | $1.1255 | $1.1014 | 6874ms | 54 → 51 → 65 → 54 | 2026-04-29 | 

## Stage `phase_verify_fix`

| Model | Runs | Avg Score | Success % | Avg Cost | Median Cost | Avg ms/call | Trend | Last seen |
|---|---|---|---|---|---|---|---|---|
 | `deepseek/deepseek-v3.2-20251201` | 1 | **70.4** | 45.0% | $0.0000 | $0.0000 | 15689ms | 70 | 2026-04-29 | 
 | `openai/gpt-5.3-codex-20260224` | 5 | **54.7** | 50.0% | $1.6631 | $2.2555 | 34980ms | 49 → 53 → 60 → 49 → 64 | 2026-04-29 | 

**Head-to-head — `deepseek/deepseek-v3.2-20251201` vs `openai/gpt-5.3-codex-20260224`**:
- Score: 70.4 vs 54.7 (Δ +15.7)
- Cost:  $0.0000 vs $1.6631 (Δ -$1.6631)
- Speed: 15689ms vs 34980ms/call (Δ -19291ms)

## Stage `worker_codefix`

| Model | Runs | Avg Score | Success % | Avg Cost | Median Cost | Avg ms/call | Trend | Last seen |
|---|---|---|---|---|---|---|---|---|
 | `deepseek/deepseek-v3.2-20251201` | 1 | **68.5** | 45.0% | $0.0000 | $0.0000 | 42492ms | 69 | 2026-04-29 | 
 | `openai/gpt-5.3-codex-20260224` | 5 | **55.7** | 50.0% | $0.2363 | $0.2980 | 931013ms | 49 → 63 → 60 → 49 → 59 | 2026-04-29 | 

**Head-to-head — `deepseek/deepseek-v3.2-20251201` vs `openai/gpt-5.3-codex-20260224`**:
- Score: 68.5 vs 55.7 (Δ +12.8)
- Cost:  $0.0000 vs $0.2363 (Δ -$0.2363)
- Speed: 42492ms vs 931013ms/call (Δ -888521ms)

## Stage `worker_codegen`

| Model | Runs | Avg Score | Success % | Avg Cost | Median Cost | Avg ms/call | Trend | Last seen |
|---|---|---|---|---|---|---|---|---|
 | `deepseek/deepseek-v3.2-20251201` | 1 | **68.5** | 45.0% | $0.0000 | $0.0000 | 100971ms | 69 | 2026-04-29 | 
 | `deepseek/deepseek-v4-pro-20260423` | 2 | **63.5** | 45.0% | $0.0000 | $0.0000 | 101429ms | 59 → 69 | 2026-04-29 | 
 | `deepseek-v4-pro` | 3 | **62.2** | 53.3% | $0.0000 | $0.0000 | 37235ms | 58 → 70 → 59 | 2026-04-29 | 
 | `openai/gpt-5.3-codex-20260224` | 3 | **51.6** | 45.0% | $0.5485 | $0.3828 | 705100ms | 49 → 48 → 59 | 2026-04-29 | 

**Head-to-head — `deepseek/deepseek-v3.2-20251201` vs `deepseek/deepseek-v4-pro-20260423`**:
- Score: 68.5 vs 63.5 (Δ +5.0)
- Cost:  $0.0000 vs $0.0000 (≈ equal)
- Speed: 100971ms vs 101429ms/call (Δ -458ms)
