# Memory System Design

> Status: **v2.0 (Phase A–C shipped)**
> Owner: vicky@57blocks.com
> Last updated: 2026-04-29
> Changelog:
> - v2.0: 全文重写以反映 Phase A–C 实际落地的代码；新增 Pattern 分类、三层注入、注入归因、UI；老的"待定问题"绝大多数已锁
> - v1.3: §4 per-record self-contained 文件布局 + metrics 分离 + git 共享策略
> - v1.2: §12.6 Phase B classification cache 的 5 个风险与设计决策
> - v1.1: §7.5 与现有打分/持久化系统的集成；§12.5 影响、风险、回滚、灰度
> - v1.0: 初稿

AgenticBuilder 的记忆系统。两层（L1 系统 / L2 项目）+ 三层注入（Active / Shadow / Deprecated）+ 自动归因 + 人工审批通道。本文档是当前**已实现**系统的事实记录，不是规划文档。

---

## 1. 目标与非目标

### 1.1 目标
- **避免重复决策**：相同 brief 不该让 classifier 跑两次。
- **避免重犯错误**：self-heal 修过的 bug，下次同类 task 应作为 prompt context 注入。
- **跨 agent / 跨 run 的上下文连续**：kickoff 续跑、多 run 之间不"失忆"。
- **跨项目的能力沉淀**：N 个项目的失败模式可在第 N+1 个项目启动时召回利用。
- **可观测、可调试、可回放**：召回、注入、归因全程可追踪。
- **人机协作的审批通道**：人类可以在 UI 上审批 mined patterns，机器通过归因自动调整 score。

### 1.2 非目标（v2 仍不做）
- 不做向量召回（FTS / 关键词 + tag 过滤足够覆盖前 200 条）。
- 不做图查询 / 知识图谱（待 L1 失败模式 >200 条后再评估迁移到 Graphiti）。
- 不做云端同步 / 多用户共享（本地单机，git 同步）。
- 不做记忆的"语义合并"（同主题多条手动整理，不自动合并）。
- 不做 LLM-based 实时 distiller（rule-based mining + 人工审 + outcome attribution 已能覆盖；LLM distill 留 Phase D）。

---

## 2. 顶层架构

```
┌────────────────────────────────────────────────────────────────────┐
│  L1: System Memory                                                 │
│  Location: <repo>/.memory/                                         │
│  Scope:    跨所有 generated 项目                                    │
│  Kinds:    classification, failure-pattern, scaffold-fitness,      │
│            agent-tuning, model-routing                             │
│  Producers: classifier (cache), miner (rule-based), human (UI)     │
└────────────────────────────────────────────────────────────────────┘
        ▲ recall + inject (Layer 2)         │ outcome attribution
        │                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│  L2: Project Memory                                                │
│  Location: <generated-project>/.memory/                            │
│  Scope:    单个 generated 项目                                       │
│  Kinds:    project-card, task-history, self-heal-log, decision,    │
│            handoff-note, codebase-map, qa-verdict                  │
│  Producers: PipelineEngine event-bridge, RepairEmitter sink        │
└────────────────────────────────────────────────────────────────────┘
                            ▲
                            │ writes during kickoff
              ┌─────────────────────────────┐
              │  MemoryStore (interface)    │
              │  ───────────────────────────│
              │  FileStore (per-record)     │  ← v2 实际实现
              │  GraphitiStore (future)     │
              └─────────────────────────────┘
```

### 三层注入架构（runtime 决定 LLM 是否真看到记忆）

每条 pattern 有 `metrics.score ∈ [-1, 1]`：

| Score | Layer | 行为 |
|---|---|---|
| `score >= 0.3` | **Active (Layer 2)** | 真注入到 system prompt 的 `<memory-context>` 块 |
| `0 <= score < 0.3` | **Shadow (Layer 3)** | 召回时仅写入 `trace.jsonl`，不动 prompt |
| `score < 0` | **Deprecated** | 召回时直接跳过；不 trace、不注入 |

**手动审批通道**（绕过 score）：tag 含 `manual:approved` → 强制 active，且**永久免疫归因调分**（score 仍记录，但不被自动改）。

---

## 3. 数据模型

### 3.1 MemoryRecord（共享 shape）

```ts
type MemoryKind =
  // L1
  | "classification"      // brief → ProjectClassification 缓存（Phase B）
  | "failure-pattern"     // 失败模式 / 经验性记忆（Phase C）
  | "scaffold-fitness"    // scaffold 选择的统计成功率（未实装）
  | "agent-tuning"        // 某 agent 的 prompt 改进点（未实装）
  | "model-routing"       // 跨项目聚合的 model 适配度（未实装）
  // L2
  | "project-card"        // 项目身份卡（Phase A）
  | "task-history"        // 单 task 执行记录（Phase A）
  | "self-heal-log"       // 单次 self-heal 修复记录（Phase C-1）
  | "decision"            // ADR 风格架构决策（未实装）
  | "handoff-note"        // agent 间留言（未实装）
  | "codebase-map"        // 文件 → 职责映射（未实装，Phase D）
  | "model-scorecard"     // 现有 ModelScorecardRow 的 memory 视图（未实装）
  | "session-report"      // 现有 coding-session-report 的 memory 视图（未实装）
  | "qa-verdict";         // QAAgent / VerifierAgent 评分（未实装）

interface MemoryRecord {
  id: string;
  layer: "L1" | "L2";
  kind: MemoryKind;
  title: string;
  body: string;                       // markdown 或 JSON.stringify (per kind format)
  tags: string[];                     // ['mined','stage:foo','category:real-failure']
  source: "cache" | "manual" | "orchestrator" | "self-heal" | "distill" | "adapter";
  refs: { kickoffId?: string; taskId?: string; parentRecordId?: string };
  metrics: { hits?: number; lastHitAt?: number; score?: number };
  createdAt: number;
  updatedAt: number;
  schemaVersion: 1;
}
```

### 3.2 已落地的 kind 与 body 格式

| Kind | format | Schema 位置 | Producer |
|---|---|---|---|
| `classification` | json | `schemas/classification.ts` | `classifyProject()` cache wrapper |
| `failure-pattern` | markdown | （markdown body, 无 schema） | `repair-log-miner.ts` / 人工编辑 |
| `project-card` | markdown | `schemas/project-card.ts` (描述性) | `event-bridge.ts` 的 intent step_complete |
| `task-history` | json | `schemas/task-history.ts` | `event-bridge.ts` 每个 step_complete/error |
| `self-heal-log` | json | `schemas/self-heal-log.ts` | `self-heal-sink.ts`（订阅 RepairEmitter） |
| `codebase-map` | markdown | `schemas/codebase-map.ts` (描述性) | （Phase D 启用） |

### 3.3 Pattern 分类（仅 failure-pattern）

mined pattern 在生成时由 `classifyPatternNature()` 分到 4 类，作为 `category:*` tag 写入：

| Category | 何时分到 | UI banner | 推荐操作 |
|---|---|---|---|
| **success-metric** | `fixed/total >= 0.6 且 gave_up=0` | 🔴 红 | Disapprove or Delete |
| **broadcast** | event 名包含 snapshot/audit_clean/dispatch_done/autorepaired/installed/applied/trimmed | 🔴 红 | Disapprove |
| **real-failure** | event 名含 truncated/stagnation/unfulfilled/task_forced/fail/exhausted/abandon/missing 或 `gave_up>0` 或 `details.reason` 非空 | 🟢 绿 | Edit "How to avoid" → Approve |
| **ambiguous** | 都不匹配 | 🟡 黄 | 手动判断 |

实现：`src/lib/memory/distill/repair-log-miner.ts` 的 `classifyPatternNature()` + 4 个专用 markdown 模板。

---

## 4. 目录布局

> 设计原则：每条记忆是 self-contained 的单文件，按 kind 分目录。Per-developer 数据（metrics、trace、lock）独立存储，可被 `.gitignore` 排除。`records/**` 全部可 commit，新人 clone 即拥有完整知识库。

### 4.1 通用布局（L1 / L2 同结构）

```
.memory/
├── records/
│   ├── classification/
│   │   └── CL-<briefHash>.json      JSON envelope
│   ├── failure-pattern/
│   │   └── FP-<slug>.md             markdown w/ JSON-in-frontmatter
│   ├── project-card/                # L2 only
│   │   └── PC-<kickoff>.md
│   ├── task-history/                # L2 only
│   │   └── TH-<kickoff>-<task>.json
│   ├── self-heal-log/               # L2 only
│   │   └── SH-<kickoff>-<stage>-<attempt>-<task>.json
│   └── ...
├── metrics.json                     # { id: {hits, lastHitAt, score} }（gitignored）
├── trace.jsonl                      # 召回/注入/归因事件流（gitignored）
├── .lock-target                     # proper-lockfile sentinel（gitignored）
└── .attribution-cursor.json         # 已归因的 (kickoffId, taskId) pairs（gitignored）
```

### 4.2 文件格式

**Markdown 类**（`failure-pattern`, `project-card`, `decision`, `agent-tuning`）：

```markdown
---
{"id":"FP-...","layer":"L1","kind":"failure-pattern","title":"...","tags":["mined","category:real-failure",...],"source":"distill","refs":{},"createdAt":...,"updatedAt":...,"schemaVersion":1}
---

# Body markdown content here
```

**JSON 类**（`task-history`, `classification`, `self-heal-log`, `scaffold-fitness`）：

```json
{
  "id": "TH-K42-T018",
  "layer": "L2",
  "kind": "task-history",
  "title": "...",
  "tags": [...],
  "source": "orchestrator",
  "refs": { "kickoffId": "K42", "taskId": "T018" },
  "createdAt": ...,
  "updatedAt": ...,
  "schemaVersion": 1,
  "body": { "status": "completed", "attempts": 2, ... }
}
```

**关键约束**：
- record 文件**绝不**包含 `metrics` 字段（hits/score/lastHitAt 都在 `metrics.json`）。
- 文件名 = `<id>.<ext>`；`id` 自带 kind 前缀（CL-/FP-/TH-/PC-/SH-/...）。
- markdown frontmatter 用 `---` + JSON（不引入 YAML 依赖）。

### 4.3 git 共享策略（实际 .gitignore）

```gitignore
# memory system L1 — only per-developer / cache files.
.memory/metrics.json
.memory/metrics.json.tmp
.memory/.lock-target
.memory/.lock-target.lock
.memory/trace.jsonl
.memory/store.sqlite
```

`records/**` 不在 ignore 列表 → 默认进 git。这是 §1.1 "跨项目积累" 的物理实现。

### 4.4 L1 vs L2 路径

- **L1**：`<AgenticBuilder>/.memory/` —— 跨所有 generated 项目共享，进仓库 git。
- **L2**：`<generated-project>/.memory/` —— 单项目本地。当前 `generated-code/` 在 .gitignore 顶层只 ignore `node_modules/dist/public/design/*.png`，不再忽略 `.memory/`，所以 L2 records 会随生成的项目一起被 git 跟踪（如果你 commit 它）。

### 4.5 "新人 clone" 恢复语义

```
git clone + npm install
  ↓
.memory/records/** 同步到位（所有 classification、failure-pattern 立即可用）
  ↓
metrics.json 不存在 → FileStore 启动按 0 hits 起步
  ↓
首次访问任意 kind → FileStore.ensureCache() walk records/ 重建 in-memory cache
```

→ **历史经验完整继承，个人计数器从零开始**。

---

## 5. 核心接口

```ts
// src/lib/memory/types.ts
export interface MemoryStore {
  save(input: SaveInput): Promise<MemoryRecord>;
  update(id: string, patch: Partial<Pick<MemoryRecord,"body"|"tags"|"metrics">>): Promise<MemoryRecord>;
  get(id: string): Promise<MemoryRecord | null>;
  recall(query: RecallQuery): Promise<MemoryRecord[]>;
  delete(id: string): Promise<void>;
  list(opts?: ListOptions): Promise<MemoryRecord[]>;

  bumpHit(id: string): Promise<void>;
  setScore(id: string, score: number): Promise<void>;
}

// src/lib/memory/index.ts
export function getSystemMemory(): MemoryStore;        // L1，root = MEMORY_L1_ROOT 或 process.cwd()
export function getProjectMemory(projectRoot: string): MemoryStore;  // L2
```

实现：`FileStore`（`src/lib/memory/file-store.ts`）—— per-record 文件 + 进程内 Promise 队列 + `proper-lockfile` 跨进程锁。

---

## 6. 写入路径（实际实现）

### 6.1 L2 写入（per-kickoff data）

| Kind | Producer | Trigger | 实现位置 |
|---|---|---|---|
| `project-card` | event-bridge | intent step_complete（带 classification metadata） | `src/lib/memory/event-bridge.ts` |
| `task-history` | event-bridge | 每个 step_start/complete/error；同 (runId, stepId) 重复 step_complete 去重 | 同上 |
| `self-heal-log` | self-heal-sink | RepairEvent 中有学习信号（repairedIds / stillMissing / files / details） | `src/lib/memory/self-heal-sink.ts` |

接入点：
- `src/app/api/agents/pipeline/route.ts` 和 `kickoff/route.ts` 用 `wrapPipelineEventHandler(send, {projectRoot, codeOutputDir, kickoffSessionId})` 包 SSE callback。
- `src/app/api/agents/coding/route.ts` 在 `createRepairEmitter([...])` 列表里加 `createMemorySelfHealSink({outputDir, kickoffSessionId})`。
- `src/store/pipeline-store.ts` 的 `startPipeline()` 用 `crypto.randomUUID()` 生成 `kickoffSessionId`，两端 fetch 共享，确保跨路由 records 关联。

### 6.2 L1 写入

| Kind | Producer | Trigger | 实现位置 |
|---|---|---|---|
| `classification` | classifier cache | `classifyProject()` LLM 成功 + JSON parse 成功（fallback 不缓存）| `src/lib/agents/shared/project-classifier.ts` |
| `failure-pattern` | mining script | 用户跑 `npm run memory:mine-patterns` | `scripts/memory-mine-patterns.ts` + `src/lib/memory/distill/repair-log-miner.ts` |
| `failure-pattern` (edits) | UI / CLI | 用户在 `/memory` 编辑 body 或 `npm run memory:approve` | `src/components/memory/MemoryRecordDetail.tsx` |

### 6.3 写入纪律（强制）

- 所有从 orchestrator / self-heal 进来的 memory 写入必须 **fire-and-forget + try/catch swallow**——不能让 task 因为记忆写入失败而崩。
- recorder 函数（`recordProjectCard`/`recordTaskHistory`/`recordSelfHealLog`）内部 try/catch + console.warn，对外不抛异常。
- bridge / sink 也包一层 try/catch，确保 emitter 链不被打断。

---

## 7. 读取路径（recall + inject）

### 7.1 入口：`recallAndPrepareInject()`

实现：`src/lib/memory/recall-context.ts`

```ts
const result = await recallAndPrepareInject({
  agent: "worker_codegen",
  role: state.role,                 // 'frontend'|'backend'|'architect'|'test'
  task: { id, title, description, files },
  projectRoot: state.outputDir,
  kickoffId: state.sessionId,
  layers: ["L1", "L2"],             // 默认 ['L1']
  kinds: ["failure-pattern"],       // 默认
});
// result: { block, active, shadow, estimatedTokens, suppressed }
```

### 7.2 三层分流（核心运行时）

```
recall via MemoryStore.recall()  →  candidates
    ↓
对每条 candidate 看 score + manual:approved tag：
    score < 0 且 !approved      → drop（deprecated）
    score >= 0.3 或 approved    → active.push
    其他                        → shadow.push
    ↓
若 MEMORY_INJECT=true 且 active 非空：
    渲染 <memory-context> 块（renderMemoryContext，token 预算 1500 默认）
    bumpHit on each active record
    ↓
trace.jsonl 写一条 op:"inject"，含 activeIds / shadowIds / injected / suppressedByFlag
    ↓
返回 { block, active, shadow, ... } 给调用方
```

### 7.3 何时召回

| 调用点 | 实现 | RecallQuery |
|---|---|---|
| Worker codegen prompt 构建前 | `src/lib/langgraph/agent-subgraph.ts` 在 ROLE_PROMPTS 之后插一个 system message | `kinds:['failure-pattern']`, `text=task.title+desc`, tags 软匹配 file ext |
| 计划中 / 未实装 | self-heal LLM prompt、PM/Architect/QA agent | （Phase C 范围已画线，留待证明 inject 价值后扩） |

### 7.4 注入格式（统一 wrapper）

```
<memory-context source="L1+L2" recalled-at="<ts>" count="<n>">
  <record id="FP-..." kind="failure-pattern" hits="14">
    <title>...</title>
    <body>...</body>
  </record>
  ...
</memory-context>
```

`renderMemoryContext()` 实现 token 预算：第一条 record 永远进，后续 record 按 score 排序顺序加入直到超预算。

---

## 8. 与现有打分 / 持久化系统的集成

### 8.1 已有持久化盘点（不重写，仅适配）

| 现有产物 | 位置 | 我们的做法 |
|---|---|---|
| `model-leaderboard.jsonl` | `<project>/.ralph/` | **保留唯一权威**——未来通过 adapter 暴露为 `model-scorecard` kind 的 read-only view |
| `coding-session-report.{json,md}` | `<project>/.ralph/` | A/B 比较 (`memory:ab-compare`) 直接读这个文件 |
| `repair-log.jsonl` | `<project>/.ralph/` | mining 输入；C-1 的 self-heal-sink 旁路写一份 L2 self-heal-log |
| `src/lib/pipeline/model-scoring/` | 模块 | 评分逻辑零改动 |

### 8.2 集成原则
1. **不复制数据**：JSONL / report 文件保持唯一权威源。
2. **不重写评分逻辑**：`model-scoring/` 6 维度算法不动。
3. **统一召回入口**：agent 想问"这个 stage 用哪个 model 性价比高？"未来只调 `memory.recall()`。
4. **跨项目聚合靠 memory**：单项目数据在 `.ralph/`；跨项目聚合通过 mining 写出 L1 record。

---

## 9. Pattern 生命周期与归因

### 9.1 生命周期总览

```
[1] 数据源
    repair-log.jsonl 累积 (orchestrator 自然产生)
    self-heal-log L2 records 累积 (Phase C-1 旁路写入)
        ↓
[2] Mining (rule-based, npm run memory:mine-patterns)
    按 (stage, event) 聚类 → 22 条 mined patterns
    classifyPatternNature 给每条打 category:*  tag
    score = 0 (Layer 3 shadow)
        ↓
[3] 人类审批 (Memory UI + memory:approve CLI)
    UI SuggestionBanner 给"Disapprove or Delete / Edit then Approve / 手动审"建议
    用户编辑 markdown body 补 "How to avoid" 段
    Approve → +manual:approved tag + score=0.5 → Layer 2 active
        ↓
[4] Inject (recallAndPrepareInject in agent-subgraph)
    active 进 prompt; shadow 仅 trace
    bumpHit on injected records
        ↓
[5] Outcome attribution (npm run memory:attribute / UI button)
    任务 completed → 注入过的 active patterns +0.05
    任务 failed → 注入过的 active patterns -0.10
    manual:approved 永久免疫
    score 钉到 [-1, 1]
    cursor 持久化 (kickoffId, taskId) 防双倍计数
        ↓
[6] 自动汰换 / 自动晋升
    shadow 命中多次成功 → 累计到 0.3 → 自动 active
    active 多次失败 → 累计到 < 0 → deprecated, 不再召回
```

### 9.2 归因数学

```
每个终态 task (completed | failed) 找出注入过的 active patterns
  对每条非 manual:approved 的 pattern：
    delta = successes * δ_s + failures * δ_f
    new_score = clamp(old_score + delta, -1, 1)
  对 manual:approved 的：仍计入 successes/failures（用于 UI 显示），但 delta = 0
  
默认: δ_s = +0.05  δ_f = -0.10  (失败惩罚 = 奖励 × 2)
```

**关键设计决策**：
- **Cursor**：`(kickoffId, taskId)` 写入 `.attribution-cursor.json`，重复跑同一项目不会双倍计数。
- **shadow 不参与归因**：只有 `injected: true` 的 trace 事件参与（即真注入到 prompt 的）。
- **失败惩罚 > 奖励**：单条 pattern 注入后让 task 失败比促成成功的代价更大。倾向"宁可关掉，不要乱注入"。
- **手动审批通道独立于归因**：人类 vouch 过的不被自动改 score。

实现：`src/lib/memory/distill/attribution.ts`（pure function）+ `scripts/memory-attribute.ts` CLI + `src/app/api/memory/attribute/route.ts` HTTP。

---

## 10. CLI 命令清单

```bash
# 浏览
npm run memory:list                  # 列记录（按 updatedAt desc）
npm run memory:list -- --kind=failure-pattern --limit=30
npm run memory:show <id>             # 单条详情
npm run memory:search "<keyword>"
npm run memory:recall --tags=...     # 模拟 agent 召回
npm run memory:stats                 # 总数 / 按 kind 分布 / 命中率
npm run memory:trace <kickoffId>     # 这次 kickoff 召回了哪些

# 审批与维护
npm run memory:approve <id>          # 加 manual:approved + score=0.5
npm run memory:approve <id> -- --score=0.9
npm run memory:disapprove <id>       # 移除 tag + score=0
npm run memory:disapprove <id> -- --score=-0.5

# 缓存治理
npm run memory:invalidate-classification -- --all
npm run memory:invalidate-classification -- --prompt-version=v1-...
npm run memory:invalidate-classification -- --brief-hash=<hex>

# 数据流入
npm run memory:mine-patterns         # repair-log.jsonl → 22 条 L1 failure-patterns
npm run memory:mine-patterns -- --dry-run

# 反馈循环
npm run memory:attribute             # 默认 project=generated-code
npm run memory:attribute -- --project=out-treatment-clock --dry-run
npm run memory:attribute -- --reset-cursor

# A/B 验证（Phase C-6）
npm run memory:ab-compare -- --baseline=out-baseline --treatment=out-treatment
```

实现：
- `scripts/memory-cli.ts` + `src/lib/memory/cli.ts`（list/show/search/recall/stats/trace/approve/disapprove/invalidate-classification）
- `scripts/memory-mine-patterns.ts`
- `scripts/memory-attribute.ts`
- `scripts/memory-ab-compare.ts`

---

## 11. UI 入口（Phase C-7 + C-8）

### 11.1 路由与导航
- 路径：`/memory`
- 导航：`AppNav` 左到右是 `Pipeline | Reports | Memory | [Launch Pipeline]`

### 11.2 页面布局

```
┌──── /memory ──────────────────────────────────────────────────────────┐
│ [All] [Active] [Shadow] [Deprecated] [Approved]                       │
│   [Run Attribution] [reset cursor □]   ⚙ kind ▾   🔍 search           │
│ ┌──── attribution result banner (绿/红，可关) ─────────────────────┐ │
│ ├────── List Sidebar (1/3) ──────┬──── Detail (2/3) ───────────────┤ │
│ │ ● FP-mined-...                  │  # title                         │ │
│ │   "stagnation_warning"          │  metadata: id / layer / kind /  │ │
│ │   41× │ shadow │ hits 0         │            source / hits / lastHit│ │
│ │   ─────────────────             │                                  │ │
│ │ ● FP-mined-...                  │  💡 SuggestionBanner            │ │
│ │   ...                           │  (red/yellow/green per category) │ │
│ │                                  │                                  │ │
│ │                                  │  Score: ━━━━●━━━━ 0.5 [shadow]   │ │
│ │                                  │  Tags: [mined][category:...]    │ │
│ │                                  │  [Approve] [Disapprove] [Edit]  │ │
│ │                                  │  [Delete]                       │ │
│ │                                  │                                  │ │
│ │                                  │  Body: markdown 渲染 / JSON pretty│ │
│ └─────────────────────────────────┴──────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### 11.3 SuggestionBanner 启发式（render-time）
读 `category:*` tag → 给四档建议（与 §3.3 表对应）：
- success-metric / broadcast → 红色「Disapprove or Delete」
- real-failure → 绿色「Edit then Approve」
- ambiguous → 黄色「Review manually」
- 已 approved → 不显示 banner

### 11.4 后端 API

| Method | Route | 用途 |
|---|---|---|
| GET | `/api/memory` | list（按 kind/status/search 过滤） |
| GET | `/api/memory/[id]` | 单条详情 |
| PATCH | `/api/memory/[id]` | 编辑 body / tags / score |
| DELETE | `/api/memory/[id]` | 删除 |
| POST | `/api/memory/[id]/approve` | 加 manual:approved + score |
| POST | `/api/memory/[id]/disapprove` | 移除 tag + score |
| POST | `/api/memory/attribute` | 跑一次归因（C-8） |

---

## 12. 可观测性

### 12.1 trace.jsonl 事件流

每条 inject / save / update / cache-hit / cache-miss 都打一行 JSON 到 `<project>/.memory/trace.jsonl`：

```json
{"ts":1777364298357,"op":"inject","layer":"L1","kickoffId":"...","taskId":"T-x","agent":"worker_codegen","details":{"activeIds":["FP-..."],"shadowIds":["FP-..."],"activeCount":2,"shadowCount":6,"injectedTokens":352,"injected":true,"suppressedByFlag":false}}
```

CLI: `npm run memory:trace <kickoffId>` 过滤回放。

### 12.2 关键 op 字段

| op | 何时发出 |
|---|---|
| `save` | record 写入 |
| `update` | tags/body/score 改动 |
| `recall` | （未启用） |
| `inject` | recallAndPrepareInject 每次执行 |
| `cache-hit` / `cache-miss` | classification 缓存查询（Phase B） |
| `bumpHit` | （未启用作为独立 op） |

实现：`src/lib/memory/trace.ts`（FileTraceLogger）。

---

## 13. 验证策略与实测状态

### 13.1 单元测试覆盖

```
8 test files, 91 tests passing:
  file-store.test.ts          16 tests  CRUD / recall / 并发 / per-record fs / metrics 分离
  event-bridge.test.ts         9 tests  step_complete dedup / token usage / kickoffId override
  recall-context.test.ts      12 tests  3-layer split / token budget / hits accounting / approved bypass
  classifier-cache.test.ts     8 tests  R1-R5（污染、归一化、prompt 版本、fallback 不缓存、flag）
  approve-cli.test.ts          9 tests  approve / disapprove / round-trip / idempotent
  self-heal-sink.test.ts      10 tests  4 outcome 分类 / 3 过滤 / id 稳定性
  repair-log-miner.test.ts    13 tests  4 category / 聚类 / outcome 计数 / 限制
  attribution.test.ts         12 tests  success / failure / clamp / immune / cursor / multi-pattern
```

### 13.2 黄金集 / 端到端验证

| 名称 | 状态 | 位置 |
|---|---|---|
| Classification cache 黄金集（§14.6.6 R1-R5） | ✅ 单测覆盖；活体黄金集留待 Phase B 默认开启时跑 | `classifier-cache.test.ts` |
| Phase A smoke (event-bridge 真实数据) | ✅ 之前做过，22 条 mined patterns 落盘正确 | `tests/memory/ab-golden-set.json` |
| C-1 sink smoke (486 → 32 self-heal-log) | ✅ 历史记录 | — |
| C-3 inject smoke（mined seeds + score 调动 → 真注入）| ✅ 历史记录 | — |
| **C-4 attribution smoke**（6 task / 4 完 / 2 败）| ✅ 数学正确、cursor 短路验证 | — |
| **C-6 A/B harness** 真实跑 | ⏳ 需要花真实 LLM 钱才能跑；recipe 在 `tests/memory/ab-golden-set.json` | — |

### 13.3 Phase D 才做的验证
- L1 失败模式数量 >100 时跑召回 precision@5 / recall@5
- inject 注入后 codegen 输出质量评估（A/B 5+ briefs）
- 长期统计：hit rate, score 分布漂移

---

## 14. Phase 交付状态（已 ship 部分）

| Phase | 范围 | 状态 |
|---|---|---|
| **A** | MemoryStore + FileStore (per-record) + CLI 四件套 + L2 project-card / task-history 接入 orchestrator | ✅ |
| **A 修复** | per-record self-contained 文件 + metrics 分离 + git 共享 | ✅ |
| **B** | classification cache 接入 classifyProject() + invalidate CLI | ✅ |
| **C-1** | RepairEmitter memory sink → L2 self-heal-log | ✅ |
| **C-2** | repair-log mining + 22 patterns（带 category 分类） | ✅ |
| **C-3** | recall + 三层 inject 接入 worker codegen | ✅ |
| **C-4** | 注入归因（success/fail → score 自动调） | ✅ |
| **C-5** | approve / disapprove CLI（manual:approved 通道） | ✅ |
| **C-6** | A/B 比较 harness + golden-set 文档 | ✅（手动跑） |
| **C-7** | Memory UI + SuggestionBanner | ✅ |
| **C-8** | UI 归因按钮 + result banner | ✅ |
| **D（未启动）** | LLM-based distiller / scaffold-fitness / agent-tuning / model-routing / Replay mode / 向量召回 | ⏸️ |

---

## 15. 风险与回滚

### 15.1 三层 env 开关

```bash
MEMORY_ENABLED=true   # 总闸：所有 recall/save 开关
MEMORY_INJECT=false   # 注入开关：false = active 也不进 prompt（仅 trace）
MEMORY_CACHE=true     # classification cache 读写
```

**当前默认配置**（保守）：
- `MEMORY_ENABLED=true`：写入和召回都跑
- `MEMORY_INJECT=false`：默认不真注入。即使 approve 了 patterns，prompt 也不会变
- `MEMORY_CACHE=true`：classification cache 默认开（已通过 R1-R5 测试）

**想真灰度试 inject**：`.env.local` 写 `MEMORY_INJECT=true`，跑 kickoff，回 `/memory` 看 hits 列变化。

### 15.2 回滚路径

| 档级 | 操作 | 影响 |
|---|---|---|
| 软关闭 | `MEMORY_ENABLED=false` | recall 返回空、save 短路。退化到接入前 |
| 半关闭 | `MEMORY_INJECT=false` | 只写不读，纯观察模式 |
| 单关 | `MEMORY_CACHE=false` | classifier 不查 cache 但其他正常 |
| 硬关闭 | `rm -rf .memory/` + `git revert <pr>` | 彻底回到 0 |

回滚不动 `.ralph/` —— memory 系统对 `.ralph/` 是只读 + 旁路。

### 15.3 风险等级矩阵（实测后）

| 风险 | 等级 | 当前缓解 |
|---|---|---|
| memory 写入失败拖崩 task | 🟢 → 已缓解 | 全部 try/catch + fire-and-forget；91 tests pass |
| classification cache 返回过期结果 | 🟡 | normalize hash + PROMPT_VERSION + invalidate CLI |
| 注入 pattern 劣化 codegen 质量 | 🟡 | (a) 默认 MEMORY_INJECT=false (b) score 阈值 (c) attribution 自动汰换 |
| Electron 打包遗漏 native 模块 | 🟢 → N/A | 没引入 native（用纯文件，不用 better-sqlite3）|
| Adapter 与原始 JSONL schema 漂移 | 🟢 → N/A | 暂未实装 model-scorecard adapter |
| 多 kickoff 并发损坏索引 | 🟢 | proper-lockfile + 进程内 Promise 队列；并发测试通过 |
| 磁盘膨胀 | 🟢 | per-record 文件平均 ~2KB；可手动 rm |
| **Mining 出 noise pattern 误注入** | 🟡（实测有） | C-2 加 category 分流 + UI banner + score=0 默认 |

---

## 16. 演进路径

### 16.1 何时考虑切换到 Graphiti
触发条件（任一）：
- L1 `failure-pattern` 数 > 200，关键词召回 precision 跌破 0.5
- 出现明确的图查询需求（"playwright 相关 → 路由到 → vite-config 的所有失败"）
- 多用户场景，需要时序去重 / 实体合并

切换路径：
1. 实现 `GraphitiStore implements MemoryStore`
2. 写 `npm run memory:export` 把 FileStore records 灌入 Graphiti（保留 id）
3. 通过 env 切 `MEMORY_BACKEND=graphiti`
4. 业务代码零改动

### 16.2 Phase D 路线（未启动，按 ROI 排序）
1. **LLM-based distiller**（增强 mining）—— 把 self-heal-log 的 reason 文本 → 提炼"症状/根因/修法"三段式 markdown，比 rule-based 更高质量
2. **scaffold-fitness 自动写入**（kickoff 完成时记 tier+type+scaffold→build/e2e 通过率）
3. **agent-tuning 自动写入**（QAAgent / VerifierAgent 给某个 agent 打负分时沉淀）
4. **codebase-map 接 codegen**（每次写文件后 patch L2 codebase-map）
5. **Replay mode CLI**（用某时间点的 memory snapshot 重跑历史 kickoff，做 regression）
6. **跨用户云端同步**（多机共享 L1 知识）
7. **向量召回**（sqlite-vec，>200 条记忆时启用）

---

## 17. 文件清单（实际落地）

```
src/lib/memory/
├── types.ts                                MemoryRecord / MemoryStore / RecallQuery
├── env.ts                                  3 个 env flag 解析
├── recall-config.ts                        召回排序权重 + token 预算
├── index.ts                                getSystemMemory / getProjectMemory factory + cache
├── file-store.ts                           ★ 主实现：per-record + metrics 分离 + 锁
├── inject.ts                               <memory-context> 渲染 + token 预算
├── recall-context.ts                       ★ Phase C-3 三层入口
├── recorders.ts                            recordProjectCard / recordTaskHistory / recordSelfHealLog
├── event-bridge.ts                         wrapPipelineEventHandler（订阅 PipelineEvent）
├── self-heal-sink.ts                       订阅 RepairEvent → L2
├── trace.ts                                FileTraceLogger
├── cli.ts                                  list/show/search/recall/stats/trace/approve/disapprove/invalidate
├── distill/
│   ├── repair-log-miner.ts                 ★ Phase C-2 mining + classifyPatternNature
│   └── attribution.ts                      ★ Phase C-4 computeAttributions
├── schemas/
│   ├── index.ts                            kind → format/schema 注册表
│   ├── classification.ts
│   ├── task-history.ts
│   ├── project-card.ts
│   ├── codebase-map.ts
│   └── self-heal-log.ts                    Phase C-1
└── __tests__/                              91 个测试

scripts/
├── memory-cli.ts                           入口 dispatcher
├── memory-mine-patterns.ts                 Phase C-2 CLI
├── memory-attribute.ts                     Phase C-4 CLI
└── memory-ab-compare.ts                    Phase C-6 CLI

src/app/api/memory/
├── route.ts                                GET list
├── [id]/route.ts                           GET / PATCH / DELETE
├── [id]/approve/route.ts                   POST
├── [id]/disapprove/route.ts                POST
└── attribute/route.ts                      POST（C-8）

src/app/(dashboard)/memory/
└── page.tsx                                /memory 路由

src/components/memory/
├── MemoryFilterBar.tsx                     tabs + search + Run Attribution 按钮
├── MemoryListSidebar.tsx                   左栏列表
├── MemoryRecordDetail.tsx                  右栏详情 + 编辑 + actions + score slider
└── SuggestionBanner.tsx                    UI 启发式建议横幅

src/store/
└── memory-store.ts                         zustand state

tests/memory/
└── ab-golden-set.json                      Phase C-6 5 条 brief

修改的现有文件:
├── src/components/AppNav.tsx               + Memory link
├── src/store/pipeline-store.ts             + kickoffSessionId
├── src/app/api/agents/pipeline/route.ts    + wrapPipelineEventHandler
├── src/app/api/agents/kickoff/route.ts     + wrapPipelineEventHandler
├── src/app/api/agents/coding/route.ts      + createMemorySelfHealSink
├── src/lib/agents/shared/project-classifier.ts  + cache wrapper
└── src/lib/langgraph/agent-subgraph.ts     + recallAndPrepareInject 注入
```

---

## 18. 待定问题（v2 状态）

| Q | 决策 | 落地 |
|---|---|---|
| Q1: L1 `.memory/` 进 git？ | (b) markdown 进、metrics/trace/lock 不进 | ✅ .gitignore 落实 |
| Q2: L2 进 generated 项目 git？ | (a) 进——让生成的项目带着记忆走 | ✅ generated-code/.memory 当前未被 ignore |
| Q3: distillation 用哪个 model？ | rule-based mining 起步；LLM distill 留 Phase D | ✅ |
| Q4: api-contracts 与现有 API_CONTRACTS.json 关系 | (b) 共存 | ✅ memory 不动 .ralph/ |
| Q5: 召回 token 预算上限？ | 1500（INJECT_TOKEN_BUDGET）| ✅ recall-config.ts |
| Q6: distill 触发频率 | 手动（`npm run memory:mine-patterns` / `memory:attribute`）；UI 按钮触发 attribution | ✅ |
| **Q7（新）**: Approve 应该 score 设多少？ | 默认 0.5；UI 滑条可改；CLI `--score=` flag | ✅ |
| **Q8（新）**: 失败惩罚 / 成功奖励比？ | 失败：奖励 = 2:1（δf=-0.10, δs=+0.05） | ✅ DEFAULT_DELTA_* |
| **Q9（新）**: manual:approved 是否可被归因降级？ | 永久免疫——人类 vouch 比机器统计更可信 | ✅ attribution.ts |

---

## 附录 A: MemoryRecord 示例

### A.1 failure-pattern (mined, real-failure category)

文件: `.memory/records/failure-pattern/FP-mined-architect-triage-task-forced-to-llm.md`

```markdown
---
{"id":"FP-mined-architect-triage-task-forced-to-llm","layer":"L1","kind":"failure-pattern","title":"architect-triage · Task references 10 file(s) outside the scaffold's protected…","tags":["mined","stage:architect-triage","event:task_forced_to_llm","category:real-failure","ext:ts","ext:env"],"source":"distill","refs":{},"createdAt":...,"updatedAt":...,"schemaVersion":1}
---

# architect-triage — task_forced_to_llm

## What this records
Stage `architect-triage` triggered `task_forced_to_llm` **20** times across 0 session(s).

## Symptoms
Top reasons captured in past events:
- (×3) Task references 10 file(s) outside the scaffold's protected paths — real work must be generated.
- (×3) Task references 15 file(s) outside the scaffold's protected paths — real work must be generated.

## How to avoid (FILL IN)
> ⚠️ This section is the actual content the LLM will see. Write specific, actionable guidance:
> - Describe the trigger condition
> - Give the prevention rule
> - Mention any task-type / stack signals

## Recommended action
🟢 **Edit "How to avoid" with project-specific guidance, then Approve.** 20 occurrences indicate this is a real recurring problem.

## Sample task titles
- Setup database schema and Sequelize models for records
- Setup database models and validation schemas

## Raw stats
- Stage: `architect-triage` · Event: `task_forced_to_llm`
- 20 occurrences across 0 session(s)
- Outcomes: fixed=0, progress=0, gave_up=0, other=20
- File types touched: `.ts`, `.env`, `.yml`, `.js`, `.sql`
```

### A.2 task-history (L2)

```json
{
  "id": "TH-K42-T018",
  "layer": "L2",
  "kind": "task-history",
  "title": "Add JWT auth (completed)",
  "tags": ["kickoff:K42", "taskId:T018", "status:completed", "step:kickoff"],
  "source": "orchestrator",
  "refs": { "kickoffId": "K42", "taskId": "T018" },
  "createdAt": 1714161900000,
  "updatedAt": 1714161948000,
  "schemaVersion": 1,
  "body": {
    "status": "completed",
    "attempts": 2,
    "costUsd": 0.34,
    "durationMs": 48211,
    "totalTokens": 12340,
    "files": ["backend/src/middleware/auth.ts"],
    "selfHealTriggered": true,
    "selfHealLogId": "SH-K42-001"
  }
}
```

### A.3 self-heal-log (L2)

```json
{
  "id": "SH-K-smoke-architect-triage-x-T-001",
  "layer": "L2",
  "kind": "self-heal-log",
  "title": "architect-triage · other",
  "tags": ["kickoff:K-smoke","stage:architect-triage","outcome:other","taskId:T-001","ext:ts","ext:env"],
  "source": "self-heal",
  "refs": { "kickoffId": "K-smoke", "taskId": "T-001" },
  "schemaVersion": 1,
  "body": {
    "stage": "architect-triage",
    "event": "task_forced_to_llm",
    "outcome": "other",
    "taskId": "T-001",
    "files": ["backend/src/models/Task.ts","..."],
    "details": {
      "reason": "Task references 8 file(s) outside the scaffold's protected paths — real work must be generated.",
      "title": "Setup database models and migrations for Task entity",
      "phase": "Data Layer"
    },
    "occurredAt": "2026-04-24T10:04:20.449Z"
  }
}
```

---

## 附录 B: A/B 实测 recipe (Phase C-6)

```bash
# 前提：先 mine + approve 至少 3-5 条 patterns（score ≥ 0.3 或 manual:approved）

# 选一条 brief（如 BRIEF-1-clock from tests/memory/ab-golden-set.json）

# 1. baseline run (memory 不注入)
MEMORY_ENABLED=true MEMORY_INJECT=false \
  npm run electron:dev
# 在 UI 输入 brief，codeOutputDir = "out-baseline-clock"
# kickoff 完整跑完

# 2. treatment run (memory 注入)
MEMORY_ENABLED=true MEMORY_INJECT=true \
  npm run electron:dev
# 输入相同 brief，codeOutputDir = "out-treatment-clock"

# 3. 比较
npm run memory:ab-compare -- \
  --baseline=out-baseline-clock \
  --treatment=out-treatment-clock

# 4. 把 treatment 的归因数据吸收进 score
npm run memory:attribute -- --project=out-treatment-clock

# 5. 重复 5+ 个 brief。Verdict 阈值：
#    - self-heal triggers ↓ ≥20%
#    - cost regression ≤ 5%
#    - 无 session score 下降
```

数据沉淀点：每跑一次 treatment，对应的 patterns 的 score 通过归因自动调整。良性循环。
