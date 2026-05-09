# Model Leaderboard (project)

- Generated at: 2026-05-09T08:11:03.171Z
- Rows aggregated: 12

> Compares models that have been used across sessions. Scores are simple means; trend column shows the most recent runs in time order (newest last).

## Stage `extract_real_contracts`

| Model | Runs | Avg Score | Success % | Avg Cost | Median Cost | Avg ms/call | Trend | Last seen |
|---|---|---|---|---|---|---|---|---|
 | `openai/gpt-5.3-codex-20260224` | 5 | **68.0** | 50.0% | $0.0465 | $0.0495 | 0ms | 64 → 75 → 64 → 74 → 64 | 2026-05-07 | 
 | `anthropic/claude-4-sonnet-20250522` | 1 | **62.7** | 45.0% | $0.0000 | $0.0000 | 0ms | 63 | 2026-04-27 | 

**Head-to-head — `openai/gpt-5.3-codex-20260224` vs `anthropic/claude-4-sonnet-20250522`**:
- Score: 68.0 vs 62.7 (Δ +5.3)
- Cost:  $0.0465 vs $0.0000 (Δ +$0.0465)
- Speed: 0ms vs 0ms/call (≈ equal)

## Stage `generate_api_contracts`

| Model | Runs | Avg Score | Success % | Avg Cost | Median Cost | Avg ms/call | Trend | Last seen |
|---|---|---|---|---|---|---|---|---|
 | `anthropic/claude-4-sonnet-20250522` | 6 | **67.1** | 49.2% | $0.0000 | $0.0000 | 0ms | 64 → 63 → 75 → 64 → 74 → 64 | 2026-05-07 | 

## Stage `integration_verify_fix`

| Model | Runs | Avg Score | Success % | Avg Cost | Median Cost | Avg ms/call | Trend | Last seen |
|---|---|---|---|---|---|---|---|---|
 | `openai/gpt-5.3-codex-20260224` | 5 | **55.5** | 50.0% | $1.0927 | $0.9613 | 6981ms | 54 → 51 → 65 → 54 → 54 | 2026-05-07 | 

## Stage `phase_verify_fix`

| Model | Runs | Avg Score | Success % | Avg Cost | Median Cost | Avg ms/call | Trend | Last seen |
|---|---|---|---|---|---|---|---|---|
 | `deepseek/deepseek-v3.2-20251201` | 1 | **70.4** | 45.0% | $0.0000 | $0.0000 | 15689ms | 70 | 2026-04-29 | 
 | `openai/gpt-5.3-codex-20260224` | 6 | **53.9** | 49.2% | $1.7757 | $2.2849 | 33304ms | 49 → 53 → 60 → 49 → 64 → 50 | 2026-05-07 | 

**Head-to-head — `deepseek/deepseek-v3.2-20251201` vs `openai/gpt-5.3-codex-20260224`**:
- Score: 70.4 vs 53.9 (Δ +16.5)
- Cost:  $0.0000 vs $1.7757 (Δ -$1.7757)
- Speed: 15689ms vs 33304ms/call (Δ -17615ms)

## Stage `worker_codefix`

| Model | Runs | Avg Score | Success % | Avg Cost | Median Cost | Avg ms/call | Trend | Last seen |
|---|---|---|---|---|---|---|---|---|
 | `deepseek/deepseek-v3.2-20251201` | 1 | **68.5** | 45.0% | $0.0000 | $0.0000 | 42492ms | 69 | 2026-04-29 | 
 | `openai/gpt-5.3-codex-20260224` | 7 | **58.5** | 56.4% | $0.1819 | $0.1954 | 974278ms | 49 → 63 → 60 → 49 → 59 → 57 → 74 | 2026-05-09 | 

**Head-to-head — `deepseek/deepseek-v3.2-20251201` vs `openai/gpt-5.3-codex-20260224`**:
- Score: 68.5 vs 58.5 (Δ +10.0)
- Cost:  $0.0000 vs $0.1819 (Δ -$0.1819)
- Speed: 42492ms vs 974278ms/call (Δ -931786ms)

## Stage `worker_codegen`

| Model | Runs | Avg Score | Success % | Avg Cost | Median Cost | Avg ms/call | Trend | Last seen |
|---|---|---|---|---|---|---|---|---|
 | `deepseek/deepseek-v3.2-20251201` | 1 | **68.5** | 45.0% | $0.0000 | $0.0000 | 100971ms | 69 | 2026-04-29 | 
 | `deepseek-v4-pro` | 6 | **65.8** | 67.5% | $0.0000 | $0.0000 | 33280ms | 58 → 70 → 59 → 75 → 59 → 74 | 2026-05-09 | 
 | `deepseek/deepseek-v4-pro-20260423` | 2 | **63.5** | 45.0% | $0.0000 | $0.0000 | 101429ms | 59 → 69 | 2026-04-29 | 
 | `openai/gpt-5.3-codex-20260224` | 3 | **51.6** | 45.0% | $0.5485 | $0.3828 | 705100ms | 49 → 48 → 59 | 2026-04-29 | 

**Head-to-head — `deepseek/deepseek-v3.2-20251201` vs `deepseek-v4-pro`**:
- Score: 68.5 vs 65.8 (Δ +2.7)
- Cost:  $0.0000 vs $0.0000 (≈ equal)
- Speed: 100971ms vs 33280ms/call (Δ +67691ms)
