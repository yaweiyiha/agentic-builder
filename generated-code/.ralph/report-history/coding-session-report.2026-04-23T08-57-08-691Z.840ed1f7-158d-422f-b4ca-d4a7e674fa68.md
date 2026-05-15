# Coding Session Report

- Session ID: `840ed1f7-158d-422f-b4ca-d4a7e674fa68`
- Status: **FAIL**
- Score: **46/100 (F)**
- Started at: 2026-04-23T07:10:39.849Z
- Ended at: 2026-04-23T08:57:08.691Z
- Generator git: `a169ab7`
- Scaffold fix attempts: 45
- Integration fix attempts: 24
- Total LLM calls: 186
- Total LLM tokens: 5351976
- Total LLM cost: $13.1156
- Generated/known files in registry: 226

## Summary
Integration verify gate failed.
IntegrationVerifyFix stalled without making code changes.
No mutation for 10 consecutive iteration(s).
Dynamic stagnation threshold reached: abortAt=10, progressScore=0/6.
Last meaningful progress: iteration 14 (filesystem mutation (write_file:frontend/src/router.tsx)).
Aborting instead of spending more iterations rereading the same files.

Final scoped validation gates failed:

backend_tsc: pass

frontend_tsc failed:
src/views/OnboardingInterestsPage.tsx(85,11): error TS1128: Declaration or statement expected.
src/views/OnboardingInterestsPage.tsx(111,9): error TS1128: Declaration or statement expected.
src/views/OnboardingInterestsPage.tsx(112,7): error TS1109: Expression expected.
src/views/OnboardingInterestsPage.tsx(113,5): error TS1109: Expression expected.
src/views/OnboardingInterestsPage.tsx(114,3): error TS1109: Expression expected.
src/views/OnboardingInterestsPage.tsx(115,1): error TS1128: Declaration or statement expected.

frontend_build failed:
> frontend@0.0.0 build /Users/57block/code/AgenticBuilder/generated-code/frontend
> tsc -b && vite build

[96msrc/views/OnboardingInterestsPage.tsx[0m:[93m85[0m:[93m11[0m - [91merror[0m[90m TS1128: [0mDeclaration or statement expected.

[7m85[0m           </div>
[7m  [0m [91m          ~~[0m

[96msrc/views/OnboardingInterestsPage.tsx[0m:[93m111[0m:[93m9[0m - [91merror[0m[90m TS1128: [0mDeclaration or statement expected.

[7m111[0m         </form>
[7m   [0m [91m        ~~[0m

[96msrc/views/OnboardingInterestsPage.tsx[0m:[93m112[0m:[93m7[0m - [91merror[0m[90m TS1109: [0mExpression expected.

[7m112[0m       </div>
[7m   [0m [91m      ~~[0m

[96msrc/views/OnboardingInterestsPage.tsx[0m:[93m113[0m:[93m5[0m - [91merror[0m[90m TS1109: [0mExpression expected.

[7m113[0m     </AppShell>
[7m   [0m [91m    ~~[0m

[96msrc/views/OnboardingInterestsPage.tsx[0m:[93m114[0m:[93m3[0m - [91merror[0m[90m TS1109: [0mExpression expected.

[7m114[0m   );
[7m   [0m [91m  ~[0m

[96msrc/views/OnboardingInterestsPage.tsx[0m:[93m115[0m:[93m1[0m - [91merror[0m[90m TS1128: [0mDeclaration or statement expected.

[7m115[0m }
[7m   [0m [91m~[0m


Found 6 errors.

[41m[30m ELIFECYCLE [39m[49m [31mCommand failed with exit code 2.[39m

backend_smoke failed:
REJECTED: command not in allowlist. Allowed: tsc, npx tsc, npx ts-fix, npx --no-install ts-fix, npx prisma, npx playwright, npm install, npm run build, npm run dev, npm run test, npm run lint, npm install &&, npm add, pnpm install, pnpm run build, pnpm run dev, pnpm run test, pnpm run e2e, pnpm run lint, npm run e2e, yarn run e2e, pnpm exec playwright, pnpm install &&, pnpm add, pnpm approve-builds, yarn install, yarn run build, yarn run dev, yarn run test, yarn run lint, yarn install &&, yarn add, ls, cat, head, tail, find, wc, node -e, git init, git add, git commit, git status, git log, git rev-parse

Backend route registration gate failed:

## Unregistered backend module

## Fatal Error
Integration verify gate failed.
IntegrationVerifyFix stalled without making code changes.
No mutation for 10 consecutive iteration(s).
Dynamic stagnation threshold reached: abortAt=10, progressScore=0/6.
Last meaningful progress: iteration 14 (filesystem mutation (write_file:frontend/src/router.tsx)).
Aborting instead of spending more iterations rereading the same files.

Final scoped validation gates failed:

backend_tsc: pass

frontend_tsc failed:
src/views/OnboardingInterestsPage.tsx(85,11): error TS1128: Declaration or statement expected.
src/views/OnboardingInterestsPage.tsx(111,9): error TS1128: Declaration or statement expected.
src/views/OnboardingInterestsPage.tsx(112,7): error TS1109: Expression expected.
src/views/OnboardingInterestsPage.tsx(113,5): error TS1109: Expression expected.
src/views/OnboardingInterestsPage.tsx(114,3): error TS1109: Expression expected.
src/views/OnboardingInterestsPage.tsx(115,1): error TS1128: Declaration or statement expected.

frontend_build failed:
> frontend@0.0.0 build /Users/57block/code/AgenticBuilder/generated-code/frontend
> tsc -b && vite build

[96msrc/views/OnboardingInterestsPage.tsx[0m:[93m85[0m:[93m11[0m - [91merror[0m[90m TS1128: [0mDeclaration or statement expected.

[7m85[0m           </div>
[7m  [0m [91m          ~~[0m

[96msrc/views/OnboardingInterestsPage.tsx[0m:[93m111[0m:[93m9[0m - [91merror[0m[90m TS1128: [0mDeclaration or statement expected.

[7m111[0m         </form>
[7m   [0m [91m        ~~[0m

[96msrc/views/OnboardingInterestsPage.tsx[0m:[93m112[0m:[93m7[0m - [91merror[0m[90m TS1109: [0mExpression expected.

[7m112[0m       </div>
[7m   [0m [91m      ~~[0m

[96msrc/views/OnboardingInterestsPage.tsx[0m:[93m113[0m:[93m5[0m - [91merror[0m[90m TS1109: [0mExpression expected.

[7m113[0m     </AppShell>
[7m   [0m [91m    ~~[0m

[96msrc/views/OnboardingInterestsPage.tsx[0m:[93m114[0m:[93m3[0m - [91merror[0m[90m TS1109: [0mExpression expected.

[7m114[0m   );
[7m   [0m [91m  ~[0m

[96msrc/views/OnboardingInterestsPage.tsx[0m:[93m115[0m:[93m1[0m - [91merror[0m[90m TS1128: [0mDeclaration or statement expected.

[7m115[0m }
[7m   [0m [91m~[0m


Found 6 errors.

[41m[30m ELIFECYCLE [39m[49m [31mCommand failed with exit code 2.[39m

backend_smoke failed:
REJECTED: command not in allowlist. Allowed: tsc, npx tsc, npx ts-fix, npx --no-install ts-fix, npx prisma, npx playwright, npm install, npm run build, npm run dev, npm run test, npm run lint, npm install &&, npm add, pnpm install, pnpm run build, pnpm run dev, pnpm run test, pnpm run e2e, pnpm run lint, npm run e2e, yarn run e2e, pnpm exec playwright, pnpm install &&, pnpm add, pnpm approve-builds, yarn install, yarn run build, yarn run dev, yarn run test, yarn run lint, yarn install &&, yarn add, ls, cat, head, tail, find, wc, node -e, git init, git add, git commit, git status, git log, git rev-parse

Backend route registration gate failed:

## Unregistered backend module

## Task Outcome
- Completed: 33
- Completed with warnings: 0
- Failed: 0
- Unknown: 0

## Scoring Notes
- Run status is fail.
- Integration verification still has blocking errors.
- Context truncation happened 3 time(s).
- Task plan/file-plan mismatches happened 8 time(s).

## Model Usage
- `openai/gpt-5.3-codex-20260224`: calls=182, cost=$13.0543, tokens=5221226, stages=worker_codegen:Architect, worker_codefix:Architect, worker_codegen:Test Engineer, worker_codegen:Backend Dev, worker_codefix:Test Engineer, worker_codefix:Backend Dev, phase_verify_fix, extract_real_contracts, worker_codegen:Frontend Dev, worker_codefix:Frontend Dev, integration_verify_fix, worker_codegen:Audit Backfill (backend), worker_codegen:Audit Backfill (frontend)
- `qwen/qwen3.6-plus-04-02`: calls=2, cost=$0.0613, tokens=82042, stages=phase_verify_fix, worker_codegen:Audit Backfill (backend)
- `deepseek/deepseek-v3.2-20251201`: calls=2, cost=$0.0000, tokens=48708, stages=generate_api_contracts, worker_codegen:Audit Backfill (backend)

## Stage Diagnostics
- `architect-triage`: duration=0s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `worker_codegen`: duration=106m 7s, calls=105, tokens=4276796 (prompt=3966581, completion=310215), cost=$10.9085, score=100/100 (A), models=openai/gpt-5.3-codex-20260224, qwen/qwen3.6-plus-04-02, deepseek/deepseek-v3.2-20251201
  labels=Architect, Test Engineer, Backend Dev, Frontend Dev, Audit Backfill (backend), Audit Backfill (frontend)
  notes=No strong negative signal captured.
- `task`: duration=105m 47s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `worker-verify`: duration=57m 31s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=68/100 (D), models=(none)
  notes=Task/file plan mismatches happened 8 time(s).
- `worker_codefix`: duration=57m 54s, calls=6, tokens=32478 (prompt=23809, completion=8669), cost=$0.1630, score=100/100 (A), models=openai/gpt-5.3-codex-20260224
  labels=Architect, Test Engineer, Backend Dev, Frontend Dev
  notes=No strong negative signal captured.
- `worker-context`: duration=78m 55s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=82/100 (B), models=(none)
  notes=Context was truncated 3 time(s).
- `generate_api_contracts`: duration=0s, calls=1, tokens=7612 (prompt=5954, completion=1658), cost=$0.0000, score=100/100 (A), models=deepseek/deepseek-v3.2-20251201
  notes=No strong negative signal captured.
- `preflight-convention-fix`: duration=58m 53s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `phase_verify_fix`: duration=39m 35s, calls=49, tokens=674891 (prompt=660683, completion=14208), cost=$1.3092, score=90/100 (A), models=openai/gpt-5.3-codex-20260224, qwen/qwen3.6-plus-04-02
  notes=Earlier phase verify/fix did not fully prevent later integration failures.
- `extract_real_contracts`: duration=0s, calls=1, tokens=9759 (prompt=6496, completion=3263), cost=$0.0571, score=100/100 (A), models=openai/gpt-5.3-codex-20260224
  notes=No strong negative signal captured.
- `preflight-deps`: duration=22m 48s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `preflight-contract-completeness`: duration=22m 38s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `preflight-route-audit`: duration=22m 38s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=100/100 (A), models=(none)
  notes=No strong negative signal captured.
- `integration-gate`: duration=25m 29s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=64/100 (D), models=(none)
  notes=Stagnation warnings triggered 18 time(s).
- `post-gen-audit`: duration=32m 55s, calls=0, tokens=0 (prompt=0, completion=0), cost=$0.0000, score=55/100 (F), models=(none)
  notes=61 requirement id(s) remained unresolved after audit.
- `integration_verify_fix`: duration=2m 50s, calls=24, tokens=350440 (prompt=345175, completion=5265), cost=$0.6778, score=72/100 (C), models=openai/gpt-5.3-codex-20260224
  notes=Stage ended with blocking integration errors.

## Model Effectiveness
- `openai/gpt-5.3-codex-20260224`: score=96.9/100 (A), calls=182, tokens=5221226, cost=$13.0543, stages=worker_codegen, worker_codefix, phase_verify_fix, extract_real_contracts, integration_verify_fix
  notes=Earlier phase verify/fix did not fully prevent later integration failures. | Stage ended with blocking integration errors.
- `qwen/qwen3.6-plus-04-02`: score=97/100 (A), calls=2, tokens=82042, cost=$0.0613, stages=phase_verify_fix, worker_codegen
  notes=Earlier phase verify/fix did not fully prevent later integration failures.
- `deepseek/deepseek-v3.2-20251201`: score=100/100 (A), calls=2, tokens=48708, cost=$0.0000, stages=generate_api_contracts, worker_codegen
  notes=No strong negative signal captured.

## Quality Gates
- Integration verify: FAIL
- Runtime verify: SKIPPED
- E2E verify: SKIPPED
- Feature audit: PASS

### Integration Errors
```
IntegrationVerifyFix stalled without making code changes.
No mutation for 10 consecutive iteration(s).
Dynamic stagnation threshold reached: abortAt=10, progressScore=0/6.
Last meaningful progress: iteration 14 (filesystem mutation (write_file:frontend/src/router.tsx)).
Aborting instead of spending more iterations rereading the same files.

Final scoped validation gates failed:

backend_tsc: pass

frontend_tsc failed:
src/views/OnboardingInterestsPage.tsx(85,11): error TS1128: Declaration or statement expected.
src/views/OnboardingInterestsPage.tsx(111,9): error TS1128: Declaration or statement expected.
src/views/OnboardingInterestsPage.tsx(112,7): error TS1109: Expression expected.
src/views/OnboardingInterestsPage.tsx(113,5): error TS1109: Expression expected.
src/views/OnboardingInterestsPage.tsx(114,3): error TS1109: Expression expected.
src/views/OnboardingInterestsPage.tsx(115,1): error TS1128: Declaration or statement expected.

frontend_build failed:
> frontend@0.0.0 build /Users/57block/code/AgenticBuilder/generated-code/frontend
> tsc -b && vite build

[96msrc/views/OnboardingInterestsPage.tsx[0m:[93m85[0m:[93m11[0m - [91merror[0m[90m TS1128: [0mDeclaration or statement expected.

[7m85[0m           </div>
[7m  [0m [91m          ~~[0m

[96msrc/views/OnboardingInterestsPage.tsx[0m:[93m111[0m:[93m9[0m - [91merror[0m[90m TS1128: [0mDeclaration or statement expected.

[7m111[0m         </form>
[7m   [0m [91m        ~~[0m

[96msrc/views/OnboardingInterestsPage.tsx[0m:[93m112[0m:[93m7[0m - [91merror[0m[90m TS1109: [0mExpression expected.

[7m112[0m       </div>
[7m   [0m [91m      ~~[0m

[96msrc/views/OnboardingInterestsPage.tsx[0m:[93m113[0m:[93m5[0m - [91merror[0m[90m TS1109: [0mExpression expected.

[7m113[0m     </AppShell>
[7m   [0m [91m    ~~[0m

[96msrc/views/OnboardingInterestsPage.tsx[0m:[93m114[0m:[93m3[0m - [91merror[0m[90m TS1109: [0mExpression expected.

[7m114[0m   );
[7m   [0m [91m  ~[0m

[96msrc/views/OnboardingInterestsPage.tsx[0m:[93m115[0m:[93m1[0m - [91merror[0m[90m TS1128: [0mDeclaration or statement expected.

[7m115[0m }
[7m   [0m [91m~[0m


Found 6 errors.

[41m[30m ELIFECYCLE [39m[49m [31mCommand failed with exit code 2.[39m

backend_smoke failed:
REJECTED: command not in allowlist. Allowed: tsc, npx tsc, npx ts-fix, npx --no-install ts-fix, npx prisma, npx playwright, npm install, npm run build, npm run dev, npm run test, npm run lint, npm install &&, npm add, pnpm install, pnpm run build, pnpm run dev, pnpm run test, pnpm run e2e, pnpm run lint, npm run e2e, yarn run e2e, pnpm exec playwright, pnpm install &&, pnpm add, pnpm approve-builds, yarn install, yarn run build, yarn run dev, yarn run test, yarn run lint, yarn install &&, yarn add, ls, cat, head, tail, find, wc, node -e, git init, git add, git commit, git status, git log, git rev-parse

Backend route registration gate failed:

## Unregistered backend modules
- backend/src/api/modules/scan/scan.routes.ts: exports "registerScanRoutes" but index.ts never calls it.
## API_CONTRACTS endpoints with no matching implementation
- GET /api/alerts/:id
## Implemented endpoints not declared in API_CONTRACTS (verify intent)
- POST /api/style-assessment

Contract completeness gate failed:

## Contract completeness: missing scoped-list endpoints (inferred from ORM relationships)
- GET /api/{users}/:id/{userinterests}
  reason: Model relationship User.hasMany(UserInterest) found in backend/src/models/index.ts, but parent has no flat /api list endpoint to derive the plural segment from — add the flat endpoint first, then the scoped one.
- GET /api/{users}/:id/{styleassessmentanswers}
  reason: Model relationship User.hasMany(StyleAssessmentAnswer) found in backend/src/models/index.ts, but parent has no flat /api list endpoint to derive the plural segment from — add the flat endpoint first, then the scoped one.
- GET /api/{users}/:id/{scans}
  reason: Mode
```

## Feature Audit
- All audited requirement ids are covered.

## Preflight Automation Ledger
### Convention auto-fix
- Invocations: 4 | files rewritten: 11 | unfixable conflicts: 2
  - Renamed residual file "frontend/src/context/AuthContext.tsx" → canonical "frontend/src/contexts/AuthContext.tsx".
  -   ↳ rewrote import paths in 1 file(s) to track the rename.
  - Renamed residual directory "backend/src/middlewares/" → canonical "backend/src/middleware/".
  -   ↳ rewrote import paths in 5 file(s) to track the rename.
  - Renamed residual file "frontend/src/views/NotFound.tsx" → canonical "frontend/src/views/NotFoundPage.tsx".
  -   ↳ rewrote import paths in 1 file(s) to track the rename.
  - Renamed residual directory "backend/src/middlewares/" → canonical "backend/src/middleware/".
  -   ↳ rewrote import paths in 4 file(s) to track the rename.
  - Unfixable:
    - Both "backend/src/middleware/" and "backend/src/middlewares/" exist — cannot auto-merge safely. Keep the canonical and delete or merge the residual.
    - Both "backend/src/middleware/" and "backend/src/middlewares/" exist — cannot auto-merge safely. Keep the canonical and delete or merge the residual.
### Missing-import installs
- Auto-installed 4 package(s) across 3 scope(s).
  - `backend` (exit=0): zod
  - `frontend` (exit=1): @privy-io/react-auth
  - `frontend` (exit=0): styled-components, jsdom-testing-mocks
### Route registration audit
- Preflight: HARD FAIL (unregistered=1, dangling=0, missingContracts=1, undeclaredImplemented=1)
    - unregistered: backend/src/api/modules/scanner/scanner.routes.ts: exports "registerScannerRoutes" but index.ts never calls it.
    - missing contract endpoint: GET /api/alerts/:id
- Final: HARD FAIL (unregistered=1, dangling=0, missingContracts=1, undeclaredImplemented=1)
    - unregistered: backend/src/api/modules/scan/scan.routes.ts: exports "registerScanRoutes" but index.ts never calls it.
    - missing contract endpoint: GET /api/alerts/:id
### Contract completeness audit (ORM-derived)
- Post-generate: warn (relationships=10, missingScoped=10)
    - GET /api/{users}/:id/{userinterests} — User.hasMany(UserInterest)
    - GET /api/{users}/:id/{styleassessmentanswers} — User.hasMany(StyleAssessmentAnswer)
    - GET /api/{users}/:id/{scans} — User.hasMany(Scan)
    - GET /api/{users}/:id/{feeditems} — User.hasMany(FeedItem)
    - GET /api/{users}/:id/{feedaggregationruns} — User.hasMany(FeedAggregationRun)
    - GET /api/{scans}/:id/{scanmarkets} — Scan.hasMany(ScanMarket)
    - GET /api/{cachedmarkets}/:id/{scanmarkets} — CachedMarket.hasMany(ScanMarket)
    - GET /api/{trendingtopics}/:id/{topicmarketmatchs} — TrendingTopic.hasMany(TopicMarketMatch)
- Preflight: warn (relationships=12, missingScoped=12)
    - GET /api/{users}/:id/{userinterests} — User.hasMany(UserInterest)
    - GET /api/{users}/:id/{styleassessmentanswers} — User.hasMany(StyleAssessmentAnswer)
    - GET /api/{users}/:id/{scans} — User.hasMany(Scan)
    - GET /api/{users}/:id/{feeditems} — User.hasMany(FeedItem)
    - GET /api/{users}/:id/{feedaggregationruns} — User.hasMany(FeedAggregationRun)
    - GET /api/{users}/:id/{alerts} — User.hasMany(Alert)
    - GET /api/{users}/:id/{notificationchannels} — User.hasMany(NotificationChannel)
    - GET /api/{scans}/:id/{scanmarkets} — Scan.hasMany(ScanMarket)
- Final: HARD FAIL (relationships=12, missingScoped=12)
    - GET /api/{users}/:id/{userinterests} — User.hasMany(UserInterest)
    - GET /api/{users}/:id/{styleassessmentanswers} — User.hasMany(StyleAssessmentAnswer)
    - GET /api/{users}/:id/{scans} — User.hasMany(Scan)
    - GET /api/{users}/:id/{feeditems} — User.hasMany(FeedItem)
    - GET /api/{users}/:id/{feedaggregationruns} — User.hasMany(FeedAggregationRun)
    - GET /api/{users}/:id/{alerts} — User.hasMany(Alert)
    - GET /api/{users}/:id/{notificationchannels} — User.hasMany(NotificationChannel)
    - GET /api/{scans}/:id/{scanmarkets} — Scan.hasMany(ScanMarket)

## Defect Category Summary
Each category aggregates audit results relevant to the 5 ways generated code typically fails to 'just run'.

| Category | State | Evidence |
| --- | --- | --- |
| Dependency sync | ⚠️ WARN | Auto-installed 4 missing package(s) during preflight across 3 scope(s). |
| Directory / implementation dedup | ⚠️ WARN | Convention auto-fix rewrote 11 file(s) across 4 invocation(s).<br/>2 conflict(s) could not be auto-merged (both canonical and residual paths existed). |
| Env variable alignment | ✅ PASS | No env alignment signal — generator injected DATABASE_URL defaults and no gate flagged env drift. |
| API contract consistency | ❌ FAIL | Preflight: 1 unregistered module(s), 1 missing contract endpoint(s), 0 dangling registration import(s).<br/>Final gate: 1 unregistered, 1 missing contract, 0 dangling (HARD FAIL). |
| API contract completeness (ORM-derived) | ❌ FAIL | Post-generate: 10 ORM relationship(s), 10 scoped endpoint(s) missing.<br/>Preflight: 12 relationship(s), 12 missing.<br/>Final gate: 12 missing (HARD FAIL).<br/>  e.g. GET /api/{users}/:id/{userinterests}, GET /api/{users}/:id/{styleassessmentanswers}, GET /api/{users}/:id/{scans} |
| Build & runtime verification | ❌ FAIL | 6 TS error line(s) in integration output.<br/>Build command reported failure during integration. |

## Repair / Self-Heal Telemetry
- Total repair events: 134
- Stage `task`: 63
- Stage `integration-gate`: 28
- Stage `post-gen-audit`: 16
- Stage `worker-verify`: 8
- Stage `preflight-convention-fix`: 4
- Stage `preflight-contract-completeness`: 4
- Stage `worker-context`: 3
- Stage `architect-triage`: 2
- Stage `generate_api_contracts`: 2
- Stage `preflight-deps`: 2
- Stage `preflight-route-audit`: 2

## Recommended Improvements
- Reduce context loss: improve section selection / budget allocation so critical PRD and implementation context is not truncated.
- Tighten task-to-file planning: the worker should either write the planned files or immediately repair the missing file-plan deltas.
- Improve final integration convergence: prioritize the highest-signal failing gate first and keep stagnation detection enabled to avoid read-only loops.
- Optimize model spend: reduce repeated high-cost iterations by improving preflight checks, duplicate-file cleanup, and stricter early gates.
