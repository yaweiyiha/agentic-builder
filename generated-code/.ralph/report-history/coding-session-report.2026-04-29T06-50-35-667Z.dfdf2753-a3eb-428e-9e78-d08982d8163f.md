# Coding Session Report

- Session ID: `dfdf2753-a3eb-428e-9e78-d08982d8163f`
- Status: **FAIL**
- Score: **38/100 (F)**
- Runtime readiness: 3 finding(s) — 2 error, 1 warn
- Started at: 2026-04-29T03:43:30.189Z
- Ended at: 2026-04-29T06:50:35.667Z
- Generator git: `cee5f4b`
- Scaffold fix attempts: 50
- Integration fix attempts: 49
- Total LLM calls: 386
- Total LLM tokens: 13269261
- Total LLM cost: $4.2783
- Generated/known files in registry: 215

## Summary
Integration verify gate failed.
Unresolved TypeScript cluster remains in backend/src/services/scanOrchestrator.ts around lines 442–507 due to mismatched external API function signatures and Promise/shape incompatibilities that require a larger refactor than the remaining batch allows.

Final scoped validation gates failed:

frontend_tsc: pass

frontend_build: pass

backend_smoke: pass

backend_tsc failed:
src/services/scanOrchestrator.ts(442,7): error TS2554: Expected 1 arguments, but got 2.
src/services/scanOrchestrator.ts(487,54): error TS2554: Expected 1 arguments, but got 3.
src/services/scanOrchestrator.ts(488,21): error TS2488: Type 'Promise<HyperliquidPerpResult[]>' must have a '[Symbol.iterator]()' method that returns an iterator.
src/services/scanOrchestrator.ts(495,39): error TS2339: Property 'length' does not exist on type 'Promise<HyperliquidPerpResult[]>'.
src/services/scanOrchestrator.ts(507,78): error TS2554: Expected 1 arguments, but got 2.
src/services/scanOrchestrator.ts(723,44): error TS2345: Argument of type 'HLMetaAndAssetCtxsResponse' is not assignable to parameter of type 'HLMetaUniverseItem[]'.
  Type 'HLMetaAndAssetCtxsResponse' is missing the following properties from type 'HLMetaUniverseItem[]': length, pop, push, concat, and 28 more.
src/services/scanOrchestrator.ts(725,22): error TS2345: Argument of type 'HLMetaUniverseItem' is not assignable to parameter of type 'string'.
src/services/scanOrchestrator.ts(960,9): error TS2322: Type '{ id: string; venue: "polymarket"; market_type: "prediction"; question: string; yes_price: number; no_price: number; volume_24h: number; url: string; relevance_score: number; updated_at: string; ... 4 more ...; edge_bluf: string; }[]' is not assignable to type 'ScanPredictionCard[]'.
  Property 'external_id' is missing in type '{ id: string; venue: "polymarket"; market_type: "prediction"; question: string; yes_price: number; no_price: number; volume_24h: number; url: string; relevance_score: number; updated_at: string; ... 4 more ...; edge_bluf: string; }' but required in type 'ScanPredictionCard'.
src/services/scanOrchestrator.ts(983,9): error TS2322: Type '{ id: string; venue: "hyperliquid"; market_type: "perp"; symbol: string; mark_price: number; change_24h_pct: number; funding_rate: number; open_interest: number; volume_24h: number; url: string; relevance_score: number; updated_at: string; max_leverage: nu

Backend route registration gate failed:

## API_CONTRACTS endpoints with no matching implementation
- POST /api/auth/verify
## Implemented endpoints not declared in API_CONTRACTS (verify intent)
- GET /api/auth/me
- GET /api/health

Dependency consistency gate failed:

Dependency consistency audit still has unresolved items:
"frontend" imports are missing dependencies: jsdom-testing-mocks, styled-components

E2E verify gate failed.
E2E has failures but none are deterministic — auto-repair skipped.

triage: 0 deterministic, 0 flaky, 0 infra (0 self-healed on retry)

See .ralph/e2e-triage.md for the full report.



> frontend@0.0.0 e2e /Users/57block/code/agentic-builder/generated-code/frontend
> pnpm run e2e:install && playwright test


> frontend@0.0.0 e2e:install /Users/57block/code/agentic-builder/generated-code/frontend
> playwright install chromium --with-deps

Downloading Chrome for Testing 147.0.7727.15 (playwright chromium v1217)[2m from https://cdn.playwright.dev/builds/cft/147.0.7727.15/mac-arm64/chrome-mac-arm64.zip[22m
|                                                                                |   0% of 165.5 MiB
|■■■■■■■■                                                                        |  10% of 165.5 MiB
|■■■■■■■■■■■■■■■■                                                                |  20% of 165.5 MiB
|■■■■■■■■■■■■■■■■■■■■■■■■                                                        |  30% of 165.5 MiB
|■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■                                                |  40% of 165.5 MiB
|■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■                                        |  50% of 165.5 MiB
|■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■                                |  60% of 165.5 MiB
|■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■                        |  70% of 165.5 MiB
|■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■                |  80% of 165.5 MiB
|■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■        |  90% of 165.5 MiB

## Runtime Readiness
Static §4.2/§4.3/§4.4/§4.5/§4.7 audit of generated source. Findings here mean known runtime pitfalls slipped past the verify-fix worker. Full report: `.ralph/runtime-integration-audit.json`.

**3 finding(s)** — 2 error, 1 warn.

| Rule | Severity | Locations |
| --- | --- | --- |
| `bg-job-inproc-branch` | ERROR | backend/src/api/modules/feed/feed.service.ts:296, backend/src/services/feedAggregationService.ts:76 |
| `bg-job-clear-stale-runs` | WARN | backend/src/api/modules/feed/feed.routes.ts:26 |

**Disabled rules:**
- `llm-client-abstraction` — no LLM_* bundle declared on resource requirements — abstraction rule N/A.

## Task Outcome
- Completed: 25
- Completed with warnings: 0
- Failed: 0
- Unknown: 0

## Scoring Breakdown

**Formula:** `100 − 20(fail) − 10(integration) − 20(e2e:blocking errors) − 4(trunc:2) − 8(plan-unfulfilled:7) = 38`

| Rule | Max deduction | Applied | Reason |
| --- | --- | --- | --- |
| Run status fail | −20 | **-20** ❌ | status=fail |
| Run status aborted | −30 | 0 (not triggered) | status=aborted |
| Integration gate | −10 | **-10** ❌ | integration errors present |
| Runtime gate | −8 | 0 (not triggered) | runtime errors present |
| E2E gate | −20 | **-20** ❌ | e2e errors present (scales with fail ratio) |
| Uncovered requirements | −25 | 0 (not triggered) | PRD requirement ids unresolved |
| Failed tasks | −15 | 0 (not triggered) | coding tasks status=failed |
| Unknown tasks | −10 | 0 (not triggered) | coding tasks status=unknown |
| Context truncation | −8 | **-4** ❌ | doc_truncated events |
| Plan mismatches | −8 | **-8** ❌ | task_plan_unfulfilled events |
| All tasks done bonus | +5 | 0 (not triggered) | all tasks complete + no blocking gates |

## Model Usage
- `openai/gpt-5.3-codex-20260224`: calls=157, cost=$4.2783, tokens=2051381, stages=worker_codefix:Test Engineer, worker_codefix:Backend Dev, phase_verify_fix, extract_real_contracts, worker_codefix:Frontend Dev, integration_verify_fix
- `deepseek-v4-pro`: calls=228, cost=$0.0000, tokens=11208231, stages=worker_codegen:Architect, worker_codegen:Test Engineer, worker_codegen:Backend Dev, worker_codegen:Frontend Dev
- `anthropic/claude-4-sonnet-20250522`: calls=1, cost=$0.0000, tokens=9649, stages=generate_api_contracts

## Stage Diagnostics
- `architect-triage`: duration=0s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `worker_codegen`: duration=171m 19s, calls=228, tokens=11208231 (prompt=10887129, completion=321102), cost=$0.0000, score=100/100 (A), models=deepseek-v4-pro
  labels=Architect, Test Engineer, Backend Dev, Frontend Dev
  notes=No strong negative signal captured.
- `task`: duration=166m 11s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `worker-context`: duration=169m 47s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=88/100 (B), models=(none)
  notes=Context was truncated 2 time(s).
- `generate_api_contracts`: duration=0s, calls=1, tokens=9649 (prompt=7859, completion=1790), cost=$0.0000, score=100/100 (A), models=anthropic/claude-4-sonnet-20250522
  notes=No strong negative signal captured.
- `preflight-contract-completeness`: duration=169m 22s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `worker-verify`: duration=146m 2s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=68/100 (D), models=(none)
  notes=Task/file plan mismatches happened 7 time(s).
- `worker_codefix`: duration=146m 42s, calls=7, tokens=40470 (prompt=20762, completion=19708), cost=$0.3122, score=100/100 (A), models=openai/gpt-5.3-codex-20260224
  labels=Test Engineer, Backend Dev, Frontend Dev
  notes=No strong negative signal captured.
- `preflight-convention-fix`: duration=86m 48s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `phase_verify_fix`: duration=90m 14s, calls=100, tokens=1206889 (prompt=1190380, completion=16509), cost=$2.3143, score=90/100 (A), models=openai/gpt-5.3-codex-20260224
  notes=Earlier phase verify/fix did not fully prevent later integration failures.
- `extract_real_contracts`: duration=0s, calls=1, tokens=10666 (prompt=7597, completion=3069), cost=$0.0563, score=100/100 (A), models=openai/gpt-5.3-codex-20260224
  notes=No strong negative signal captured.
- `preflight-deps`: duration=0s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `preflight-route-audit`: duration=0s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `integration_verify_fix`: duration=5m 38s, calls=49, tokens=793356 (prompt=776450, completion=16906), cost=$1.5955, score=72/100 (C), models=openai/gpt-5.3-codex-20260224
  notes=Stage ended with blocking integration errors.
- `integration-gate`: duration=5m 37s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=64/100 (D), models=(none)
  notes=Stagnation warnings triggered 12 time(s).
- `e2e-triage`: duration=0s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `post-gen-audit`: duration=0s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.

## Model Effectiveness
- `deepseek-v4-pro`: score=100/100 (A), calls=228, tokens=11208231, cost=$0.0000, stages=worker_codegen
  notes=No strong negative signal captured.
- `openai/gpt-5.3-codex-20260224`: score=83.3/100 (B), calls=157, tokens=2051381, cost=$4.2783, stages=worker_codefix, phase_verify_fix, extract_real_contracts, integration_verify_fix
  notes=Earlier phase verify/fix did not fully prevent later integration failures. | Stage ended with blocking integration errors.
- `anthropic/claude-4-sonnet-20250522`: score=100/100 (A), calls=1, tokens=9649, cost=$0.0000, stages=generate_api_contracts
  notes=No strong negative signal captured.

## Quality Gates
- Integration verify: FAIL (continued)
- Runtime verify: SKIPPED
- E2E verify: FAIL
- Feature audit: PASS

### Integration Errors
```
Unresolved TypeScript cluster remains in backend/src/services/scanOrchestrator.ts around lines 442–507 due to mismatched external API function signatures and Promise/shape incompatibilities that require a larger refactor than the remaining batch allows.

Final scoped validation gates failed:

frontend_tsc: pass

frontend_build: pass

backend_smoke: pass

backend_tsc failed:
src/services/scanOrchestrator.ts(442,7): error TS2554: Expected 1 arguments, but got 2.
src/services/scanOrchestrator.ts(487,54): error TS2554: Expected 1 arguments, but got 3.
src/services/scanOrchestrator.ts(488,21): error TS2488: Type 'Promise<HyperliquidPerpResult[]>' must have a '[Symbol.iterator]()' method that returns an iterator.
src/services/scanOrchestrator.ts(495,39): error TS2339: Property 'length' does not exist on type 'Promise<HyperliquidPerpResult[]>'.
src/services/scanOrchestrator.ts(507,78): error TS2554: Expected 1 arguments, but got 2.
src/services/scanOrchestrator.ts(723,44): error TS2345: Argument of type 'HLMetaAndAssetCtxsResponse' is not assignable to parameter of type 'HLMetaUniverseItem[]'.
  Type 'HLMetaAndAssetCtxsResponse' is missing the following properties from type 'HLMetaUniverseItem[]': length, pop, push, concat, and 28 more.
src/services/scanOrchestrator.ts(725,22): error TS2345: Argument of type 'HLMetaUniverseItem' is not assignable to parameter of type 'string'.
src/services/scanOrchestrator.ts(960,9): error TS2322: Type '{ id: string; venue: "polymarket"; market_type: "prediction"; question: string; yes_price: number; no_price: number; volume_24h: number; url: string; relevance_score: number; updated_at: string; ... 4 more ...; edge_bluf: string; }[]' is not assignable to type 'ScanPredictionCard[]'.
  Property 'external_id' is missing in type '{ id: string; venue: "polymarket"; market_type: "prediction"; question: string; yes_price: number; no_price: number; volume_24h: number; url: string; relevance_score: number; updated_at: string; ... 4 more ...; edge_bluf: string; }' but required in type 'ScanPredictionCard'.
src/services/scanOrchestrator.ts(983,9): error TS2322: Type '{ id: string; venue: "hyperliquid"; market_type: "perp"; symbol: string; mark_price: number; change_24h_pct: number; funding_rate: number; open_interest: number; volume_24h: number; url: string; relevance_score: number; updated_at: string; max_leverage: nu

Backend route registration gate failed:

## API_CONTRACTS endpoints with no matching implementation
- POST /api/auth/verify
## Implemented endpoints not declared in API_CONTRACTS (verify intent)
- GET /api/auth/me
- GET /api/health

Dependency consistency gate failed:

Dependency consistency audit still has unresolved items:
"frontend" imports are missing dependencies: jsdom-testing-mocks, styled-components
```

### E2E Verify Errors
```
E2E has failures but none are deterministic — auto-repair skipped.

triage: 0 deterministic, 0 flaky, 0 infra (0 self-healed on retry)

See .ralph/e2e-triage.md for the full report.



> frontend@0.0.0 e2e /Users/57block/code/agentic-builder/generated-code/frontend
> pnpm run e2e:install && playwright test


> frontend@0.0.0 e2e:install /Users/57block/code/agentic-builder/generated-code/frontend
> playwright install chromium --with-deps

Downloading Chrome for Testing 147.0.7727.15 (playwright chromium v1217)[2m from https://cdn.playwright.dev/builds/cft/147.0.7727.15/mac-arm64/chrome-mac-arm64.zip[22m
|                                                                                |   0% of 165.5 MiB
|■■■■■■■■                                                                        |  10% of 165.5 MiB
|■■■■■■■■■■■■■■■■                                                                |  20% of 165.5 MiB
|■■■■■■■■■■■■■■■■■■■■■■■■                                                        |  30% of 165.5 MiB
|■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■                                                |  40% of 165.5 MiB
|■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■                                        |  50% of 165.5 MiB
|■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■                                |  60% of 165.5 MiB
|■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■                        |  70% of 165.5 MiB
|■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■                |  80% of 165.5 MiB
|■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■        |  90% of 165.5 MiB
```

## Feature Audit
- All hard requirement ids are covered.

## Preflight Automation Ledger
### Convention auto-fix
- Invocations: 2 | files rewritten: 14 | unfixable conflicts: 0
  - Renamed residual file "frontend/src/context/AuthContext.tsx" → canonical "frontend/src/contexts/AuthContext.tsx".
  -   ↳ rewrote import paths in 4 file(s) to track the rename.
  - Renamed residual directory "backend/src/middlewares/" → canonical "backend/src/middleware/".
  -   ↳ rewrote import paths in 9 file(s) to track the rename.
  - Renamed residual file "frontend/src/views/NotFound.tsx" → canonical "frontend/src/views/NotFoundPage.tsx".
  -   ↳ rewrote import paths in 1 file(s) to track the rename.
### Missing-import installs
- Auto-installed 1 package(s) across 1 scope(s).
  - `backend` (exit=0): bullmq
### Route registration audit
- Preflight: HARD FAIL (unregistered=0, dangling=0, missingContracts=1, undeclaredImplemented=2)
    - missing contract endpoint: POST /api/auth/verify
- Final: HARD FAIL (unregistered=0, dangling=0, missingContracts=1, undeclaredImplemented=2)
    - missing contract endpoint: POST /api/auth/verify
### Contract completeness audit (ORM-derived)
- Post-generate: clean (relationships=7, missingScoped=0)
- Preflight: clean (relationships=7, missingScoped=0)
- Final: clean (relationships=7, missingScoped=0)

## Defect Category Summary
Each category aggregates audit results relevant to the 5 ways generated code typically fails to 'just run'.

| Category | State | Evidence |
| --- | --- | --- |
| Dependency sync | ❌ FAIL | Auto-installed 1 missing package(s) during preflight across 1 scope(s). |
| Directory / implementation dedup | ✅ PASS | Convention auto-fix rewrote 14 file(s) across 2 invocation(s). |
| Env variable alignment | ✅ PASS | No env alignment signal — generator injected DATABASE_URL defaults and no gate flagged env drift. |
| API contract consistency | ❌ FAIL | Preflight: 0 unregistered module(s), 1 missing contract endpoint(s), 0 dangling registration import(s).<br/>Final gate: 0 unregistered, 1 missing contract, 0 dangling (HARD FAIL). |
| API contract completeness (ORM-derived) | ✅ PASS | Post-generate: 7 ORM relationship(s), 0 scoped endpoint(s) missing.<br/>Preflight: 7 relationship(s), 0 missing.<br/>Final gate: 0 missing. |
| Build & runtime verification | ❌ FAIL | 9 TS error line(s) in integration output. |

## Pipeline Anomalies
Pipeline-level events that affect interpretation of model scores. These reflect the orchestrator behaviour, not the LLM's code quality.

| Event | Count | What it means |
| --- | --- | --- |
| stagnation_warning | 12 | Worker re-read the same files without writing. Threshold-driven nudge. |
| stagnation_fallback_injected | 1 | Pre-abort batch-classify retry was injected (CODEGEN_HARDENING_PLAN.md §7.4). recovered: 1. |
| contract_usage_coverage_audit | 2 | 4-quadrant audit ran (post-contract / pre-integration). Decisions in `.ralph/contract-usage-coverage.json`. |
| doc_truncated | 2 | Context budget exhausted; relevance picker dropped sections. Symptoms include "lost" PRD detail. |
| runtime_integration_audit | 1 | Static §4.2/§4.3/§4.4/§4.5/§4.7 grep audit ran. Findings persisted to `.ralph/runtime-integration-audit.json`. |
| runtime_integration_audit_failure | 1 | Audit found ERROR-severity violations (useSyncExternalStore not cached, useBlocker w/o data router, external-id used as DB PK, SSE not branched on `inproc:`, direct vendor LLM SDK import). The verify-fix worker received a deterministic repair directive for each. |

## Repair / Self-Heal Telemetry
- Total repair events: 67
- Stage `task`: 25
- Stage `integration-gate`: 18
- Stage `worker-verify`: 7
- Stage `preflight-contract-completeness`: 3
- Stage `preflight-route-audit`: 3
- Stage `worker-context`: 2
- Stage `preflight-convention-fix`: 2
- Stage `e2e-triage`: 2
- Stage `post-gen-audit`: 2
- Stage `architect-triage`: 1
- Stage `generate_api_contracts`: 1
- Stage `preflight-deps`: 1

## Recommended Improvements
- Reduce context loss: improve section selection / budget allocation so critical PRD and implementation context is not truncated.
- Tighten task-to-file planning: the worker should either write the planned files or immediately repair the missing file-plan deltas.
- Strengthen dependency alignment: enforce import/package.json consistency before final verification starts, not only at the end.
- Improve final integration convergence: prioritize the highest-signal failing gate first and keep stagnation detection enabled to avoid read-only loops.
- Improve end-to-end reliability: keep smoke/e2e scenarios aligned with PRD flows and feed deterministic failure context back into source repair.
- Optimize model spend: reduce repeated high-cost iterations by improving preflight checks, duplicate-file cleanup, and stricter early gates.

## Codegen Retrofit Suggestions (inferred from this run)
Concrete codegen-pipeline changes derived from the signals above. Cross-references point at `CODEGEN_HARDENING_PLAN.md` sections so each item is actionable.

| # | Severity | Issue | Plan ref |
| --- | --- | --- | --- |
| 1 | 🔴 HIGH | `integration_verify_fix` looped without producing mutations and ran out of budget | §7.2 + §7.4 (stagnation fallback) |
| 2 | 🔴 HIGH | Integration gate failure short-circuited runtime/E2E verification | §7.3 (one gate FAIL ≠ pipeline halt) |
| 3 | 🟡 MED | Workers' file plans repeatedly diverged from the files they wrote | _(no rule yet — open ticket)_ |
| 4 | 🟡 MED | E2E verify still has failing scenarios | _(no rule yet — open ticket)_ |
| 5 | 🟢 LOW | PRD / implementation context was truncated for workers | _(no rule yet — open ticket)_ |
| 6 | 🟢 LOW | Workers wrote files using non-canonical paths; convention auto-fix had to rewrite them | §4 (Worker prompt 'Project-specific conventions') |
| 7 | 🟢 LOW | Repair / verify stages cost as much (or more) than first-pass codegen | §3 (L4 Static Audit) + §7.1 + §7.2 |

### 1. 🔴 HIGH — `integration_verify_fix` looped without producing mutations and ran out of budget

- **id**: `verify-fix-stagnation`
- **plan ref**: §7.2 + §7.4 (stagnation fallback)
- **evidence**:
    - stagnation_warning events: 12.
    - integration_verify_fix: calls=49, cost=$1.5955, duration=5m 38s.
    - Stage exited with blocking integration errors still present.
- **recommendation**: Inject the four-quadrant decision tree into `integration_verify_fix`'s system prompt: explicitly authorise (a) implement, (b) prune contract, (c) add to contract, (d) delete frontend rogue call, (e) implement backend route. Also wire the stagnation fallback: when the in-loop watcher trips, issue ONE batch-classify prompt (read-once / classify-once / write-once) and cap at 2 more iterations.

### 2. 🔴 HIGH — Integration gate failure short-circuited runtime/E2E verification

- **id**: `gate-cascade-skip`
- **plan ref**: §7.3 (one gate FAIL ≠ pipeline halt)
- **evidence**:
    - Integration verify: FAIL.
    - Runtime verify: SKIPPED.
    - E2E verify: PASS/FAIL (executed).
    - Skipped gates leave the report blind to whether the project actually starts and serves traffic.
- **recommendation**: Switch the orchestrator's gate policy from `graph_error` to `FAILED_BUT_CONTINUED`: integration FAIL records the failure but lets runtime + E2E + e2e-triage still run. Only runtime FAIL should block E2E (since the app can't serve traffic). Surface gates as PASS / FAIL / FAIL_CONTINUED / SKIPPED in the report.

### 3. 🟡 MED — Workers' file plans repeatedly diverged from the files they wrote

- **id**: `task-plan-unfulfilled`
- **plan ref**: _(no rule yet — open ticket)_
- **evidence**:
    - task_plan_unfulfilled events: 7.
- **recommendation**: Tighten `task-file-plan-verifier`: after the worker emits its plan, gate the worker so it cannot complete until either every planned path was written OR an explicit `<plan-amendment>` block justifies the delta. This converts silent mismatches into a fast-fail loop instead of accumulating noise.

### 4. 🟡 MED — E2E verify still has failing scenarios

- **id**: `e2e-verify-failure`
- **plan ref**: _(no rule yet — open ticket)_
- **evidence**:
    - E2E error blob (truncated): E2E has failures but none are deterministic — auto-repair skipped. |  | triage: 0 deterministic, 0 flaky, 0 infra (0 self-healed on retry).
- **recommendation**: Pair e2e-triage output with the integration_verify_fix decision tree: deterministic failures should auto-dispatch a `worker_codefix` task scoped to the failing spec's surface area; flaky failures should be retried in isolation; infra-only failures should NOT count against the gate (already halved in scoring — keep that).

### 5. 🟢 LOW — PRD / implementation context was truncated for workers

- **id**: `worker-context-truncation`
- **plan ref**: _(no rule yet — open ticket)_
- **evidence**:
    - doc_truncated=2, truncation_detected=0, worker_context_trimmed=0.
- **recommendation**: Increase `WORKER_CONTEXT_BUDGET_CHARS` for large-window providers (DeepSeek V4 Pro 1M, Gemini 1M). Improve `doc-section-picker.ts` priority so contract-relevant sections + PRD user flows are never the ones dropped first. Consider per-role budgets (frontend gets API client + design spec; backend gets contract + ORM models).

### 6. 🟢 LOW — Workers wrote files using non-canonical paths; convention auto-fix had to rewrite them

- **id**: `convention-baked-into-scaffold`
- **plan ref**: §4 (Worker prompt 'Project-specific conventions')
- **evidence**:
    - conventionAutofix: invocations=2, files rewritten=14, unfixable=0.
    - Sample notes: Renamed residual file "frontend/src/context/AuthContext.tsx" → canonical "frontend/src/contexts/AuthContext.tsx". |   ↳ rewrote import paths in 4 file(s) to track the rename. | Renamed residual directory "backend/src/middlewares/" → canonical "backend/src/middleware/".
- **recommendation**: Promote the canonical paths the auto-fixer keeps writing back (e.g. `frontend/src/contexts/`, `backend/src/middleware/`) into `ROLE_PROMPTS` 'Project-specific conventions' as HARD RULES with explicit anti-patterns. Each canonical path that triggered ≥2 rewrites this session should become an example in the prompt.

### 7. 🟢 LOW — Repair / verify stages cost as much (or more) than first-pass codegen

- **id**: `repair-spend-imbalance`
- **plan ref**: §3 (L4 Static Audit) + §7.1 + §7.2
- **evidence**:
    - worker_codegen cost=$0.0000.
    - integration_verify_fix=$1.5955, phase_verify_fix=$2.3143, worker_codefix=$0.3122.
    - Repair total / codegen ratio = Infinity.
- **recommendation**: Push fixes upstream: the cheapest dollar is the one not spent on repair. Strengthen preflight (route audit, contract completeness, dep audit) so issues fail fast at low cost; route the most common repair patterns (4-quadrant contract, missing routers) into deterministic codemods rather than LLM iteration.
