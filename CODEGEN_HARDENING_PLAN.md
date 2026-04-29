# Codegen Hardening Plan

> Post-mortem of the 2026-04-27/28 manual repair round on `generated-code/`,
> turned into a concrete plan for upgrading the codegen pipeline so the
> next run produces these fixes automatically.

本文档目标：把上一轮我们手工在 `generated-code/` 里修复的所有问题（约 24 个，第 1–6 节）+ codegen 流程**自身**在 session `52851b86` 里卡死/熔断的 4 个根因（第 7 节），按"**应该在哪一层修复 → 用什么形式注入 → 如何验收**"重新拆解并固化进 codegen，避免下一轮还要重复同样的人工修补，也避免 pipeline 永远到不了能给项目正确打分的阶段。

---

## 0. 阅读指引

- 第 1 节：**Bug Inventory** —— 上轮修复清单 + 分类。读这一节就能复盘这次都踩了什么坑。
- 第 2 节：**改造原则** —— 4 条贯穿全文的硬约束。
- 第 3 节：**五层落点（Layered Injection Map）** —— 决定"这条规则该写到哪个文件 / 哪个 prompt"。
- 第 4 节：**具体规则改造表** —— 每个 bug 一行，给出落点、prompt 草案、验收标准。**这是 owner 真正要改的清单。**
- 第 5 节：**落地任务拆分** —— 按物理文件列出要 patch 的位置 + 顺序。
- 第 6 节：**度量与回归** —— 验证下一次 run 真的把这些坑解决了。
- 第 7 节：**Pipeline-stage failure modes** —— 来自 `52851b86` session 的复盘，专门处理"产物质量没问题，但 codegen pipeline 自己卡住"的失败模式（contract 撒 CRUD、修复 worker 无授权、单 gate 熔断、stagnation 兜底）。**优先级最高，先修这一节里的 16/17/18 项。**

---

## 1. Bug Inventory（上一轮全部人工修复）

按"根因类别"归并，便于下一节给同一类问题套同一个落点策略。

### A. 外部依赖被默认假定可用

| # | 现象 | 根因 | 临时修复 |
|---|------|------|----------|
| A1 | `/api/users/me/interests` 永远 pending | `triggerFeedReaggregation` 走 BullMQ/Redis，本地没 Redis 就阻塞 | `users.service.ts` + `queue.ts` + `feedAggregationWorker.ts` 全部改成 in-process |
| A2 | `feed-aggregation.log` 没生成 | `startFeedWorker()` 没在 `server.ts` 启动时调用，in-proc 处理器从未注册 | `server.ts` 加 `await startFeedWorker()` |
| A3 | `Step 3 NO_SOURCES` 直接抛错 | HN/Google News 任一返回 0 就 throw，把整个聚合标 failed | 改成 `completeEmptyFeedRun`（empty + completed） |
| A4 | `/api/feed/refresh` 返回 `ALREADY_RUNNING` | 上一次 run 留了 `running` 的 DB 记录 | `clearActiveRunsForUser` 在每次 refresh 前置位 failed |
| A5 | LLM 调用全是 OpenAI key | 生成代码硬编码 `OPENAI_*`，无视用户提供的 Gemini 配置 | `llmService.ts` / `marketScanner.ts` / `externalApis.ts` / `.env` 全替换成 Gemini |
| A6 | feed pipeline 卡住没有日志 | 关键阶段没有结构化日志 | 新增 `logFeedAgg` + 文件落盘 |

### B. 身份 / 主键映射错乱

| # | 现象 | 根因 | 临时修复 |
|---|------|------|----------|
| B1 | `/api/feed?...` `invalid input syntax for type uuid: "did:privy:..."` | `feed.controller.ts` 把 Privy DID 当 DB UUID 直接塞进 `where: { user_id }` | `getUserId(ctx)` 改成先 `User.findOne({ privy_id })` 拿到 DB UUID |
| B2 | `/api/users/me` 500 | `users.service.ts` `findByPk(ctx.state.user.id)` 用 Privy DID 当主键 | 全部改 `findOne({ where: { privy_id } })` |
| B3 | DB schema `column "privy_id" of relation "users" contains null values` | 模型 `privy_id` `allowNull: false` 但旧数据没回填 | 重建 `tasks_dev` |

### C. 后台任务生命周期不完整

| # | 现象 | 根因 | 临时修复 |
|---|------|------|----------|
| C1 | `/api/feed/stream?run_id=inproc:...` `invalid input syntax for type uuid` | `inproc:` 形式的 run_id 被直接喂给 `findByPk` | 双格式：`isUuid` 才查库；`inproc:` 走内存事件流 |
| C2 | run_id 在 enqueue / worker / SSE 之间不一致 | 各处自己 `randomUUID()` | `runInProcessJob(payload, runId?)` 加显式参数贯穿 |
| C3 | 一旦 worker crash 就永远 `running` | 没有 `clearActiveRunsForUser` / 启动时清理 | 见 A4 |

### D. 前端框架级隐式约束被触犯

| # | 现象 | 根因 | 临时修复 |
|---|------|------|----------|
| D1 | `useSyncExternalStore should cache snapshot — Maximum update depth exceeded` | `getSnapshot` 每次返回新对象 | 引入 `cachedSnapshot`，仅在 `setStore` 时重建 |
| D2 | `useBlocker must be used within a data router` | 项目用 `BrowserRouter`，但生成代码用了 `useBlocker` | 改成 `useState + requestNavigation` 自实现 |
| D3 | `/feed → /onboarding/style` 死循环 | `AuthGuard` 没看 `hasCompletedOnboarding`；`OnboardingInterestsPage` 也会再跳 style | `AuthGuard` 双向判断；`hasCompletedOnboarding` 由后端 `style_tag` 派生，不再信 localStorage |
| D4 | LoginModal 是 email+password 假表单 | 脚手架放了 stub，PRD 是 Privy OAuth | `LoginModal` 改 `usePrivy().login()`；`PrivyProvider` 接真 SDK |

### E. 脚手架硬编码 / 不可拆装

| # | 现象 | 根因 | 临时修复 |
|---|------|------|----------|
| E1 | 即使 PRD 不要 OAuth，脚手架也带 Privy backend client | `scaffolds/m-tier/backend/src/privy/*` 默认存在 | 用户希望：**按 PRD 选项再决定要不要拷贝**这块文件 |
| E2 | OAuth 用户要被强制改 LoginModal、PrivyProvider、安装 SDK | 脚手架是占位，但 worker prompt 里没强制改写指令 | 已加 `formatResourceRequirementsPromptBlock` 的 OAuth 段，但落地不稳 |

### F. 任务拆分粒度过粗

| # | 现象 | 根因 | 临时修复 |
|---|------|------|----------|
| F1 | "Implement markets scanner pipeline and APIs" 单任务 6 轮读完没写代码 | 任务包含 3 个外部 API（HyperLiquid + Polymarket + Deribit）+ pipeline + scoring + endpoints | task-breakdown-agent 加 `## CRITICAL: External API pipeline must be split` |
| F2 | OAuth 集成被塞进通用前端任务 | 没有为 auth provider 设独立子任务 | 加 `## CRITICAL: OAuth integration is NOT optional scaffold furniture` |

### G. 报告 / 评分体系噪音

| # | 现象 | 根因 | 临时修复 |
|---|------|------|----------|
| G1 | Audit gate 因 33 个 `IC-xx` 失败 | IC-xx 是 PRD 隐式约束，本来 E2E 阶段才验，但被 hard fail | reclassify 为 soft warning |
| G2 | 报告条目重复 / 扣分逻辑不透明 / 没历史 | 报告生成器没 dedup + 没记录扣分 reasoning + 没 history | 修了 reporter + 增加 history 页 |

---

## 2. 改造原则（4 条 cross-cutting principles）

> **每一条 codegen 规则都必须能映射到下面 4 条之一；映射不上的规则不写。**

### P1. PRD-driven scaffold —— 脚手架只放"通用骨架 + 可拆模块"，特性按 PRD 选装

- **不再硬编码** Privy / Clerk / Stripe / Resend 等 provider 文件到脚手架根目录。
- 把这些文件迁到 `scaffolds/m-tier/_optional/<feature>/` 形式（如 `_optional/auth-privy/`、`_optional/auth-clerk/`、`_optional/payment-stripe/`），由 `copyScaffold()` **根据 `ResourceRequirement[]` 决定是否一并拷贝**。
- PRD 没声明 `VITE_PRIVY_APP_ID` 时，脚手架只给 username/password 的本地 auth（已是默认 `LoginModal.tsx` 形态）；声明了则把 `_optional/auth-privy/*` 合入。

### P2. Runtime-reliable defaults —— 默认外部依赖不可用

- 一切外部服务（Redis、第三方 LLM、第三方数据源、SMTP）默认 **fall back to in-process / no-op + 结构化日志**，不让缺失依赖导致请求 hang。
- 所有 LLM / HTTP fetch **必须有 timeout**（默认 15s）+ 一次重试 + 失败 graceful。
- 所有 fan-out（HN/Google/Jina）允许 **partial failure**：1 个源 0 结果 != 整个 pipeline 失败。

### P3. Backend is the source of truth —— 身份 / 状态 / lifecycle 都以后端为准

- 外部 OAuth 的 user-id（如 Privy DID）**永远不是** DB 主键。访问 DB **必须**走 `findOne({ where: { privy_id } })`。
- 前端 `hasCompletedOnboarding` / `isAuthenticated` **必须由 `/api/users/me` 派生**，不信 localStorage。
- 后台任务 `run_id` 由发起方分配并贯穿 enqueue → worker → SSE → DB；**不允许** worker 自己 `randomUUID()` 覆盖。

### P4. Implicit framework constraints must be made explicit

- 像 `useSyncExternalStore` 缓存 snapshot、`useBlocker` 仅 data router、Sequelize `declare` 字段等"框架隐式契约"，**模型不会自动遵守**，必须以 _hard rule_ 列在 worker system prompt 的 **Framework Pitfalls** 区块。
- 同时配 **Post-gen Static Audit** 兜底（grep / AST 检查），漏写 → fail soft-heal → 重写。

### P5. Pipeline must converge on real PRD usage, not on speculative scaffolds

- 唯一的 ground truth 是 **PRD**。派生方向永远是 `PRD → API_CONTRACTS.json → {frontend, backend}`，不是反向。
- 任何"对账规则"（API contracts、ORM 关系、E2E coverage、route audit）：
  - **左手边（应该有什么）** 一定从 PRD 派生 —— 不能用"对每个 ORM model 撒一套 CRUD"这种 scaffold 思维。
  - **右手边（实际有什么）** 从前端调用 + 后端实现一起对账。前端**必须**遵循 contract；前端没调到 contract 里的某条不代表"contract 多写了"，要先看 PRD 是不是要求过（见 7.2 的四象限决策树）。
- 一个 gate FAIL **不能直接终结**所有后续 gate；可以"降级 + 标红"继续到 runtime/E2E，让用户看到完整的 readiness 视图（参考第 7 节）。

---

## 3. 五层落点（Layered Injection Map）

每条规则都要回答：「在哪一层注入？」 —— 选错层 = 模型大概率忽视。

| 层 | 物理位置 | 注入形式 | 适合放什么 |
|----|----------|----------|-----------|
| **L0 Scaffold (static)** | `scaffolds/<tier>/{frontend,backend}/**` | 真实文件 | 通用骨架（路由注册器、API client、Sequelize 模型基类、`useAuth` 基础形态） |
| **L1 Conditional Scaffold** | `scaffolds/<tier>/_optional/<feature>/**` + `copyScaffold()` | 按 `ResourceRequirement` 条件拷贝 | OAuth provider、payment provider、analytics SDK 等"PRD 选装件" |
| **L2 Kickoff Prompts** | `src/lib/agents/kickoff/{task-breakdown,resource-detector}-agent.ts` | 系统提示 + few-shot | 任务拆分粒度规则、外部 API pipeline 必须切分、OAuth 必须独立任务等 |
| **L3 Worker System Prompts** | `src/lib/langgraph/agent-subgraph.ts` 里的 `ROLE_PROMPTS` + `formatResourceRequirementsPromptBlock`（`src/app/api/agents/coding/route.ts`） | 写进每次 worker 调用的 system message | 框架陷阱清单、身份映射规则、empty-result 处理、SSE/inproc 双格式 run_id |
| **L4 Post-gen Static Audit** | `src/lib/pipeline/self-heal/feature-checklist-audit.ts` 旁新增 `runtime-integration-audit.ts` | 生成完后 grep / AST / 文件存在性检查；不通过则进入 self-heal repair dispatch | "OPENAI_API_KEY 但没配置"、`useBlocker` 误用、`ctx.state.user.id` 直接当 UUID 等可机器检测的 anti-pattern |

> **决策准则**：
> - 能写在文件里的（脚手架代码、配置）→ 优先 L0 / L1。
> - 涉及 _哪个任务做哪个事_ → L2。
> - 涉及 _写代码时不要这么写_ → L3。
> - L3 没法 100% 防住的（模型偶发遗忘） → L4 兜底。
>
> **永远不要只放 L3**，因为 prompt 是 best-effort；关键约束都要 **L3 + L4 双保险**。

---

## 4. 具体规则改造表

> 每行格式：**Bug → 落点 (L?) → 注入形式 → Prompt/代码草案 → 验收**

### 4.1 Privy / OAuth 集成（E1, E2, D4）

**问题**：脚手架硬塞 Privy backend client；不用 OAuth 的 PRD 也带；用 OAuth 的又靠 worker 把 stub 改写成真实 SDK，但落地不稳。

**改造**：
- **L0 → L1 迁移**：把 `scaffolds/m-tier/backend/src/privy/` 整个移到 `scaffolds/m-tier/_optional/auth-privy/backend/src/privy/`，`scaffolds/m-tier/frontend/src/components/auth/PrivyProvider.tsx`（如有）、依赖也类似处理。
- 建立 `_optional/<feature>` → 触发 envKey 的 manifest，例如：
  ```jsonc
  // scaffolds/m-tier/_optional/manifest.json
  {
    "auth-privy":  { "triggerEnvKeys": ["VITE_PRIVY_APP_ID", "NEXT_PUBLIC_PRIVY_APP_ID"], "extraDeps": { "frontend": ["@privy-io/react-auth"], "backend": ["@privy-io/server-auth"] } },
    "auth-clerk":  { "triggerEnvKeys": ["VITE_CLERK_PUBLISHABLE_KEY"], "extraDeps": { "frontend": ["@clerk/clerk-react"], "backend": ["@clerk/backend"] } },
    "payment-stripe": { "triggerEnvKeys": ["STRIPE_SECRET_KEY"], "extraDeps": { "backend": ["stripe"] } }
  }
  ```
- **`copyScaffold()`** 增加第二阶段：`copyOptionalScaffolds(tier, outputDir, resourceRequirements)`，遍历 manifest，命中 envKey（不论 value 是否为空，只看声明）就把 `_optional/<feat>/**` 合并到 outputDir，并 patch 对应 `package.json` `dependencies`。
- **L0 默认 LoginModal**：保留现在的 `email + password` 形态作为 _no-OAuth_ 默认值。
- **L3 worker prompt**：`formatResourceRequirementsPromptBlock` 已经有 OAuth 段，**保留**，但不再要求 worker "把 stub 改成真 SDK" —— 因为 L1 已经把 SDK 文件直接拷进来了，worker 只需要按已存在的 PrivyProvider 接线（更不容易出错）。
- **L4 audit**：检测"声明了 `VITE_PRIVY_APP_ID` 但 `LoginModal.tsx` 仍然只 import antd Form" → 视为不合格，触发 frontend repair。

**验收**：
1. PRD 没声明 OAuth → 输出代码里 **无** `@privy-io/*` 依赖、**无** `privy/` 目录、`LoginModal` 是 email+password。
2. PRD 声明 `VITE_PRIVY_APP_ID` → 自动 `pnpm i @privy-io/react-auth`、有 `PrivyProvider.tsx`、`LoginModal` 调 `usePrivy().login()`。

---

### 4.2 `useSyncExternalStore` 必须缓存 snapshot（D1）

**改造**：

- **L3** —— 在 `ROLE_PROMPTS.frontend` 里加一节 **`Framework pitfalls (must follow exactly)`**：

  ```text
  **Framework pitfalls (must follow exactly):**
  - When implementing a custom store consumed via `useSyncExternalStore`,
    cache the snapshot object: `getSnapshot()` MUST return the SAME reference
    until state actually changes. Build a `cachedSnapshot` inside the setter
    and return it from `getSnapshot`. Returning a fresh object each call
    triggers "Maximum update depth exceeded".
  - `useBlocker` from react-router-dom only works with a data router
    (`createBrowserRouter`). If the project uses `<BrowserRouter>` (check
    `main.tsx` first), implement unsaved-changes blocking with local state
    (`pendingNavigation` + `requestNavigation` callback) — NEVER import
    `useBlocker` in a non-data-router project.
  - Sequelize Model class fields MUST use `declare` keyword
    (`declare id: string;`) — otherwise the public class field shadows the
    Sequelize accessor and reads return undefined.
  - When a project relies on `<BrowserRouter>` and the router file uses
    `<Routes>`, never call data-router-only hooks (`useBlocker`, `useLoaderData`,
    `useActionData`).
  ```

- **L4** —— 新增 `runtime-integration-audit.ts`，扫描所有 `frontend/src/**/*.{ts,tsx}`：
  - 含 `useSyncExternalStore(` 的文件，必须同时含 `cachedSnapshot` 或 `let snapshot:` 缓存模式 → 否则 fail。
  - 含 `useBlocker(` 的文件，必须同 repo 有 `createBrowserRouter` → 否则 fail（暗示用了 `BrowserRouter`）。

**验收**：
- 生成 store 后 dev server 启动无 "Maximum update depth exceeded"。
- audit 误报为 0。

---

### 4.3 OAuth user-id ≠ DB primary key（B1, B2）

**改造**：

- **L3 backend prompt** 加：

  ```text
  **External identity vs database primary key (HARD RULE):**
  - When auth provider issues an external user-id (Privy DID, Clerk userId,
    Auth0 sub) the database User row stores it as a SEPARATE column
    (typically `privy_id` / `clerk_id` / `external_id`). The DB primary key
    is an internal UUID.
  - In every controller / service that consumes `ctx.state.user.id`
    (or its framework equivalent), assume that value is the EXTERNAL id.
    Resolve to the DB row first:
      const user = await User.findOne({ where: { privy_id: ctx.state.user.id } });
      if (!user) ctx.throw(404, "User not found");
      // use `user.id` (UUID) for any FK queries from this point on.
  - Never pass the external id directly into Sequelize / Prisma queries
    that expect a UUID FK — Postgres will throw `invalid input syntax for type uuid`.
  ```

- **L4 audit** 检测 `backend/src/api/**/*.ts` 中以下模式直接出现：
  - `findByPk(ctx.state.user.id)` → fail
  - `where: { user_id: ctx.state.user.id }` → fail
  - 必须先看到 `findOne({ where: { privy_id` 或类似的解析步骤再使用 `.id`。

**验收**：随机抽 5 个 service / controller，全部呈现"先解析后查"的模式。

---

### 4.4 后台任务 lifecycle（A1, A2, C1, C2, A4）

**改造**：

- **L2 task-breakdown** 已加 "External API pipeline must be split" 规则；现在追加一条 **"Background job task must include lifecycle"**：

  ```text
  ## CRITICAL: Background-job task must include lifecycle endpoints

  Whenever a feature is implemented as a background job (queue, scheduler,
  worker), the SAME task description MUST include ALL of the following
  deliverables (do NOT split them across tasks — they are tightly coupled):

  - explicit `run_id` produced by the enqueue function and threaded
    through worker → DB row → SSE / polling endpoint;
  - in-process fallback that runs synchronously when the queue backend
    (Redis/BullMQ) is unavailable, with no extra config required;
  - a "clear stale runs" helper invoked by the public refresh endpoint
    BEFORE starting a new run, so a crashed previous run never blocks the user;
  - structured file logging at every step (start, external-call, success,
    fail, complete) at `<backend>/logs/<feature>.log`;
  - SSE / status endpoint MUST accept BOTH UUID run-ids (DB-backed) and
    `inproc:<scope>:<ts>` run-ids (memory-backed) without 5xx.
  ```

- **L3 backend prompt** 增加 `Background jobs` 节：

  ```text
  **Background jobs (queue / worker / SSE):**
  - The `run_id` is created by the enqueue function and passed all the way
    through. Never let the worker call `randomUUID()` to overwrite it.
  - Default queue impl is in-process (Promise-based). BullMQ / Redis is
    OPT-IN behind an env flag (`USE_REDIS_QUEUE=1`). When the flag is off,
    `enqueueXxx` MUST resolve immediately and run the job in the next tick.
  - Every public refresh endpoint must call `clearActiveRunsForUser` first.
  - Status / stream endpoints must distinguish UUID run-ids
    (`isUuid(runId)` → query DB) from `inproc:` run-ids (subscribe to the
    in-memory event emitter directly, do NOT touch DB).
  - Worker registration: any module exporting a `startXxxWorker()` MUST be
    awaited inside `server.ts` before `app.listen()`.
  - All HTTP fetches inside the pipeline use `withTimeout(15_000)` and one
    retry; per-step structured logging is mandatory.
  ```

- **L4 audit**：
  - 任何 `runInProcessJob` / `enqueueXxx` 在 `users.service.ts` 里 `await` 时不带 timeout 的 → fail。
  - 任何 `findByPk(runId)` 前没有 `if (!isUuid(runId))` 早返 → fail。
  - `server.ts` 没看到 `startFeedWorker()` / `startXxxWorker()` 调用，但 `workers/` 目录下有 export → fail。

**验收**：
- 没装 Redis 也能跑 `/api/feed/refresh` 完整 pipeline。
- `/api/feed/refresh` 重复点击不卡住。
- `feed-aggregation.log` 有结构化日志。

---

### 4.5 LLM provider 可配置 + 不写死 OpenAI（A5）

**改造**：

- **L1 资源声明**：把 `LLM_PROVIDER`（"openai" | "gemini" | ...）+ provider 对应 `*_API_KEY` / `*_BASE_URL` / `*_MODEL` 列入 `resource-requirements.json` 默认必声明项。Resource Detector Agent 看到 PRD 提"AI assist / LLM ranking / GPT" 就生成这组。
- **L3** 在 backend prompt 中：

  ```text
  **LLM client (HARD RULE):**
  - Read provider name from `process.env.LLM_PROVIDER` (default "gemini").
  - The actual key / base / model are namespaced by provider:
      LLM_API_KEY            (or {PROVIDER}_API_KEY)
      LLM_BASE_URL           (or {PROVIDER}_BASE_URL)
      LLM_MODEL              (or {PROVIDER}_MODEL)
  - Never hardcode `https://api.openai.com` or `gpt-4o` strings.
    Always read from env. Implement provider switching in ONE module
    (`backend/src/services/llmClient.ts`); other services call into it.
  - Cost-tracking constants live in env (`LLM_INPUT_COST_PER_1M`,
    `LLM_OUTPUT_COST_PER_1M`) — default 0 if absent.
  ```

- **L4 audit**：grep `OPENAI_API_KEY` / `gpt-4o` / `api.openai.com` 出现位置 > 1（即不只在 `llmClient.ts`） → fail。

**验收**：单一 `llmClient.ts` 里读 env，其它服务都通过它；Gemini / OpenAI / Claude 切换只改 `.env`。

---

### 4.6 前端 auth state 以后端为准（D3）

**改造**：

- **L3 frontend prompt** 加：

  ```text
  **Auth state derivation:**
  - The single source of truth for `isAuthenticated` is the JWT token in
    storage AND a successful `/api/users/me` round-trip. `useAuth.login()`
    must accept the canonical `(token, user)` from the backend response,
    not just `(email, password)`.
  - `hasCompletedOnboarding` MUST be derived from a backend field
    (e.g. `user.style_tag` truthy) returned by `/api/users/me` — never
    from a separate localStorage flag that the user can stale-out.
  - `AuthGuard` rules:
      not authenticated                          → redirect to login
      authenticated & onboardingRoute & DONE      → redirect to home
      authenticated & non-onboarding & NOT DONE   → redirect to onboarding
      authenticated & non-onboarding & DONE       → render children
    Implement BOTH directions; missing the "DONE → leave onboarding"
    branch causes redirect loops.
  - On initial mount, `useAuth` must refetch `/api/users/me` and
    re-derive `hasCompletedOnboarding`; do not trust localStorage.
  ```

- **L4 audit**：扫描 `AuthGuard.tsx` —— 必须同时出现两个分支，否则 fail；扫描 `useAuth` —— 必须有 `getSnapshot` 缓存（见 4.2）。

**验收**：登录-引导-退出-再登录的流程不出现 redirect loop。

---

### 4.7 空结果不应该等于错误（A3）

**改造**：

- **L3 backend prompt**：

  ```text
  **Empty results vs failure:**
  - In any aggregation / fan-out pipeline, distinguish "all upstream sources
    returned 0 items" (= empty success) from "one or more sources errored"
    (= partial fail) from "every source errored" (= fail).
  - Empty success path: persist `status='completed'`, `item_count=0`,
    clear caller-scoped stale items, emit `complete` SSE event with
    `{empty:true}`. Never throw.
  - Surface partial errors as warnings in the run record but still
    complete with whatever items did come back.
  ```

- **L4 audit**：`feedAggregator` / `marketScanner` / 其他类似 pipeline 函数源码里出现 `throw new Error("NO_SOURCES")` 或类似字符串 → fail（要求改成 `completeEmptyRun`）。

---

### 4.8 任务拆分（F1, F2）

**已存在**：`task-breakdown-agent.ts` 的 `## CRITICAL: External API pipeline must be split` + `## CRITICAL: OAuth integration is NOT optional scaffold furniture`。

**追加**：把 4.4 中的 **"Background-job task must include lifecycle"** 加到同一个 `## CRITICAL` 节队列。

---

### 4.9 报告 / 评分（G1, G2）

**改造**：
- **L4** `feature-checklist-audit.ts` 已经把 IC-xx 降级为 soft warning —— 保留。
- 新增 `coding-session-report.ts` 检查：
  - 同一条 finding 出现 ≥2 次 → dedup。
  - 每条扣分都需要一条 `reason` 字段。
  - history 写入 `report-history/<ts>.<sessionId>.md` —— 已实现，保留。

---

### 4.10 Scaffold conditional copy 实现细节（落地 4.1 / 4.5 必备）

**新增文件**：`src/lib/pipeline/scaffold-optional.ts`

```ts
// New module — outline only
export interface OptionalScaffold {
  name: string;
  triggerEnvKeys: string[];
  extraDeps?: { frontend?: string[]; backend?: string[] };
}

export async function copyOptionalScaffolds(
  tier: ScaffoldTier,
  outputDir: string,
  reqs: ResourceRequirement[],
): Promise<{ applied: string[] }>
```

逻辑：
1. 读 `scaffolds/<tier>/_optional/manifest.json`。
2. 对每个 entry，若 `reqs.some(r => triggerEnvKeys.includes(r.envKey))` → 拷 `_optional/<name>/**` 进 outputDir，patch `frontend/package.json` & `backend/package.json` 的 dependencies。
3. 在 `coding-orchestrator` 的"准备阶段"调用，且**在** `task-breakdown` 之前，使后续 worker 看到的就是已经选装好的脚手架。

---

## 5. 落地任务拆分（按文件）

按依赖顺序排，便于一次性 PR：

| # | 状态 | 路径 | 操作 | 来源 |
|---|------|------|------|------|
| 1 | ✅ | `scaffolds/m-tier/_optional/manifest.json` | **新建** | 4.1, 4.10 |
| 2 | ✅ | `scaffolds/m-tier/_optional/auth-privy/{backend,frontend}/**` | 从现脚手架挪过来 | 4.1 |
| 3 | ✅ | `scaffolds/m-tier/backend/src/privy/` | **删除（迁走）** | 4.1 |
| 4 | ✅ | `scaffolds/m-tier/frontend/src/components/auth/PrivyProvider.tsx`（若存在） | **删除（迁走）** | 4.1 |
| 5 | ✅ | `src/lib/pipeline/scaffold-optional.ts` | **新建** | 4.10 |
| 6 | ✅ | `src/lib/pipeline/scaffold-copy.ts` | 在 `copyScaffold` 后追加 `copyOptionalScaffolds(...)` 调用 | 4.10 |
| 7 | ✅ | `src/lib/pipeline/coding-orchestrator.ts`（或 `kickoff-task-breakdown.server.ts`） | 接 `copyOptionalScaffolds` 的返回，把 `applied` feature 名注入 task-breakdown context | 4.10 |
| 8 | ✅ | `src/lib/agents/kickoff/task-breakdown-agent.ts` | 加 `## CRITICAL: Background-job task must include lifecycle` | 4.4, 4.8 |
| 9 | ✅ | `src/lib/langgraph/agent-subgraph.ts` `ROLE_PROMPTS.frontend` | 追加 **Framework pitfalls** + **Auth state derivation** + 移除已不再需要的 `LoginModal stub → real SDK` 段（脚手架已直接给真 SDK） | 4.2, 4.6, 4.1 |
| 10 | ✅ | `src/lib/langgraph/agent-subgraph.ts` `ROLE_PROMPTS.backend` | 追加 **External identity vs DB PK** + **Background jobs** + **LLM client** + **Empty results vs failure** | 4.3, 4.4, 4.5, 4.7 |
| 11 | ✅ | `src/app/api/agents/coding/route.ts` `formatResourceRequirementsPromptBlock` | 因为 4.1 把 OAuth 文件下沉到脚手架，OAuth 段从"必须改写 stub"改成"已经为你装好 SDK，按 `<PrivyProvider>` 接线即可"。**不要删，改语气**。 | 4.1 |
| 12 | ✅ | `src/lib/pipeline/self-heal/runtime-integration-audit.ts` | **新建** — 8 条 grep 规则覆盖 §4.2 / §4.3 / §4.4 / §4.5 / §4.7；按 `appliedOptionalFeatures` / `declaredEnvKeys` 条件启用；持久化 `.ralph/runtime-integration-audit.json`；smoke test `scripts/smoke-runtime-integration-audit.ts` 16/16 通过 | 全部 L4 项 |
| 13 | ✅ | `src/lib/pipeline/self-heal/index.ts` + `src/lib/langgraph/supervisor.ts` | barrel 导出 + supervisor `integrationVerifyAndFix` 在 contract-usage-coverage 之后调用 audit，把 `runtimeAuditBlock` 拼进 verify-fix worker 的 opening user message；`coding-session-report.ts` 的 Pipeline Anomalies 表新增 `runtime_integration_audit*` 三行 | 12 |
| 14 | ✅ | `src/lib/pipeline/resource-requirements.ts` | `ResourceRequirement.category` 增加 `"queue" | "logging"`，并允许 detector 输出 `LLM_PROVIDER` 这种"非 secret"声明 | 4.5 |
| 15 | ✅ | `src/lib/agents/kickoff/resource-detector-agent.ts` | 让 detector 在 PRD 提 LLM ranking 时强制声明 `LLM_PROVIDER` + `LLM_API_KEY` 这一组 | 4.5 |

> **PR 拆分（已全部落地）**：
> - PR1：1–7（脚手架重构 + 条件拷贝） ✅
> - PR2：8–11, 14–15（prompt + detector 改造） ✅
> - PR3：12–13（静态审计 + self-heal 接入） ✅

---

## 6. 度量与回归

### 6.1 一次性回归用例

固定一份"金标准 PRD"——本轮跑过的同一个 `feed-aggregator` 项目—— 重新走 kickoff + codegen，期望：

| 检查项 | 期望结果 |
|--------|---------|
| `frontend/src/hooks/useAuth.ts` | 含 `cachedSnapshot` 缓存 |
| `backend/src/api/modules/feed/feed.controller.ts` | `getUserId` 走 privy_id → DB UUID 解析 |
| `backend/src/utils/queue.ts` | `enqueueFeedAggregation` 默认 in-process，BullMQ 在 `USE_REDIS_QUEUE` flag 后 |
| `backend/src/server.ts` | `await startFeedWorker()` 调用存在 |
| `backend/src/services/feedAggregator.ts` | NO_SOURCES 不抛错，走 `completeEmptyFeedRun` |
| `backend/src/services/llmService.ts` | 无 `OPENAI_API_KEY` / `gpt-4o-mini` 字面量 |
| `frontend/src/components/auth/AuthGuard.tsx` | 含双向 redirect 分支 |
| `frontend/src/hooks/useUnsavedChanges.ts` | 无 `useBlocker` import |
| 任务列表（`TASK_BREAKDOWN.md`） | "markets scanner" 被拆 ≥3 子任务 |
| `API_CONTRACTS.json` | 每条 endpoint 含非空 `prdJustification`；`audience` 字段必填 |
| `integration_verify_fix` | 触发次数 ≤ 5；任何 `<change>contract-pruned</change>` 都伴随 PRD-grep-negative 证据 |

### 6.2 持续度量 ✅

- 每次 coding session 结束后，`runtime-integration-audit` 的失败数写进 report 顶部，作为新的"runtime readiness"信号。
- session report history compare 表新增 `Runtime` 列，连续 3 次 run 仍然 ≥1 时自动注入 ⚠️ trend alert（指向 §6.3 的下钻动作）。
- 落点：`src/lib/pipeline/coding-session-report.ts` 中的 `readRuntimeReadinessSummary` + `formatMarkdownReport` 顶部 bullet + `## Runtime Readiness` section + `formatHistoryMarkdown` compare 表。

### 6.3 何时下钻

- 某条 L3 规则"被违反"次数 ≥2 次仍然出现 → 把同一条规则升格到 L1（脚手架直接给定）或 L4（强制 audit + 重写）。
- 某条 L4 规则误报率 > 10% → 简化检测条件 + 在 prompt 中写更具体的 anti-pattern 示例。

### 6.4 验收工具：`scripts/verify-regression-checklist.ts` ✅

为了让"重跑金标准 PRD 后跑这套 §6.1 / §7.6 验收"不再依赖人肉对照，提供单文件 verifier：

```bash
pnpm exec tsx scripts/verify-regression-checklist.ts \
  --outputDir <path-to-generated-code>
```

- 静态扫描 §6.1 的 11 条产物级检查 + §7.6 的 5 条 metric gates。
- 三态输出：`✅ pass / ❌ fail / — skip(不适用)`，遇 hard fail 退出码 = 1。
- 数据来源全部是只读：`backend/src/...`、`frontend/src/...`、`API_CONTRACTS.json`、`.ralph/coding-session-report.json`。
- self-test：把它指到一个故意全坏的合成项目（`/tmp/audit-smoke`，audit smoke 用过的那个），输出 4 fail + 12 skip + RED，行为符合预期。

---

## 7. Pipeline-stage failure modes（来自 2026-04-28 session 52851b86 的复盘）

> 这一节专门处理"产物质量没问题，但 codegen pipeline 自己卡住"的失败模式。
> 上一轮 session：20/20 任务完成、feature audit PASS、ORM contract clean，
> 但 `generate_api_contracts` 撒了 45 个 PRD 根本没要求的 CRUD endpoint，
> backend dev 当然不会去实现 → integration gate FAIL → runtime/E2E 全部 SKIPPED →
> 评分 58/F，且永远跑不到能给出真实分数的阶段。这是流程问题，不是产物问题。

### 7.1 根因 A：`generate_api_contracts` 撒 CRUD（最大噪音源）

**现象**：Claude Sonnet 一次调用，把 PRD 里出现的每个 ORM 模型都翻译成
`GET / GET :id / POST / PATCH :id / DELETE :id`，再带几个嵌套关系 endpoint。
真实 PRD 只有 `/api/users/me`、`/api/feed/*` 这一小撮被 PRD 的 user flow / UX page
描述过的 endpoint —— **45 个 endpoint 里 ~38 个 PRD 根本没要求**。

**派生方向（划重点）**：

```
PRD (user flows + UX pages + admin features + integration features)
        │
        ▼
generate_api_contracts (LLM)
        │
        ▼
API_CONTRACTS.json   ← 唯一的接口契约
        │
   ┌────┴────┐
   ▼         ▼
frontend   backend
(必须依赖)  (必须实现)
```

**前端永远是 contract 的消费者，不是它的派生依据**。Contract 是从 PRD 派生的；
前端代码只是用来做 _retrospective consistency check_（见 7.2 的四象限）。

**改造（落点：L2 + L4）**：

- **L2 修改 `generate_api_contracts` 的 prompt**：
  ```text
  ## Contract scope rule (HARD RULE)

  Source of truth: the PRD. Specifically, an endpoint belongs in
  API_CONTRACTS.json ONLY if AT LEAST ONE of the following is true,
  and you can quote the PRD line that justifies it:

    (a) A "User flow" / "User journey" step in the PRD describes a user
        action that requires it (e.g. "user marks a story as read"
        → PATCH /api/feed-items/:id/read).
    (b) A "UX / Pages" section names a page or component that needs
        the data (e.g. "Onboarding Style page" → POST /api/users/me/style-assessment).
    (c) An "Admin / Integration features" section names an internal
        consumer (admin dashboard, webhook, cron). Mark these with
        "audience": "admin" so the usage audit knows to skip them.

  DO NOT default-enumerate "GET /list, GET /:id, POST, PATCH, DELETE"
  for every ORM model. The ORM model existing is NOT evidence that a
  REST endpoint is required. Most apps need <5 endpoints per model,
  many models need 0.

  For each endpoint you DO emit, attach:
    "prdJustification": "<verbatim line / section from PRD>"
    "audience": "user" | "admin"

  When in doubt: OMIT. A missing endpoint is cheap to add (frontend
  will surface it in `frontend-api-uniqueness` audit and we'll insert
  it). A surplus endpoint poisons the integration gate, makes the
  backend worker chase impossible repairs, and burns LLM budget.
  ```

- **L2 增加输入材料**：在调用 `generate_api_contracts` 前，把 PRD 的
  **"User flows"** + **"UX / Pages"** + **"Admin / Integration features"** 三段
  显式拼进 prompt context（如有缺失则 detector 阶段补齐）。
  Contract 的"右手边的依据"始终是这三段，不是 ORM models 也不是前端代码。

- **L4 新增 audit `contract-usage-coverage.ts`**（仅做 _consistency check_）：
  详见 7.2 的四象限决策树。这个 audit **不**单方面"前端没调就删"，
  而是先查 PRD justification 再决定 prune / fix-frontend / fix-backend。

**验收**：金标准 PRD 重跑，`API_CONTRACTS.json` 的每条 endpoint 都有非空
`prdJustification`；含 `prdJustification === ""` 的 endpoint 数 = 0。

### 7.2 根因 B：`integration_verify_fix` 不知道自己有没有"删 contract"的权力

**现象**：报告显示 `integration_verify_fix` 跑了 45 次、烧掉 \$1.40、4 分 12 秒，
然后 stagnation abort。worker 的两难：
- 实现 44 个 PRD 没描述的 endpoint（输出垃圾）
- 还是 shrink contract（不知道自己能不能动）

**核心思想**：contract 不是神圣的"前端必须无条件遵守"的东西 —— 它本身可能是
LLM 上一步的产物，可能错。但 contract 也不是"前端没调就该删"那么随便。
唯一的仲裁者是 **PRD**。所以 verify-fix 必须先做四象限分类，再下结论。

#### 四象限决策树（contract × frontend × PRD）

| Contract | Frontend 调 | PRD 要求 | 状态 | 处置 |
|----------|------------|---------|------|------|
| ✅ | ✅ | — | OK，一致 | 无操作 |
| ✅ | ❌ | ✅ | **Frontend 缺陷** | 派 frontend repair：补上 `apiClient.<verb>(<path>)` 调用 + UI 接线。Contract **不动**。 |
| ✅ | ❌ | ❌ | **Contract 撒了多余项**（上轮 44 个就在这里） | Prune contract，emit `<change>contract-pruned</change>`。Backend / frontend 都不动。 |
| ❌ | ✅ | ✅ | **Contract 漏写 + frontend 已先调** | 给 contract 补一行（继承调用的 verb/path/body shape），并派 backend repair 实现它。 |
| ❌ | ✅ | ❌ | **Frontend 调了野 endpoint** | 派 frontend repair：删除调用，或者用 PRD 实际允许的 endpoint 替代。 |
| ✅ | — | — (backend 没实现) | 现有 route audit 的范畴 | 派 backend repair（既有逻辑） |

判 "PRD 要求？" 的方法：
1. 把 endpoint path 拆成关键词（`/users/me/interests` → `["interests", "user"]`）。
2. grep PRD.md，命中 → 标 `prd-hit`。
3. 同时检查 contract entry 的 `prdJustification` 字段（来自 7.1）—— 非空且 PRD.md 能找到原句 → `prd-confirmed`。
4. 两者都失败 → `prd-not-required`。

#### 改造（落点：L3 worker prompt for `integration_verify_fix`）

在 `integration_verify_fix` 的 system prompt 里**显式授予权限并给出决策树**：

```text
## Integration verify repair — decision tree (HARD RULE)

The PRD is the ONLY source of truth. The contract may itself be wrong
(LLM-generated). The frontend code may be incomplete (not yet wired).
Never blindly trust either side.

For each finding from the route audit, classify into ONE of:

  case (1) missing-from-frontend-prd-required:
    contract has it ✓, frontend doesn't call it ✗, PRD requires it ✓
    → Action: write the frontend wiring (apiClient call + UI hookup).
              Do NOT modify the contract.

  case (2) contract-surplus:
    contract has it ✓, frontend doesn't call it ✗, PRD does NOT require it ✗
    → Action: REMOVE the entry from API_CONTRACTS.json. Emit one
      <change>contract-pruned: <method> <path> reason=<prd_grep_negative></change>

  case (3) contract-missing-but-used:
    contract lacks it ✗, frontend calls it ✓
    → Action: ADD the entry to API_CONTRACTS.json (verb, path, body
      schema inferred from the call site), AND implement the backend route.

  case (4) frontend-rogue-call:
    contract lacks it ✗, frontend calls it ✓, PRD does NOT require it ✗
    → Action: REMOVE the frontend call (or replace with the canonical
      contract endpoint). Do NOT add to contract.

  case (5) backend-missing-impl:
    contract has it ✓, backend does not implement it ✓ (existing audit)
    → Action: implement the backend route.

To decide "PRD requires it":
  - Read API_CONTRACTS.json's `prdJustification` field for the entry.
    If non-empty AND quote can be found verbatim in PRD.md → REQUIRED.
  - Otherwise grep PRD.md for path keywords. Hit → REQUIRED.
  - No `prdJustification` AND no PRD grep hit → NOT REQUIRED.

You ARE explicitly allowed to edit API_CONTRACTS.json (cases 2, 3).
The contract is a derived artifact, NOT an immutable spec.
You ARE explicitly allowed to delete frontend API calls (case 4).
Pick exactly ONE case per finding; never pick two; never default to
case (1) or (5) just because they involve writing more code.

When `undeclaredImplemented` lists endpoints (e.g. /api/health) —
this is the inverse of case (3): the implementation exists but contract
doesn't know about it. Add it to API_CONTRACTS.json with
`audience: "admin"` if it's clearly system-level, otherwise inspect.
```

**验收**：
- 上一轮的 44 个伪 endpoint 在第 1 次 `integration_verify_fix` 全部走 case (2) 被 prune。
- 没有任何 case (1) 或 case (5) 误派工 → 无 stagnation。
- 每一条 prune / add / impl 都对应一个 `<change>` log，便于在报告里展示。

### 7.3 根因 C：一个 gate FAIL 就熔断整条 pipeline

**现象**：integration gate FAIL → orchestrator `graph_error` → runtime-verify / E2E-verify / e2e-triage **全部 SKIPPED**。
报告里这三项都标 SKIPPED，导致：
- 用户看不到"项目其实启动得了"的信号
- 模型评分 / 模型轮换缺乏 runtime 数据
- self-heal 没机会用 runtime 错误反推 contract 错误

**改造（落点：`coding-orchestrator.ts` + `coding-session-report.ts`）**：

- **改为"降级继续"**：integration gate FAIL 时，
  - 不抛 `graph_error`，而是把 gate 状态记成 `FAILED_BUT_CONTINUED`；
  - 继续跑 runtime-verify / E2E-verify / e2e-triage；
  - 最终 status 仍然 = `FAIL`，但能给出**完整的 readiness 视图**。
- **报告里区分两种 FAIL**：
  ```
  Quality Gates:
  - Integration verify: FAIL (continued)
  - Runtime verify: PASS  ← 这条信号比 integration 假阴性宝贵得多
  - E2E verify: PARTIAL (3/8)
  ```
- **gate 之间的依赖**：只有 runtime-verify FAIL 才阻断 E2E（启动都启动不了，跑 e2e 没意义）；其它 gate **互相不应阻断**。

**验收**：上一轮 run 在新策略下，runtime / E2E 应该能跑到（前端 + 后端都能 build），分数从 58 升到 75+。

### 7.4 根因 D：stagnation abort 的兜底太被动

**现象**：worker 10 轮没 mutation 就 abort，但 abort 之后**只是抛错**，
没有"换个角度试试"的逻辑。

**改造**：

- 当 `integration_verify_fix` stagnation 触发时，**自动注入一条 fallback prompt**：
  ```text
  You stagnated. Switch strategy: do a SINGLE BATCH classification pass.

  1. Read API_CONTRACTS.json once.
  2. Read frontend/src/api/**/* once and build a Set<callSite> of all
     apiClient.<verb>(<path>) calls.
  3. Read PRD.md once.
  4. For every endpoint in contract AND every callSite in frontend,
     classify into one of cases (1)-(5) from 7.2.
  5. Output ONE updated API_CONTRACTS.json (cases 2, 3 applied) plus
     a list of `<repair-task role=frontend|backend>...</repair-task>`
     entries (cases 1, 3, 4, 5) for the orchestrator to dispatch.
  6. Then complete. DO NOT re-read files; trust your batch output.
  ```
  再给 worker 一次机会（限 2 轮），仍然失败才真正 abort。
- stagnation event 也写进 `repair-events.jsonl`，供模型评分系统识别"这是流程卡住，不是模型差"，避免错误地降权 deepseek-v4-pro。

### 7.5 落地任务追加（在第 5 节 14 行表后追加）

| # | 路径 | 操作 | 来源 |
|---|------|------|------|
| 16 | `src/lib/agents/<...>/api-contracts-agent.ts`（即 `generate_api_contracts` 调用方） | 把 7.1 的 "Contract scope rule" 加进 system prompt，并把 PRD User flows / UX 段作为强制输入 | 7.1 |
| 17 | `src/lib/pipeline/self-heal/contract-usage-coverage.ts` | **新建**，实现 7.1 的 prune/warn/fail audit | 7.1 |
| 18 | `src/lib/langgraph/agent-subgraph.ts`：定位 `integration_verify_fix` 对应的 ROLE prompt（或专门的 `verifyFix` system prompt） | 加 7.2 的 decision tree | 7.2 |
| 19 | `src/lib/pipeline/coding-orchestrator.ts` | 把 integration gate FAIL 从 `graph_error` 改成 `FAILED_BUT_CONTINUED`，让 runtime/E2E 继续跑 | 7.3 |
| 20 | `src/lib/pipeline/coding-session-report.ts` | 区分 `FAIL` vs `FAIL_CONTINUED` vs `SKIPPED`，并把 stagnation 单独显示 | 7.3, 7.4 |
| 21 | `src/lib/langgraph/agent-subgraph.ts`（stagnation handler） | 触发 7.4 的 fallback prompt 注入，再给 2 轮 | 7.4 |

> **优先级最高的是 16 + 17 + 18**：把根因 A/B 解掉，接近能让分数从 58 → 80+。
> 19/20/21 是"防御性"改造，让一个 gate 失败也不至于整盘 SKIPPED。

### 7.6 验收（特别针对本次 session）

把 `52851b86` 用过的同一份 PRD 重跑，期望：

| 指标 | 上轮实际 | 改造后期望 |
|------|---------|-----------|
| `API_CONTRACTS.json` endpoint 数 | 45 | ≤ 12 |
| `integration_verify_fix` 调用数 | 45 | ≤ 5 |
| `integration_verify_fix` cost | \$1.40 | ≤ \$0.20 |
| Runtime verify | SKIPPED | 跑到（PASS 或 FAIL，不再 SKIPPED） |
| E2E verify | SKIPPED | 跑到 |
| Session score | 58 (F) | ≥ 75 (C) |
| Total LLM cost | \$4.09 | ≤ \$2.50 |

---

## 附录 A · Privy 留在脚手架里 vs 放 _optional 的取舍

| 方案 | 优点 | 缺点 |
|------|------|------|
| **留脚手架根目录（现状）** | worker 看到的代码量更少；不用改 `copyScaffold` | 不需要 OAuth 的项目带着死代码；worker 还得"反向移除"；email+password 项目里出现 `@privy-io/server-auth` 依赖很奇怪 |
| **下沉到 `_optional/auth-privy/`，按 PRD 拷** ✅ | 干净；PRD 决定一切；worker 看到的脚手架就是最终形态；与"插件化"原则一致 | 需要新写 `copyOptionalScaffolds` + manifest；多一个抽象 |
| **完全去掉脚手架，全靠 worker 写** | 极简 | 4 月这次已经试过：worker 经常忘记装依赖、忘改 LoginModal、忘写 PrivyProvider 真实 SDK；不可靠 |

**结论**：选方案 2。Privy / Clerk / Stripe / Resend 等**都**走 `_optional/<feature>/`。

---

## 附录 B · 为什么 `useSyncExternalStore` 这种规则必须双层（L3 + L4）

模型在生成 Zustand-like store 时**完全不会主动想到** "snapshot must be cached" 这种 React 内部细节，因为：

1. 这条约束只在 React 18+ 的 `useSyncExternalStore` 调用栈中才触发；
2. React 官方文档把它放在中间章节，被训练数据弱采样；
3. 错的写法**类型上完全合法**，TypeScript 不报错，开发期自测看不出来 —— 只有真跑起来 + dev mode 才报 `Maximum update depth exceeded`。

→ 只在 prompt 里写，模型遗忘率高；必须配 L4 grep 检测 + 自动 repair task，才是闭环。

---

## 附录 C · 当前 `formatResourceRequirementsPromptBlock` 改动方向

现有版本（`src/app/api/agents/coding/route.ts:419-452`）让 worker"把 stub 改成真 SDK"，这是**因为脚手架放了个错误的 stub** 才需要的补救指令。

完成 4.1 之后，脚手架本身就是真 SDK 形态，prompt 里那段应该改成更克制的"how to wire" 提示：

```text
### Authentication integration (already scaffolded — wire it up)

The detected OAuth provider(s) have been preinstalled into the scaffold:
- the SDK package is already in `frontend/package.json`
- `frontend/src/components/auth/PrivyProvider.tsx` already mounts the real SDK
- `frontend/src/components/auth/LoginModal.tsx` already calls `usePrivy().login()`

Your job is to:
- ensure the page that renders LoginModal forwards the resulting token to
  `/api/auth/verify` and updates `useAuth.login(token, user)`;
- pull `hasCompletedOnboarding` from the backend response, not localStorage;
- never re-introduce email+password fields to LoginModal for this project.
```

—— 语气从"修复"变成"接线"，模型出错概率显著下降。

---

**Owner**：codegen 平台组

**进度**（按 Phase 标记）：

| Phase | 范围 | 状态 |
|------|------|------|
| Phase 1 | §7.5 #16 + #17 + #18（contract scope rule + usage coverage audit + verify-fix decision tree） | ✅ |
| Phase 2 | §7.5 #19 + #20 + #21（gate 降级 + 报告区分 + stagnation fallback） | ✅ |
| Phase 3 | §5 PR1（脚手架 `_optional` 重构 + 条件拷贝） | ✅ |
| Phase 4 | §5 PR2（worker prompts + detector + resource block） | ✅ |
| Phase 5 | §5 PR3（runtime-integration-audit 静态审计 + self-heal 接入 + Pipeline Anomalies 报告） | ✅ |
| Phase 6A | §6.2 持续度量上报 + §6.4 verifier 工具 | ✅ |
| Phase 6B | 跑金标准 PRD 回归 → 用 verifier 校验 §6.1 / §7.6 | ⏳ 等待操作员触发一次 codegen |

### Phase 6B handoff（operator-only step）

代码侧的 21 个 plan 项 + 度量 + 验收工具全部就绪。剩下唯一不能自动化的一步：

1. 在 UI（或 `pnpm exec tsx scripts/push-kickoff.ts`）上传同一份金标准 PRD（之前那个 feed-aggregator）触发 kickoff + codegen。
2. 等 session 跑完，产出在 `generated-code/`。
3. 运行 verifier：
   ```bash
   pnpm exec tsx scripts/verify-regression-checklist.ts --outputDir generated-code
   ```
4. 期望：所有 hard 项 ✅；§7.6 的五项数字目标（contract count ≤12 / int-fix ≤5 / runtime+E2E 不 SKIPPED / score ≥75 / cost ≤\$2.50）全部命中。
5. 任意 ❌ → 回到对应 Phase 复看（错误类别在 plan 文档里有锚点，比如 `useSyncExternalStore-cached` 失败 → §4.2 / Phase 4 + Phase 5）。

---

## 附录 D · 并行运行两个项目（双 dev server）

> 单个 dev server 不能同时跑两个 codegen session（共享 in-process queue + LLM rate-limit）。如果要并行两个独立项目，起两个完全隔离的 dev server 实例。

### 一次性配置

```bash
# 1. 在 Postgres 里建第二套库（generated 项目跑起来时不撞 schema）
psql -U postgres -c "CREATE DATABASE tasks_dev_b OWNER tasks_user;"

# 2. 复制并行环境模板
cp .env.parallel.example .env.parallel
# 默认就是 PORT=3001 / generated-code-b / tasks_dev_b，按需改
```

### 启动

两种模式可选：

**A. 浏览器模式**（轻量、调试方便）

| 终端 | 命令 | URL |
|---|---|---|
| Project A（用 `.env.local`） | `pnpm dev` | http://localhost:3000 |
| Project B（用 `.env.parallel`） | `./scripts/start-parallel-dev.sh` | http://localhost:3001 |

**B. Electron 模式**（独立窗口、更像桌面 app）

| 终端 | 命令 | 窗口 |
|---|---|---|
| Project A | `pnpm electron:dev` | "Agentic Builder"（指向 :3000） |
| Project B | `./scripts/start-parallel-dev.sh --electron` | "Agentic Builder · B"（指向 :3001） |

Electron 模式下：
- `electron/main.js` 通过 `BUILDER_DEV_URL` env 读 dev server URL，`BUILDER_INSTANCE_LABEL` env 给窗口加后缀
- B 实例用 `--user-data-dir=$HOME/.agentic-builder-electron-b` 隔离 cookies / localStorage / cache，否则 macOS Electron 会把两次启动合并成同一进程
- `concurrently --kill-others-on-fail`（不是 `--kill-others`）：正常关闭某个窗口不会误杀另一个实例的 dev server，只有崩溃才连带退

每个实例写自己 `CODE_OUTPUT_DIR` 指向的目录、用自己的 `BLUEPRINT_GENERATED_DATABASE_URL`。LLM 密钥 / `MEMORY_INJECT` 等只读配置仍共享 `.env.local`。

### 跑起 generated 应用时（两个项目都跑完之后）

`generated-code/.env`、`backend/.env`、`frontend/vite.config.ts` 里的 PORT 都不会自动错开。如果你想同时跑两个 generated app：

```bash
# Project A 用默认端口
cd generated-code && pnpm dev

# Project B 改端口（开两个终端）
cd generated-code-b/backend && PORT=4001 pnpm dev
cd generated-code-b/frontend && pnpm dev -- --port 5174
# 同时把 frontend/.env 里 VITE_API_BASE_URL（如有）改成 http://localhost:4001
```

### 注意事项

- **不要**两个 dev server 共用同一个 `CODE_OUTPUT_DIR` —— coding session 启动时会做强清理（保留 `.git/.ralph/` + 8 个 markdown，删除其它）；两个 session 同时清同一目录会互删。
- **不要**把 `.env.parallel` 提交（已加到 `.gitignore`）。
- **MEMORY 写入**有锁（`.memory/.lock-target`），两个 session 同时触发 memory 注入会自动串行等待，安全但会有额外延迟。
