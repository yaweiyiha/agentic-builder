# Coding Session Report

- Session ID: `44fb392e-79c5-4cb3-9fc2-14362d8584ba`
- Status: **FAIL**
- Score: **34/100 (F)**
- Runtime readiness: 3 finding(s) — 1 error, 2 warn
- Started at: 2026-04-29T09:55:57.821Z
- Ended at: 2026-04-29T11:58:24.061Z
- Generator git: `152bab8`
- Scaffold fix attempts: 50
- Integration fix attempts: 1
- Total LLM calls: 180
- Total LLM tokens: 3428043
- Total LLM cost: $1.6800
- Generated/known files in registry: 227

## Summary
Timeout/terminated: Integration verify gate failed.
No report_done received from IntegrationVerifyFix.

Final scoped validation gates failed:

backend_smoke: pass

frontend_tsc failed:
src/components/markets/MarketSection.tsx(1,10): error TS2305: Module '"../../hooks/useMarketScanner"' has no exported member 'MarketMatch'.
src/components/markets/ResultMarketCard.tsx(1,10): error TS2305: Module '"../../hooks/useMarketScanner"' has no exported member 'MarketMatch'.
src/components/markets/ScannerLog.tsx(1,10): error TS1484: 'ScanStep' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
src/components/markets/ScannerLog.tsx(25,45): error TS2339: Property 'result' does not exist on type 'ScanStep'.
src/components/markets/ScannerLog.tsx(26,54): error TS2339: Property 'result' does not exist on type 'ScanStep'.
src/components/markets/ScannerLog.tsx(64,21): error TS2339: Property 'errorMessage' does not exist on type 'ScanStep'.
src/components/markets/ScannerLog.tsx(66,25): error TS2339: Property 'errorMessage' does not exist on type 'ScanStep'.
src/components/markets/ScanResults.tsx(1,10): error TS1484: 'ScanResult' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
src/components/markets/ScanResults.tsx(20,28): error TS2339: Property 'perps' does not exist on type 'ScanResult'.
src/components/markets/ScanResults.tsx(38,21): error TS2339: Property 'summary' does not exist on type 'ScanResult'.
src/components/markets/ScanResults.tsx(128,25): error TS2339: Property 'perps' does not exist on type 'ScanResult'.
src/components/onboarding/StyleResultCard.tsx(26,26): error TS5076: '||' and '??' operations cannot be mixed without parentheses.
src/components/onboarding/StyleResultCard.tsx(27,30): error TS5076: '||' and '??' operations cannot be mixed without parentheses.
src/components/profile/StyleSection.tsx(2,10): error TS2724: '"lucide-react"' has no exported member named 'QuestionMark'. Did you mean 'FileQuestionMark'?
src/hooks/useMarketScanner.ts(157,13): error TS2367: This comparison appears to be unintentional because the types '"results" | "error" | "idle"' and '"sc

frontend_build failed:
> frontend@0.0.0 build /Users/57block/code/AgenticBuilder/generated-code/frontend
> tsc -b && vite build

[96msrc/components/markets/MarketSection.tsx[0m:[93m1[0m:[93m10[0m - [91merror[0m[90m TS2305: [0mModule '"../../hooks/useMarketScanner"' has no exported member 'MarketMatch'.

[7m1[0m import { MarketMatch } from "../../hooks/useMarketScanner";
[7m [0m [91m         ~~~~~~~~~~~[0m

[96msrc/components/markets/ResultMarketCard.tsx[0m:[93m1[0m:[93m10[0m - [91merror[0m[90m TS2305: [0mModule '"../../hooks/useMarketScanner"' has no exported member 'MarketMatch'.

[7m1[0m import { MarketMatch } from "../../hooks/useMarketScanner";
[7m [0m [91m         ~~~~~~~~~~~[0m

[96msrc/components/markets/ScannerLog.tsx[0m:[93m1[0m:[93m10[0m - [91merror[0m[90m TS1484: [0m'ScanStep' is a type and must be im

E2E verify gate failed.
E2E has failures but none are deterministic — auto-repair skipped.

triage: 0 deterministic, 0 flaky, 0 infra (0 self-healed on retry)

See .ralph/e2e-triage.md for the full report.





[1A[2K[24/25] [chromium] › tests/e2e/generated/e2e-002-interests-onboarding-enforces-minimum-se.spec.ts:180:3 › E2E-002 — Interests onboarding enforces minimum selection before continue › Step 4 — Click CONTINUE sends PUT /api/users/me/interests and routes to /onboarding/style
[1A[2K[31m  23) [chromium] › tests/e2e/generated/e2e-006-feed-infinite-scroll-load-more-retry-and.spec.ts:215:3 › E2E-006 — Feed infinite scroll, load-more retry, and end-of-list footer › Step 3 — Terminal footer renders when end of list is reached [39m

    Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

    Locator: getByText('Infinite Story 15')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for getByText('Infinite Story 15')[22m


    [0m [90m 246 |[39m     }
     [90m 247 |[39m
    [31m[1m>[22m[39m[90m 248 |[39m     [36mawait[39m expect(page[33m.[39mgetByText([32m"Infinite Story 15"[39m))[33m.[39mtoBeVisible({ timeout[33m:[39m [35m10[39m_000 })[33m;[39m
     [90m     |[39m                                                       [31m[1m^[22m[39m
     [90m 249 |[39m
     [90m 250 |[39m     [36mawait[39m expect(
     [90m 251 |[39m       page[0m
    [2m    at /Users/57block/code/AgenticBuilder/generated-code/frontend/tests/e2e/generated/e2e-006-feed-infinite-scroll-load-more-retry-and.spec.ts:248:55[22m

[2m    attachment #1: [1mscreenshot[2m (image/png) [2m──────────────────────────────────────────────────────────[2m[22m
[2m    test-results/generated-e2e-006-feed-inf-14ac5-when-end-of-list-is-reached-chromium/test-failed-1.png[22m
[2m    [2m────────────────────────────────────────────────────────────────────────────────────────────────[2m[22m

[2m    Error Context: test-results/generated-e2e-006-feed-inf-14ac5-when-end-of-list-is-reached-chromium/error-context.md[22m

## Runtime Readiness
Static §4.2/§4.3/§4.4/§4.5/§4.7 audit of generated source. Findings here mean known runtime pitfalls slipped past the verify-fix worker. Full report: `.ralph/runtime-integration-audit.json`.

**3 finding(s)** — 1 error, 2 warn.

| Rule | Severity | Locations |
| --- | --- | --- |
| `bg-job-inproc-branch` | ERROR | backend/src/services/feedAggregation.service.ts:26 |
| `bg-job-worker-startup` | WARN | backend/src/workers/feedAggregationWorker.ts:7 |
| `empty-results-not-failure` | WARN | backend/src/services/feedAggregator.ts:185 |

**Disabled rules:**
- `llm-client-abstraction` — no LLM_* bundle declared on resource requirements — abstraction rule N/A.

## Task Outcome
- Completed: 19
- Completed with warnings: 0
- Failed: 0
- Unknown: 0

## Scoring Breakdown

**Formula:** `100 − 20(fail) − 10(integration) − 20(e2e:blocking errors) − 8(trunc:23) − 8(plan-unfulfilled:10) = 34`

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
| Context truncation | −8 | **-8** ❌ | doc_truncated events |
| Plan mismatches | −8 | **-8** ❌ | task_plan_unfulfilled events |
| All tasks done bonus | +5 | 0 (not triggered) | all tasks complete + no blocking gates |

## Model Usage
- `openai/gpt-5.3-codex-20260224`: calls=61, cost=$1.6800, tokens=723593, stages=worker_codegen:Backend Dev, worker_codefix:Test Engineer, worker_codefix:Backend Dev, phase_verify_fix, extract_real_contracts, worker_codegen:Frontend Dev, worker_codefix:Frontend Dev
- `deepseek/deepseek-v4-pro-20260423`: calls=87, cost=$0.0000, tokens=2165037, stages=worker_codegen:Architect, worker_codegen:Test Engineer, worker_codegen:Backend Dev, worker_codegen:Frontend Dev
- `deepseek/deepseek-v3.2-20251201`: calls=31, cost=$0.0000, tokens=530406, stages=worker_codegen:Frontend Dev, worker_codefix:Frontend Dev, phase_verify_fix
- `anthropic/claude-4-sonnet-20250522`: calls=1, cost=$0.0000, tokens=9007, stages=generate_api_contracts

## Stage Diagnostics
- `architect-triage`: duration=0s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `worker-context`: duration=115m 41s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=76/100 (C), models=(none)
  notes=Context was truncated 23 time(s).
- `worker_codegen`: duration=108m 42s, calls=102, tokens=2577758 (prompt=2380734, completion=197024), cost=$0.1191, score=100/100 (A), models=deepseek/deepseek-v4-pro-20260423, openai/gpt-5.3-codex-20260224, deepseek/deepseek-v3.2-20251201
  labels=Architect, Test Engineer, Backend Dev, Frontend Dev
  notes=No strong negative signal captured.
- `task`: duration=103m 7s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `generate_api_contracts`: duration=0s, calls=1, tokens=9007 (prompt=7357, completion=1650), cost=$0.0000, score=100/100 (A), models=anthropic/claude-4-sonnet-20250522
  notes=No strong negative signal captured.
- `preflight-contract-completeness`: duration=106m 6s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `worker-verify`: duration=75m 9s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=68/100 (D), models=(none)
  notes=Task/file plan mismatches happened 10 time(s).
- `worker_codefix`: duration=76m 17s, calls=10, tokens=71779 (prompt=46755, completion=25024), cost=$0.3506, score=100/100 (A), models=openai/gpt-5.3-codex-20260224, deepseek/deepseek-v3.2-20251201
  labels=Test Engineer, Backend Dev, Frontend Dev
  notes=No strong negative signal captured.
- `preflight-convention-fix`: duration=53m 48s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `phase_verify_fix`: duration=58m 18s, calls=66, tokens=762421 (prompt=751218, completion=11203), cost=$1.1779, score=90/100 (A), models=openai/gpt-5.3-codex-20260224, deepseek/deepseek-v3.2-20251201
  notes=Earlier phase verify/fix did not fully prevent later integration failures.
- `extract_real_contracts`: duration=0s, calls=1, tokens=7078 (prompt=5443, completion=1635), cost=$0.0324, score=100/100 (A), models=openai/gpt-5.3-codex-20260224
  notes=No strong negative signal captured.
- `preflight-deps`: duration=0s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `preflight-route-audit`: duration=7s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `integration-gate`: duration=30s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `e2e-triage`: duration=0s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `post-gen-audit`: duration=0s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.

## Model Effectiveness
- `deepseek/deepseek-v4-pro-20260423`: score=100/100 (A), calls=87, tokens=2165037, cost=$0.0000, stages=worker_codegen
  notes=No strong negative signal captured.
- `openai/gpt-5.3-codex-20260224`: score=91.5/100 (A), calls=61, tokens=723593, cost=$1.6800, stages=worker_codegen, worker_codefix, phase_verify_fix, extract_real_contracts
  notes=Earlier phase verify/fix did not fully prevent later integration failures.
- `deepseek/deepseek-v3.2-20251201`: score=97.2/100 (A), calls=31, tokens=530406, cost=$0.0000, stages=worker_codegen, worker_codefix, phase_verify_fix
  notes=Earlier phase verify/fix did not fully prevent later integration failures.
- `anthropic/claude-4-sonnet-20250522`: score=100/100 (A), calls=1, tokens=9007, cost=$0.0000, stages=generate_api_contracts
  notes=No strong negative signal captured.

## Quality Gates
- Integration verify: FAIL (continued)
- Runtime verify: SKIPPED
- E2E verify: FAIL
- Feature audit: PASS

### Integration Errors
```
No report_done received from IntegrationVerifyFix.

Final scoped validation gates failed:

backend_smoke: pass

frontend_tsc failed:
src/components/markets/MarketSection.tsx(1,10): error TS2305: Module '"../../hooks/useMarketScanner"' has no exported member 'MarketMatch'.
src/components/markets/ResultMarketCard.tsx(1,10): error TS2305: Module '"../../hooks/useMarketScanner"' has no exported member 'MarketMatch'.
src/components/markets/ScannerLog.tsx(1,10): error TS1484: 'ScanStep' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
src/components/markets/ScannerLog.tsx(25,45): error TS2339: Property 'result' does not exist on type 'ScanStep'.
src/components/markets/ScannerLog.tsx(26,54): error TS2339: Property 'result' does not exist on type 'ScanStep'.
src/components/markets/ScannerLog.tsx(64,21): error TS2339: Property 'errorMessage' does not exist on type 'ScanStep'.
src/components/markets/ScannerLog.tsx(66,25): error TS2339: Property 'errorMessage' does not exist on type 'ScanStep'.
src/components/markets/ScanResults.tsx(1,10): error TS1484: 'ScanResult' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
src/components/markets/ScanResults.tsx(20,28): error TS2339: Property 'perps' does not exist on type 'ScanResult'.
src/components/markets/ScanResults.tsx(38,21): error TS2339: Property 'summary' does not exist on type 'ScanResult'.
src/components/markets/ScanResults.tsx(128,25): error TS2339: Property 'perps' does not exist on type 'ScanResult'.
src/components/onboarding/StyleResultCard.tsx(26,26): error TS5076: '||' and '??' operations cannot be mixed without parentheses.
src/components/onboarding/StyleResultCard.tsx(27,30): error TS5076: '||' and '??' operations cannot be mixed without parentheses.
src/components/profile/StyleSection.tsx(2,10): error TS2724: '"lucide-react"' has no exported member named 'QuestionMark'. Did you mean 'FileQuestionMark'?
src/hooks/useMarketScanner.ts(157,13): error TS2367: This comparison appears to be unintentional because the types '"results" | "error" | "idle"' and '"sc

frontend_build failed:
> frontend@0.0.0 build /Users/57block/code/AgenticBuilder/generated-code/frontend
> tsc -b && vite build

[96msrc/components/markets/MarketSection.tsx[0m:[93m1[0m:[93m10[0m - [91merror[0m[90m TS2305: [0mModule '"../../hooks/useMarketScanner"' has no exported member 'MarketMatch'.

[7m1[0m import { MarketMatch } from "../../hooks/useMarketScanner";
[7m [0m [91m         ~~~~~~~~~~~[0m

[96msrc/components/markets/ResultMarketCard.tsx[0m:[93m1[0m:[93m10[0m - [91merror[0m[90m TS2305: [0mModule '"../../hooks/useMarketScanner"' has no exported member 'MarketMatch'.

[7m1[0m import { MarketMatch } from "../../hooks/useMarketScanner";
[7m [0m [91m         ~~~~~~~~~~~[0m

[96msrc/components/markets/ScannerLog.tsx[0m:[93m1[0m:[93m10[0m - [91merror[0m[90m TS1484: [0m'ScanStep' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.

[7m1[0m import { ScanStep } from "../../hooks/useMarketScanner";
[7m [0m [91m         ~~~~~~~~[0m

[96msrc/components/markets/ScannerLog.tsx[0m:[93m25[0m:[93m45[0m - [91merror[0m[90m TS2339: [0mProperty 'result' does not exist on type 'ScanStep'.

[7m25[0m     if (step.status === "completed" && step.result) {
[7m  [0m [91m                                            ~~~~~~[0m

[96msrc/components/markets/ScannerLog.tsx[0m:[93m26[0m:[93m54[0m - [91merror[0m[90m TS2339: [0mProperty 'result' does not exist on type 'ScanStep'.

[7m26[0m       return <span className="text-[#00aa00]">[{step.result}]</span>;
[7m  [0m [91m                                                     ~~~~~~[0m

[96msrc/components/markets/ScannerLog.tsx[0m:[93m64[0m:[93m21[0m - [91merror[0m[90m TS2339: [0mProperty 'errorMessage' does not exist on type 'ScanStep'.

[7m64[0m               {step.errorMess
```

### E2E Verify Errors
```
E2E has failures but none are deterministic — auto-repair skipped.

triage: 0 deterministic, 0 flaky, 0 infra (0 self-healed on retry)

See .ralph/e2e-triage.md for the full report.





[1A[2K[24/25] [chromium] › tests/e2e/generated/e2e-002-interests-onboarding-enforces-minimum-se.spec.ts:180:3 › E2E-002 — Interests onboarding enforces minimum selection before continue › Step 4 — Click CONTINUE sends PUT /api/users/me/interests and routes to /onboarding/style
[1A[2K[31m  23) [chromium] › tests/e2e/generated/e2e-006-feed-infinite-scroll-load-more-retry-and.spec.ts:215:3 › E2E-006 — Feed infinite scroll, load-more retry, and end-of-list footer › Step 3 — Terminal footer renders when end of list is reached [39m

    Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

    Locator: getByText('Infinite Story 15')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for getByText('Infinite Story 15')[22m


    [0m [90m 246 |[39m     }
     [90m 247 |[39m
    [31m[1m>[22m[39m[90m 248 |[39m     [36mawait[39m expect(page[33m.[39mgetByText([32m"Infinite Story 15"[39m))[33m.[39mtoBeVisible({ timeout[33m:[39m [35m10[39m_000 })[33m;[39m
     [90m     |[39m                                                       [31m[1m^[22m[39m
     [90m 249 |[39m
     [90m 250 |[39m     [36mawait[39m expect(
     [90m 251 |[39m       page[0m
    [2m    at /Users/57block/code/AgenticBuilder/generated-code/frontend/tests/e2e/generated/e2e-006-feed-infinite-scroll-load-more-retry-and.spec.ts:248:55[22m

[2m    attachment #1: [1mscreenshot[2m (image/png) [2m──────────────────────────────────────────────────────────[2m[22m
[2m    test-results/generated-e2e-006-feed-inf-14ac5-when-end-of-list-is-reached-chromium/test-failed-1.png[22m
[2m    [2m────────────────────────────────────────────────────────────────────────────────────────────────[2m[22m

[2m    Error Context: test-results/generated-e2e-006-feed-inf-14ac5-when-end-of-list-is-reached-chromium/error-context.md[22m
```

## Feature Audit
- All hard requirement ids are covered.

## Preflight Automation Ledger
### Convention auto-fix
- Invocations: 2 | files rewritten: 17 | unfixable conflicts: 0
  - Renamed residual file "frontend/src/context/AuthContext.tsx" → canonical "frontend/src/contexts/AuthContext.tsx".
  -   ↳ rewrote import paths in 4 file(s) to track the rename.
  - Renamed residual directory "backend/src/middlewares/" → canonical "backend/src/middleware/".
  -   ↳ rewrote import paths in 12 file(s) to track the rename.
  - Renamed residual file "frontend/src/views/NotFound.tsx" → canonical "frontend/src/views/NotFoundPage.tsx".
  -   ↳ rewrote import paths in 1 file(s) to track the rename.
### Missing-import installs
- Auto-installed 3 package(s) across 2 scope(s).
  - `backend` (exit=0): openai, bullmq
  - `frontend` (exit=0): lucide-react
### Route registration audit
- Preflight: HARD FAIL (unregistered=4, dangling=0, missingContracts=4, undeclaredImplemented=5)
    - unregistered: backend/src/api/modules/feed/feed.routes.ts: exports "registerFeedRoutes" but index.ts never calls it.
    - unregistered: backend/src/api/modules/markets/markets.routes.ts: exports "registerMarketsRoutes" but index.ts never calls it.
    - unregistered: backend/src/api/modules/stream/stream.routes.ts: exports "registerStreamRoutes" but index.ts never calls it.
    - unregistered: backend/src/api/modules/users/users.routes.ts: exports "registerUsersRoutes" but index.ts never calls it.
    - missing contract endpoint: GET /api/feed/stream
    - missing contract endpoint: GET /api/feed/status
    - missing contract endpoint: POST /api/scan
    - missing contract endpoint: GET /api/scan/stream
- Final: HARD FAIL (unregistered=4, dangling=0, missingContracts=4, undeclaredImplemented=5)
    - unregistered: backend/src/api/modules/feed/feed.routes.ts: exports "registerFeedRoutes" but index.ts never calls it.
    - unregistered: backend/src/api/modules/markets/markets.routes.ts: exports "registerMarketsRoutes" but index.ts never calls it.
    - unregistered: backend/src/api/modules/stream/stream.routes.ts: exports "registerStreamRoutes" but index.ts never calls it.
    - unregistered: backend/src/api/modules/users/users.routes.ts: exports "registerUsersRoutes" but index.ts never calls it.
    - missing contract endpoint: GET /api/feed/stream
    - missing contract endpoint: GET /api/feed/status
    - missing contract endpoint: POST /api/scan
    - missing contract endpoint: GET /api/scan/stream
### Contract completeness audit (ORM-derived)
- Post-generate: clean (relationships=7, missingScoped=0)
- Preflight: clean (relationships=7, missingScoped=0)
- Final: clean (relationships=7, missingScoped=0)

## Defect Category Summary
Each category aggregates audit results relevant to the 5 ways generated code typically fails to 'just run'.

| Category | State | Evidence |
| --- | --- | --- |
| Dependency sync | ⚠️ WARN | Auto-installed 3 missing package(s) during preflight across 2 scope(s). |
| Directory / implementation dedup | ✅ PASS | Convention auto-fix rewrote 17 file(s) across 2 invocation(s). |
| Env variable alignment | ✅ PASS | No env alignment signal — generator injected DATABASE_URL defaults and no gate flagged env drift. |
| API contract consistency | ❌ FAIL | Preflight: 4 unregistered module(s), 4 missing contract endpoint(s), 0 dangling registration import(s).<br/>Final gate: 4 unregistered, 4 missing contract, 0 dangling (HARD FAIL). |
| API contract completeness (ORM-derived) | ✅ PASS | Post-generate: 7 ORM relationship(s), 0 scoped endpoint(s) missing.<br/>Preflight: 7 relationship(s), 0 missing.<br/>Final gate: 0 missing. |
| Build & runtime verification | ❌ FAIL | 15 TS error line(s) in integration output.<br/>Build command reported failure during integration. |

## Pipeline Anomalies
Pipeline-level events that affect interpretation of model scores. These reflect the orchestrator behaviour, not the LLM's code quality.

| Event | Count | What it means |
| --- | --- | --- |
| contract_usage_coverage_audit | 2 | 4-quadrant audit ran (post-contract / pre-integration). Decisions in `.ralph/contract-usage-coverage.json`. |
| doc_truncated | 23 | Context budget exhausted; relevance picker dropped sections. Symptoms include "lost" PRD detail. |
| runtime_integration_audit | 1 | Static §4.2/§4.3/§4.4/§4.5/§4.7 grep audit ran. Findings persisted to `.ralph/runtime-integration-audit.json`. |
| runtime_integration_audit_failure | 1 | Audit found ERROR-severity violations (useSyncExternalStore not cached, useBlocker w/o data router, external-id used as DB PK, SSE not branched on `inproc:`, direct vendor LLM SDK import). The verify-fix worker received a deterministic repair directive for each. |

## Repair / Self-Heal Telemetry
- Total repair events: 96
- Stage `worker-context`: 44
- Stage `task`: 19
- Stage `worker-verify`: 10
- Stage `integration-gate`: 6
- Stage `preflight-route-audit`: 4
- Stage `preflight-contract-completeness`: 3
- Stage `architect-triage`: 2
- Stage `preflight-convention-fix`: 2
- Stage `e2e-triage`: 2
- Stage `post-gen-audit`: 2
- Stage `generate_api_contracts`: 1
- Stage `preflight-deps`: 1

## Recommended Improvements
- Reduce context loss: improve section selection / budget allocation so critical PRD and implementation context is not truncated.
- Tighten task-to-file planning: the worker should either write the planned files or immediately repair the missing file-plan deltas.
- Improve final integration convergence: prioritize the highest-signal failing gate first and keep stagnation detection enabled to avoid read-only loops.
- Improve end-to-end reliability: keep smoke/e2e scenarios aligned with PRD flows and feed deterministic failure context back into source repair.
- Optimize model spend: reduce repeated high-cost iterations by improving preflight checks, duplicate-file cleanup, and stricter early gates.

## Codegen Retrofit Suggestions (inferred from this run)
Concrete codegen-pipeline changes derived from the signals above. Cross-references point at `CODEGEN_HARDENING_PLAN.md` sections so each item is actionable.

| # | Severity | Issue | Plan ref |
| --- | --- | --- | --- |
| 1 | 🔴 HIGH | Integration gate failure short-circuited runtime/E2E verification | §7.3 (one gate FAIL ≠ pipeline halt) |
| 2 | 🟡 MED | PRD / implementation context was truncated for workers | _(no rule yet — open ticket)_ |
| 3 | 🟡 MED | Workers' file plans repeatedly diverged from the files they wrote | _(no rule yet — open ticket)_ |
| 4 | 🟡 MED | Backend route registrars existed but weren't wired into the app router | §4.4 (Background jobs / route registration) |
| 5 | 🟡 MED | E2E verify still has failing scenarios | _(no rule yet — open ticket)_ |
| 6 | 🟢 LOW | Workers wrote files using non-canonical paths; convention auto-fix had to rewrite them | §4 (Worker prompt 'Project-specific conventions') |
| 7 | 🟢 LOW | Workers imported packages without declaring them in package.json | §4.1 (Conditional scaffold extraDeps) + §4.10 (manifest) |
| 8 | 🟢 LOW | Repair / verify stages cost as much (or more) than first-pass codegen | §3 (L4 Static Audit) + §7.1 + §7.2 |

### 1. 🔴 HIGH — Integration gate failure short-circuited runtime/E2E verification

- **id**: `gate-cascade-skip`
- **plan ref**: §7.3 (one gate FAIL ≠ pipeline halt)
- **evidence**:
    - Integration verify: FAIL.
    - Runtime verify: SKIPPED.
    - E2E verify: PASS/FAIL (executed).
    - Skipped gates leave the report blind to whether the project actually starts and serves traffic.
- **recommendation**: Switch the orchestrator's gate policy from `graph_error` to `FAILED_BUT_CONTINUED`: integration FAIL records the failure but lets runtime + E2E + e2e-triage still run. Only runtime FAIL should block E2E (since the app can't serve traffic). Surface gates as PASS / FAIL / FAIL_CONTINUED / SKIPPED in the report.

### 2. 🟡 MED — PRD / implementation context was truncated for workers

- **id**: `worker-context-truncation`
- **plan ref**: _(no rule yet — open ticket)_
- **evidence**:
    - doc_truncated=23, truncation_detected=0, worker_context_trimmed=21.
- **recommendation**: Increase `WORKER_CONTEXT_BUDGET_CHARS` for large-window providers (DeepSeek V4 Pro 1M, Gemini 1M). Improve `doc-section-picker.ts` priority so contract-relevant sections + PRD user flows are never the ones dropped first. Consider per-role budgets (frontend gets API client + design spec; backend gets contract + ORM models).

### 3. 🟡 MED — Workers' file plans repeatedly diverged from the files they wrote

- **id**: `task-plan-unfulfilled`
- **plan ref**: _(no rule yet — open ticket)_
- **evidence**:
    - task_plan_unfulfilled events: 10.
- **recommendation**: Tighten `task-file-plan-verifier`: after the worker emits its plan, gate the worker so it cannot complete until either every planned path was written OR an explicit `<plan-amendment>` block justifies the delta. This converts silent mismatches into a fast-fail loop instead of accumulating noise.

### 4. 🟡 MED — Backend route registrars existed but weren't wired into the app router

- **id**: `backend-route-registration-gap`
- **plan ref**: §4.4 (Background jobs / route registration)
- **evidence**:
    - Unregistered modules: 4 (backend/src/api/modules/feed/feed.routes.ts: exports "registerFeedRoutes" but index.ts never calls it., backend/src/api/modules/markets/markets.routes.ts: exports "registerMarketsRoutes" but index.ts never calls it., backend/src/api/modules/stream/stream.routes.ts: exports "registerStreamRoutes" but index.ts never calls it.).
    - Dangling registration imports: 0 (—).
- **recommendation**: Add to `ROLE_PROMPTS.backend` 'Project-specific conventions': **after** creating any `register<Domain>Routes()`, you MUST import + call it inside `apiRouter` (or the canonical aggregator) in the SAME response. Provide the exact aggregator file path in the Project Convention Card.

### 5. 🟡 MED — E2E verify still has failing scenarios

- **id**: `e2e-verify-failure`
- **plan ref**: _(no rule yet — open ticket)_
- **evidence**:
    - E2E error blob (truncated): E2E has failures but none are deterministic — auto-repair skipped. |  | triage: 0 deterministic, 0 flaky, 0 infra (0 self-healed on retry).
- **recommendation**: Pair e2e-triage output with the integration_verify_fix decision tree: deterministic failures should auto-dispatch a `worker_codefix` task scoped to the failing spec's surface area; flaky failures should be retried in isolation; infra-only failures should NOT count against the gate (already halved in scoring — keep that).

### 6. 🟢 LOW — Workers wrote files using non-canonical paths; convention auto-fix had to rewrite them

- **id**: `convention-baked-into-scaffold`
- **plan ref**: §4 (Worker prompt 'Project-specific conventions')
- **evidence**:
    - conventionAutofix: invocations=2, files rewritten=17, unfixable=0.
    - Sample notes: Renamed residual file "frontend/src/context/AuthContext.tsx" → canonical "frontend/src/contexts/AuthContext.tsx". |   ↳ rewrote import paths in 4 file(s) to track the rename. | Renamed residual directory "backend/src/middlewares/" → canonical "backend/src/middleware/".
- **recommendation**: Promote the canonical paths the auto-fixer keeps writing back (e.g. `frontend/src/contexts/`, `backend/src/middleware/`) into `ROLE_PROMPTS` 'Project-specific conventions' as HARD RULES with explicit anti-patterns. Each canonical path that triggered ≥2 rewrites this session should become an example in the prompt.

### 7. 🟢 LOW — Workers imported packages without declaring them in package.json

- **id**: `missing-deps-auto-install`
- **plan ref**: §4.1 (Conditional scaffold extraDeps) + §4.10 (manifest)
- **evidence**:
    - Auto-installed 3 package(s) across 2 scope(s): backend:openai, backend:bullmq, frontend:lucide-react.
- **recommendation**: Either (a) add the well-known feature packages (the optional scaffold's `extraDeps`) so the dep is present from day one, or (b) inject a HARD RULE in worker prompts: 'before importing a package, ensure it appears in `package.json`; emit a separate `package.json` patch in the same response if missing'.

### 8. 🟢 LOW — Repair / verify stages cost as much (or more) than first-pass codegen

- **id**: `repair-spend-imbalance`
- **plan ref**: §3 (L4 Static Audit) + §7.1 + §7.2
- **evidence**:
    - worker_codegen cost=$0.1191.
    - integration_verify_fix=$0.0000, phase_verify_fix=$1.1779, worker_codefix=$0.3506.
    - Repair total / codegen ratio = 12.83.
- **recommendation**: Push fixes upstream: the cheapest dollar is the one not spent on repair. Strengthen preflight (route audit, contract completeness, dep audit) so issues fail fast at low cost; route the most common repair patterns (4-quadrant contract, missing routers) into deterministic codemods rather than LLM iteration.
