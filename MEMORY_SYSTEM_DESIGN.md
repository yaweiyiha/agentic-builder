# Memory System Design

> Status: Draft v1.3
> Owner: vicky@57blocks.com
> Last updated: 2026-04-28
> Changelog:
> - v1.3: §4 改为 per-record self-contained 文件布局 + metrics 分离 + git 共享策略
> - v1.2: §12.6 Phase B classification cache 的 5 个风险与设计决策
> - v1.1: §7.5 与现有打分/持久化系统的集成；§12.5 影响、风险、回滚、灰度
> - v1.0: 初稿

AgenticBuilder 的记忆系统设计文档。涵盖 L1（系统级）与 L2（项目级）两层，统一抽象，分阶段交付。

---

## 1. 目标与非目标

### 1.1 目标

- **避免重复决策**：相同的 brief 不该让 classifier 跑两次；相同的 task 类型不该让 codegen 重新摸索。
- **避免重犯错误**：self-heal 修过的 bug 类型，下次同类 task 启动时应作为 prompt context 注入。
- **跨 agent / 跨 run 的上下文连续**：同一个 kickoff 续跑、同一个项目多 run 之间 agent 不应"失忆"。
- **跨项目的能力沉淀**：N 个项目踩过的坑、用过的 scaffold 选择，能在第 N+1 个项目启动时被召回利用。
- **可观测、可调试、可回放**：记忆的写入、召回、注入全程可追踪，可在 Dev UI 中检视。

### 1.2 非目标（v1 不做）

- 不做向量召回（FTS5 关键词 + tag 过滤足够覆盖前 200 条）。
- 不做图查询 / 知识图谱（待 L1 失败模式 >200 条后再评估迁移到 Graphiti）。
- 不做云端同步 / 多用户共享（本地单机优先）。
- 不做记忆的"语义合并"（同主题多条手动整理，不自动合并）。
- 不做实时 UI 编辑（先 CLI，UI 是只读 inspector）。

---

## 2. 顶层架构

```
┌──────────────────────────────────────────────────────────────┐
│  L1: System Memory                                           │
│  Location: AgenticBuilder/.memory/                           │
│  Scope:    跨所有 generated 项目                              │
│  Consumers: Classifier / PM / Architect / SelfHeal / CodeGen │
│  Producers: Classifier (cache) / Distiller (from L2)         │
└──────────────────────────────────────────────────────────────┘
         ▲ recall (read-only injection)        │ distill
         │                                     ▼
┌──────────────────────────────────────────────────────────────┐
│  L2: Project Memory                                          │
│  Location: generated-code/.memory/                           │
│  Scope:    单个 generated 项目                                │
│  Consumers: CodeGen / TaskBreakdown / Verifier / Orchestrator│
│  Producers: Orchestrator (task lifecycle) / SelfHeal         │
└──────────────────────────────────────────────────────────────┘
                            ▲
                            │ writes during kickoff
                            │
              ┌──────────────────────────┐
              │  MemoryStore (interface) │
              │  ────────────────────────│
              │  FileStore (default)     │
              │  GraphitiStore (future)  │
              └──────────────────────────┘
```

**关键边界**：

- L2 是"这个项目的事实"——任务历史、决策记录、当前 codebase map、self-heal log。
- L1 是"跨项目提炼出的规律"——失败模式、scaffold 适配度、agent prompt 改进点、classification 缓存。
- L2 → L1 通过 **distillation step**（项目结束 / 周期触发）。
- L1 → L2 通过 **kickoff inject**（kickoff 启动时把相关 L1 内容预置到 PROJECT.md 中）。
- 两层共用同一个 `MemoryStore` interface，只是 namespace 不同。

---

## 3. 数据模型

### 3.1 MemoryRecord

```ts
type MemoryKind =
  | 'classification'        // L1: brief → ProjectClassification 缓存
  | 'failure-pattern'       // L1: 失败模式（distill 自 L2 self-heal / repair-log）
  | 'scaffold-fitness'      // L1: scaffold 选择的统计成功率
  | 'agent-tuning'          // L1: 某 agent 的 prompt 改进点
  | 'model-routing'         // L1: 跨项目聚合的 model fitness（来自 model-leaderboard）
  | 'project-card'          // L2: PROJECT.md 中的项目身份卡
  | 'task-history'          // L2: 单个 task 的执行记录
  | 'decision'              // L2: ADR 风格的架构决策
  | 'self-heal-log'         // L2: 单次 self-heal 修复记录（≈ 现有 repair-log.jsonl 行）
  | 'handoff-note'          // L2: agent 之间留言
  | 'codebase-map'          // L2: 文件 → 职责映射
  | 'model-scorecard'       // L2: 现有 ModelScorecardRow 的 memory 视图（适配，不重写）
  | 'session-report'        // L2: 现有 coding-session-report.json 的 memory 视图
  | 'qa-verdict';           // L2: QAAgent / VerifierAgent 对某次输出的打分

interface MemoryRecord {
  id: string;                        // 例：FP-2026-04-27-playwright-flaky
  layer: 'L1' | 'L2';
  kind: MemoryKind;
  title: string;                     // 一行人类可读标题
  body: string;                      // 主体内容（markdown 或 JSON.stringify 的结构化数据）
  tags: string[];                    // 例：['agent:codegen','stack:prisma','taskType:auth']
  source: 'cache' | 'manual' | 'orchestrator' | 'self-heal' | 'distill';
  refs: {                            // 溯源
    kickoffId?: string;
    taskId?: string;
    parentRecordId?: string;         // distill 时指向源 L2 记录
  };
  metrics?: {                        // 可选治理元数据
    hits?: number;                   // 被召回次数
    lastHitAt?: number;
    score?: number;                  // 人工/自动质量打分 [-1, 1]
  };
  createdAt: number;                 // unix ms
  updatedAt: number;
  schemaVersion: 1;
}
```

### 3.2 RecallQuery

```ts
interface RecallQuery {
  layer?: 'L1' | 'L2' | 'both';
  kinds?: MemoryKind[];
  tags?: {                           // 标签匹配（and within group, or across groups）
    all?: string[];                  // 必须全部命中
    any?: string[];                  // 命中任一即可
    none?: string[];                 // 排除
  };
  text?: string;                     // FTS5 全文检索关键词
  limit?: number;                    // 默认 5
  minScore?: number;                 // 过滤掉低分记忆（治理用）
  kickoffId?: string;                // 限定某次 kickoff 的 L2
}
```

---

## 4. 目录布局

> **设计原则（v1.3）**：每条记忆是一个 self-contained 文件，按 kind 分目录。
> Per-developer 数据（metrics、trace、lock）单独放，可被 .gitignore 排除，避免合并冲突。
> 这样 `records/**` 全部可 commit，新人 clone 即拥有完整知识库。

### 4.1 通用布局（L1 / L2 同结构）

```
.memory/
├── records/
│   ├── classification/
│   │   └── CL-<hash>.json          # JSON envelope
│   ├── failure-pattern/
│   │   └── FP-<slug>.md            # markdown w/ JSON-in-frontmatter
│   ├── scaffold-fitness/
│   │   └── SF-<slug>.json
│   ├── agent-tuning/
│   │   └── AT-<agent>.md
│   ├── project-card/                # L2 only
│   │   └── PC-<kickoff>.md
│   ├── task-history/                # L2 only
│   │   └── TH-<id>.json
│   ├── decision/
│   │   └── DC-<slug>.md
│   └── ...
├── metrics.json                     # { id: {hits, lastHitAt, score} }
├── trace.jsonl                      # observability log
└── .lock-target                     # proper-lockfile sentinel
```

### 4.2 文件格式

**Markdown 类记录**（`failure-pattern` / `project-card` / `decision` / `agent-tuning` / etc.）：

```markdown
---
{"id":"FP-prisma-mig","layer":"L1","kind":"failure-pattern","title":"...","tags":[...],"source":"manual","refs":{},"createdAt":1714161600000,"updatedAt":1714161600000,"schemaVersion":1}
---

## Symptoms
...

## Root cause
...

## Fix
...
```

**JSON 类记录**（`task-history` / `classification` / `scaffold-fitness` / etc.）：

```json
{
  "id": "TH-K42-T018",
  "layer": "L2",
  "kind": "task-history",
  "title": "...",
  "tags": [...],
  "source": "orchestrator",
  "refs": { "kickoffId": "K42", "taskId": "T018" },
  "createdAt": 1714161900000,
  "updatedAt": 1714161948000,
  "schemaVersion": 1,
  "body": { "status": "completed", "attempts": 2, ... }
}
```

**关键约束**：
- record 文件**绝不**包含 `metrics` 字段（hits/score/lastHitAt 都在 `metrics.json` 里）
- record 文件名 = `<id>.<ext>`，`id` 自带 kind 前缀（CL-/FP-/TH-/...），所以单看文件名就能定位 kind
- markdown frontmatter 用 `---` 围栏 + JSON 内容（避免引入 YAML 依赖；解析就是 regex + JSON.parse）

### 4.3 git 共享策略

| 路径 | 进 git？ | 理由 |
|---|---|---|
| `records/**` | ✅ 全部 commit | 知识资产，新人 clone 即得 |
| `metrics.json` | ❌ ignore | per-developer 计数器，每人不同 |
| `trace.jsonl` | ❌ ignore | per-developer 调试日志，噪音大 |
| `.lock-target` / `*.lock` | ❌ ignore | proper-lockfile 临时文件 |

实际 `.gitignore`：
```
.memory/metrics.json
.memory/metrics.json.tmp
.memory/.lock-target
.memory/.lock-target.lock
.memory/trace.jsonl
.memory/store.sqlite
```

注意 `records/**` 不在 ignore 列表 = 默认进 git。这是 §1.1 "跨项目积累" 目标的物理实现。

### 4.4 L1 vs L2 路径

- **L1**：`<AgenticBuilder>/.memory/` —— 跨所有 generated 项目共享，进仓库 git
- **L2**：`<generated-project>/.memory/` —— 单项目本地。注意：本仓库的 `generated-code/` 目录在 .gitignore 里被忽略，所以本仓库内的 L2 不进 git。但生成的项目被推到独立仓库时，`.memory/records/**` 会随之携带，成为该项目自己的"长期记忆"。

### 4.5 恢复语义（"新人 clone" 场景）

新开发者执行 `git clone` + `npm install` 后：
1. `.memory/records/**` 已经从 git 同步过来（所有 classification、failure-pattern 等知识就位）
2. `metrics.json` 不存在 → FileStore 启动时按 0 hits 起步
3. 第一次访问任何记忆，FileStore walk `records/` 重建 in-memory cache
4. 后续读写正常

→ **历史经验完整继承，个人计数器从零开始**。这是设计中"长期记忆 + 个人化使用统计"分层的物理体现。

---

## 5. 核心接口

### 5.1 MemoryStore

```ts
// src/lib/memory/types.ts
export interface MemoryStore {
  save(record: Omit<MemoryRecord, 'createdAt' | 'updatedAt' | 'schemaVersion'>): Promise<MemoryRecord>;
  update(id: string, patch: Partial<Pick<MemoryRecord, 'body' | 'tags' | 'metrics'>>): Promise<MemoryRecord>;
  get(id: string): Promise<MemoryRecord | null>;
  recall(query: RecallQuery): Promise<MemoryRecord[]>;
  delete(id: string): Promise<void>;
  list(opts?: { layer?: 'L1' | 'L2'; kind?: MemoryKind; limit?: number }): Promise<MemoryRecord[]>;

  // 治理
  bumpHit(id: string): Promise<void>;     // 召回时计数 + 1
  setScore(id: string, score: number): Promise<void>;
}
```

### 5.2 命名空间

```ts
// src/lib/memory/index.ts
export function getSystemMemory(): MemoryStore;        // L1 单例
export function getProjectMemory(projectRoot: string): MemoryStore;  // L2 按项目根创建
```

### 5.3 实现：FileStore（v1 默认）

- markdown / json 文件落盘 + SQLite FTS5 索引（fts5 表只放 `id, title, body, tags_csv, kind, layer`）。
- 写入：先写文件 → 再写索引（事务保证一致性，索引坏了用 `npm run memory:reindex` 重建）。
- 读取：FTS5 找候选 id → 按 id 读文件 → tag 过滤 → 排序（hits desc, recency desc）→ limit。
- 并发：`proper-lockfile` 在写索引前抢锁；读不加锁。

---

## 6. 写入路径（谁、何时、写什么）

### 6.1 L1

| Kind | Producer | Trigger | Body |
|---|---|---|---|
| `classification` | `classifyProject()` | 每次调用前查 cache，未命中调 LLM 后写 | 完整 `ProjectClassification` JSON |
| `failure-pattern` | Distiller | L2 `self-heal-log` 累计达阈值 + 通过 LLM 提炼 | 症状 / 根因 / 修法（markdown） |
| `failure-pattern` | Manual seed | v1 上线时人工填 ~20 条 | 同上 |
| `scaffold-fitness` | Orchestrator | 项目最终 build / e2e 状态确定时 | `{tier, type, scaffold, builds: n_ok/n_total, e2ePass: n_ok/n_total}` |
| `agent-tuning` | QAAgent / VerifierAgent | 给某个 agent 输出打负分 + 触发反思 | "下次写 X 时记得 Y"（markdown） |

### 6.2 L2

| Kind | Producer | Trigger | Body |
|---|---|---|---|
| `project-card` | Kickoff start | kickoff 启动时一次 | tier / type / stack / brief 摘要 / L1 注入的相关 patterns |
| `task-history` | Orchestrator | 每个 task 完成 / 失败 / retry 时 append | `{taskId, status, attempts, costUsd, durationMs, files_changed[]}` |
| `decision` | Architect / TaskBreakdown | agent 在 prompt 中显式声明 ADR 时 | 标题 / 上下文 / 决策 / 后果（ADR 模板） |
| `self-heal-log` | SelfHeal loop | 每次成功修复一个 bug 时 | 症状 / 尝试过的修法 / 最终成功的修法 / 涉及文件 |
| `handoff-note` | 任意 agent | agent 在输出 schema 中写 `handoff` 字段时 | 自由 markdown |
| `codebase-map` | CodeGen | 每次写文件后 patch | 文件 → 职责的 map（增量更新） |

### 6.3 写入约束

- **所有写入幂等**：同一 `id` 重复 save 等价于 update。
- **schema 校验**：`save` 内部用 zod 校验 body 结构（per-kind schema）。
- **大对象拆分**：body > 16KB 时拒绝写入，强制要求拆条或外链文件。

---

## 7. 读取路径（召回与注入）

### 7.1 何时召回

| 时机 | 调用方 | RecallQuery 示例 | 注入位置 |
|---|---|---|---|
| Kickoff 启动 | Orchestrator | `{layer:'L1', kinds:['classification'], text: briefHash}` | 跳过 LLM 直接用结果 |
| Kickoff 启动 | Orchestrator | `{layer:'L1', kinds:['failure-pattern','scaffold-fitness'], tags:{any:[`tier:${tier}`,`type:${type}`]}, limit:10}` | 写入 L2 `PROJECT.md` |
| CodeGen 启动单 task | CodeGenAgent | `{layer:'both', kinds:['failure-pattern','handoff-note','codebase-map'], tags:{all:[`taskType:${t.type}`]}, limit:5}` | system prompt 末尾 |
| Verifier 跑前 | VerifierAgent | `{layer:'L2', kinds:['handoff-note'], tags:{all:['to:verifier']}}` | system prompt |
| SelfHeal 启动 | SelfHeal | `{layer:'L1', kinds:['failure-pattern'], text: errorMessage}` | 修复 prompt |

### 7.2 注入格式（统一 wrapper）

```
<memory-context source="L1+L2" recalled-at="<ts>" count="<n>">
  <record id="FP-..." kind="failure-pattern" hits="14">
    <title>Prisma migration conflicts on parallel branches</title>
    <body>...</body>
  </record>
  ...
</memory-context>
```

agent prompt 模板里加一段固定指令："读取 `<memory-context>` 中的相关教训，行动前评估每条是否适用当前 task。"

### 7.3 召回排序

`score = w1*tag_match + w2*fts_relevance + w3*log(hits+1) + w4*recency_decay - w5*negative_score_penalty`

权重写在 `src/lib/memory/recall-config.ts`，可调。v1 用 `[3, 2, 1, 1, 5]`。

---

## 7.5 与现有打分 / 持久化系统的集成（关键）

> 项目里**已经存在多套事实上的"记忆"**，本节说明 memory 系统如何**适配**它们（不重写、不迁移、不复制）。

### 7.5.1 已有持久化盘点

| 现有产物 | 位置 | 已经持久化的内容 | 角色 |
|---|---|---|---|
| `model-leaderboard.jsonl` | `generated-code/.ralph/` | `ModelScorecardRow[]` 跨 session append-only | 模型性能账本 |
| `coding-session-report.{json,md}` | `generated-code/.ralph/` | 单 session 完整报告（gate / cost / events） | 会话事实 |
| `report-history/` | `generated-code/.ralph/` | 历史报告归档 | 时间序列 |
| `repair-log.jsonl` | `generated-code/.ralph/` | self-heal 每次修复尝试 | 失败修复账本 |
| `e2e-triage.md` / `uncovered.md` | `generated-code/.ralph/` | e2e 诊断与未覆盖项 | 诊断快照 |
| `QAAgent` / `VerifierAgent` 输出 | runtime（未持久化） | 对 PRD / 代码 / 测试的打分 | 质量评估 |
| `src/lib/pipeline/model-scoring/` | 模块 | 6 维度评分 + 加权 + A-F grade | 评分逻辑 |

### 7.5.2 集成原则

1. **不复制数据**：JSONL / report 文件保持唯一权威源，memory 系统通过 adapter 读取，不在 `.memory/` 重写一份。
2. **不重写评分逻辑**：`model-scoring/` 6 维度的算法、权重、grade 阈值原封不动，memory 只调用现有 API。
3. **统一召回入口**：agent 想问"这个 stage 用哪个 model 性价比高？"时只调 `memory.recall()`，不需要知道答案是来自 leaderboard.jsonl 还是 .memory/。
4. **跨项目聚合靠 memory**：单项目数据留在 `.ralph/`；要做"全局最优 model"判断时由 memory 的 distillation 跨项目扫所有 `.ralph/` 写出 L1 `model-routing` 记录。

### 7.5.3 Adapter 设计

```ts
// src/lib/memory/adapters/scoring-adapter.ts
export interface ScoringAdapter {
  // 读：把现有 JSONL/report 转成 MemoryRecord 视图（lazy，不落盘）
  scorecardRowsAsRecords(projectRoot: string): Promise<MemoryRecord[]>;  // kind: model-scorecard
  sessionReportsAsRecords(projectRoot: string): Promise<MemoryRecord[]>; // kind: session-report
  repairLogAsRecords(projectRoot: string): Promise<MemoryRecord[]>;      // kind: self-heal-log

  // 写：当 agent 触发新评分时，仍走原有写入路径（appendScorecardToLeaderboard 等），
  //     adapter 只负责"通知 memory 索引新增"以便后续 recall 命中
  notifyScorecardAppended(projectRoot: string, row: ModelScorecardRow): Promise<void>;
}
```

`FileStore` 在 `recall()` 时：
- 命中 `kind ∈ {model-scorecard, session-report, self-heal-log}` → 走 adapter 现读现转
- 命中其他 kind → 读自己的 `.memory/` 文件

这样**双向兼容**：现有 `model-leaderboard.jsonl` 旧代码继续用得好好的，memory 系统纯增量。

### 7.5.4 新增 / 改动的接入点

| 现有模块 | 改动 | 影响 |
|---|---|---|
| `model-scoring/model-leaderboard.ts` `appendScorecardToLeaderboard()` | 写完 JSONL 后**触发** `scoringAdapter.notifyScorecardAppended()`（fire-and-forget） | 加 1 个 await 调用，失败不影响主流程 |
| `qa-agent.ts` / `verifier-agent.ts` | 评分输出**额外写一条** `kind: qa-verdict` 到 memory（当前是 in-memory 无持久化） | 纯新增，零影响现有逻辑 |
| `coding-session-report.ts` | 不动；session report 写完后由 orchestrator 通知 memory 索引一次 | 1 行 hook |
| `repair-log.jsonl` 写入处 | 同上，写完通知 memory 索引 | 1 行 hook |

### 7.5.5 新增的召回能力

| 召回需求 | RecallQuery | 数据来源 |
|---|---|---|
| "M-tier + auth task 用什么 model 最稳？" | `{layer:'L1', kinds:['model-routing'], tags:{all:['tier:M','taskType:auth']}}` | distill 自所有项目的 `model-leaderboard.jsonl` |
| "本项目过去这个 stage 哪个 model 翻车多？" | `{layer:'L2', kinds:['model-scorecard'], tags:{all:['stage:worker_codegen']}}` | adapter 直读 `.ralph/model-leaderboard.jsonl` |
| "类似 error 之前怎么修好的？" | `{layer:'L2', kinds:['self-heal-log'], text: errorMessage}` | adapter 直读 `repair-log.jsonl` |
| "QA 上次给这个 agent 打了什么分？" | `{layer:'L2', kinds:['qa-verdict'], tags:{all:['agent:codegen']}}` | memory 自己存（QA 之前未持久化，新增） |

### 7.5.6 Distillation 扩展（详细见 §8）

新增一个 distill job：**Model fitness aggregation**（L2 model-scorecard → L1 model-routing）。

```
扫所有 generated-code/.ralph/model-leaderboard.jsonl
  → 按 (tier, taskType, stage) 分桶
  → 每桶聚合：mean(score), grade 分布, 主流 model 的 win rate
  → 写 L1 model-routing 记录
```

频率：与 failure-pattern distill 同一个 cron。

---

## 8. Distillation：L2 → L1

### 8.1 触发

- **手动**：`npm run memory:distill` CLI（每周跑一次）。
- **自动**（v2）：项目结束信号 + L2 `self-heal-log` 数 >= 3 时排队。

### 8.2 流程

```
1. 扫 L2 self-heal-log，按 (errorPattern, fixPattern) 聚类
2. 对每个 cluster > 2 条记录的，调 LLM 提炼一条 failure-pattern：
   - 输入：cluster 内的所有 self-heal-log body
   - 输出：标准化的 {symptoms, rootCause, fix, applicableWhen} markdown
3. 查 L1 是否已有 title 高度相似的 failure-pattern：
   - 有 → 提示人工 review 是否合并（v1 不自动合并）
   - 无 → 创建新 L1 record，refs.parentRecordId 指向源 L2 record
4. 同步更新 scaffold-fitness（聚合 L2 的 task-history）
```

### 8.3 distillation prompt

放在 `src/lib/memory/distiller-prompts.ts`。要求 LLM 输出严格 JSON，schema 用 zod 校验。

---

## 9. CLI 设计

```bash
# 只读
npm run memory:list [--layer=L1|L2] [--kind=...] [--limit=20]
npm run memory:show <id>
npm run memory:search "<keyword>"
npm run memory:recall --tags="agent:codegen,taskType:auth" [--layer=both]
npm run memory:trace <kickoffId>           # 这次 kickoff 召回了哪些
npm run memory:stats                        # 总数 / 按 kind 分布 / 命中率 / 最近写入

# 写
npm run memory:add --kind=failure-pattern --file=./pattern.md --tags=...
npm run memory:edit <id>                    # 用 $EDITOR 打开
npm run memory:score <id> <-1..1>           # 人工打分

# 治理
npm run memory:reindex                      # 重建 SQLite 索引
npm run memory:gc --dry-run                 # 清理过期 / 低分记忆
npm run memory:distill [--since=7d]         # 触发 L2→L1
npm run memory:replay <kickoffId> [--snapshot=<isoDate>]
```

实现：`src/lib/memory/cli.ts`，挂在 `package.json` 的 `scripts` 下。

---

## 10. 可观测性

### 10.1 Trace log（每次 recall / save 必打）

```
[memory] op=recall layer=L1 kickoff=K-42 agent=codegen taskId=T-018
  query={kinds:['failure-pattern'],tags:{all:['stack:prisma']}}
  hits=3 ids=[FP-012,FP-031,FP-044] latencyMs=4 injectedTokens=812

[memory] op=save layer=L2 kickoff=K-42 kind=self-heal-log
  id=SH-2026-04-27-pwfly bytes=1247
```

logger 走现有 `src/lib/observability/`。日志可按 kickoff 聚合查询。

### 10.2 Dev UI 面板

复用现有 observability 页：

- 时间线视图：每个 agent step 旁边挂 "🧠 N recalled"，点开看注入的全文。
- 记忆浏览器：按 kind / tag 筛选，看 hits / score / lastUsed。
- "如果没有这条会怎样"按钮：临时 evict 一条，本 session 内不再召回，方便对照实验。

v1 实现"时间线 + 浏览器"，evict 是 v2。

---

## 11. 验证策略

### 11.1 单元测试（Phase A 必跑）

- FileStore CRUD：save/get/update/delete/list 全覆盖。
- 并发写入：10 个 worker 并发 save，零丢失零脏读。
- FTS 召回精度：固定 fixture，断言 top-k 顺序。
- Tag 过滤：`all` / `any` / `none` 组合断言。

### 11.2 缓存命中（Phase B 必跑）

- **黄金集**：20 个固定 brief。
- **流程**：
  1. cold cache 跑一遍，记录每个 brief 的 (cost, latency, classification)。
  2. warm cache 跑一遍，断言：classification 阶段 LLM 调用 = 0；结果与 cold 100% 一致；总 kickoff cost 降幅 ≥ 5%。
- 失败即 fail CI。

### 11.3 召回质量（Phase C 跑）

- **标注集**：`tests/memory/recall-eval.json`，~20 个场景，每个标注 `should_recall` 和 `should_not_recall` 的 record id。
- **指标**：precision@5、recall@5。
- **门槛**：v1 要求 precision@5 ≥ 0.6。

### 11.4 端到端（Phase C 末尾跑）

- **A/B 对照**：5 个 brief，分别在 `MEMORY_ENABLED=false` / `true` 跑。
- **观察指标**：
  - self-heal 触发次数（带 memory 应该更少）
  - 总 cost（USD）
  - 总 duration
  - 最终 e2e pass rate
- **门槛**：5 个 brief 平均 self-heal 次数下降 ≥ 20%。

### 11.5 Replay 回归（Phase D）

- 历史 kickoff 用当时的 memory snapshot 重跑，断言关键 task 输出一致。
- 防止某条新 distill 出来的 pattern 污染下游。

---

## 12. 分阶段交付

| Phase | 范围 | 时长 | 交付物 | 验收 |
|---|---|---|---|---|
| **A** | MemoryStore 抽象 + FileStore + SQLite + CLI 四件套（list/show/search/recall/stats）+ L2 `project-card` / `task-history` / `codebase-map` 接入 orchestrator | ~7 天 | `src/lib/memory/*` + L2 落盘 | 单元测试 100% pass；orchestrator 中断续跑能从 L2 恢复 |
| **B** | L1 `classification` cache 接入 `classifyProject()` | ~3 天 | classifier 内嵌 cache | §11.2 黄金集通过 |
| **C** | L1 `failure-pattern`（手动种子 20 条）+ L2 `self-heal-log` + 注入到 CodeGen / SelfHeal prompt + 简易 distiller | ~7 天 | 注入 wrapper + distiller CLI | §11.3 + §11.4 通过 |
| **D** | `scaffold-fitness` + `agent-tuning` + Replay mode + Dev UI 时间线/浏览器 | ~5 天 | UI panel + replay CLI | UI 可用；replay 一致性测试通过 |

总计：~3.5 周，可单人推进。

---

## 12.5 对现有逻辑的影响 / 风险 / 回滚

### 12.5.1 影响分档

**A. 完全无影响**
- `PRD.md` / `API_CONTRACTS.json` / `SCAFFOLD_SPEC.md` / `TASK_BREAKDOWN_ORIGINAL.md` 等产物：保留不变。
- PRD / Architect / Design / QA 等 agent 的 prompt 与输出 schema：不变。
- `generated-code/` 项目结构（backend / frontend / packages）：不变。
- pipeline 的 gates、scaffold-copy、push-kickoff-repo 等核心流程：不变。
- **现有 `.ralph/` 持久化（model-leaderboard / coding-session-report / repair-log）**：只读适配，写入路径不动。

**B. 行为不变，纯加旁路**
| 改动点 | 改动方式 | 可关停 |
|---|---|---|
| `coding-orchestrator.ts` task 生命周期 | 加 `memory.save(...)`，**fire-and-forget + try/catch** | `MEMORY_ENABLED=false` |
| `self-heal/` 修复成功后 | 加 1 行 save + adapter notify | 同上 |
| `appendScorecardToLeaderboard()` | 末尾加 1 行 `notifyScorecardAppended()` | 同上 |
| `qa-agent.ts` / `verifier-agent.ts` | 评分输出多写一条 memory record | 同上 |
| 新增 `src/lib/memory/*` | 全新目录 | 删目录即可 |

**写入纪律（强制）**：所有 memory 写入失败必须 swallow + log，**绝不能让 task / session 因为记忆写入失败而崩**。code review checklist 必查项。

**C. 行为微变（需 A/B 守门）**
| 改动点 | 行为变化 | 风险 | 缓解 |
|---|---|---|---|
| `classifyProject()` 加 cache | 同 brief 第二次直接返回缓存 | brief 微调命中旧 hash | normalize hash + `--no-cache` flag + `MEMORY_ENABLED=false` |
| `code-gen-agent.ts` prompt 注入 `<memory-context>` | system prompt 末尾加 patterns | (1) token 超限 (2) 模型被无关 pattern 干扰 | (1) §14 Q5 限定 1500 token (2) §11.4 A/B 黄金集守门 |
| `SelfHeal` prompt 注入历史失败模式 | 同上 | 同上 | 同上 |

**D. 基础设施层影响**
| 影响 | 说明 | 工作量 |
|---|---|---|
| 新增依赖 `better-sqlite3` | native，要 `electron-rebuild` | 中 |
| 新增依赖 `proper-lockfile` | 纯 JS | 低 |
| `electron-builder.yml` | `.memory/` 标为 user data，`.node` 文件正确打包 | 低但易遗漏 |
| `.gitignore` | 新增 `.memory/store.sqlite` 等 | 低 |
| 磁盘占用 | 长期累积可能几十 MB | 低，§9 `memory:gc` |

**降级方案**：v1 可先用纯 JSON 索引避开 SQLite 原生依赖；记忆 >200 条再切 SQLite。

### 12.5.2 三层 env 开关

```bash
MEMORY_ENABLED=false        # 总闸：所有 recall 返回 []，所有 save 短路
MEMORY_INJECT=false         # 半关：保留写入观察，但不注入 prompt（最安全的试运行）
MEMORY_CACHE=false          # 单关：禁用 classification cache，其他正常
```

**Phase A 上线时默认 `MEMORY_INJECT=false`**——先只写不读，跑 1-2 周确认数据健康，再开 inject。这是最重要的灰度纪律。

### 12.5.3 风险等级矩阵

| 风险 | 等级 | 触发条件 | 兜底 |
|---|---|---|---|
| memory 写入失败拖崩 task | 🔴 | 写盘 / 锁超时 | try/catch + fire-and-forget（强制） |
| classification cache 返回过期结果 | 🟡 | brief 微调命中旧 hash | normalize + flag |
| 注入 pattern 劣化 codegen 质量 | 🟡 | 召回 pattern 与 task 不匹配 | A/B 黄金集守门 |
| Electron 打包遗漏 native 模块 | 🟡 | 桌面包跑不起来 | electron-rebuild + smoke test |
| Adapter 与原始 JSONL schema 漂移 | 🟡 | `ModelScorecardRow` 字段变更 | adapter 用 zod 校验，schema 不匹配跳过该行 |
| 多 kickoff 并发损坏索引 | 🟢 | 罕见 | lockfile + `memory:reindex` |
| 磁盘膨胀 | 🟢 | 长期 | `memory:gc` |

### 12.5.4 回滚路径

任何阶段出问题，三档退路：

1. **软关闭**：`MEMORY_ENABLED=false` —— recall 返回空、save 短路。退化到接入前。
2. **硬关闭**：`rm -rf .memory/` + `git revert <memory-pr>` —— 彻底回到 0。
3. **半关闭**：`MEMORY_INJECT=false` —— 只写不读，纯观察模式。

回滚不需要触碰 `.ralph/` 任何文件——memory 系统对 `.ralph/` 是只读的，回滚后现有持久化继续工作。

### 12.5.5 灰度计划（Phase A → C 默认配置）

| 阶段 | MEMORY_ENABLED | MEMORY_INJECT | 说明 |
|---|---|---|---|
| Phase A 上线 | true | **false** | 只写 L2，不注入。观察数据健康度 |
| Phase A + 1 周 | true | false | 跑黄金集 §11.2 确认 cache 命中率 |
| Phase B 上线 | true | false | classification cache 启用（cache 不算 inject） |
| Phase C 上线 | true | **true** | A/B §11.4 通过后才开 inject |

---

## 12.6 Phase B（classification cache）的风险与设计决策

> Phase B 引入第一条**真正改变 pipeline 行为**的 memory 路径——同 brief 第二次跳过 LLM 调用直接返回缓存。
> Phase A 是 "只写不读"，最坏只是浪费磁盘；Phase B 是 "读了就用"，错了会污染下游决策。
> 本节锁死 Phase B 的 5 个关键设计决策，避免上线翻车。

### 12.6.1 风险与对应决策

| # | 风险 | 决策 |
|---|---|---|
| **R1** | **缓存污染最难逆转**：一条 buggy 的 classification 缓存会一直命中后续所有同 brief 的 kickoff，直到手动清。L2 错了 `rm -rf <project>/.memory/`，L1 错了影响全局。 | 治理工具齐全 + 灰度纪律：(a) `npm run memory:invalidate-classification [--all\|--brief-hash=...]` (b) Phase B 上线时 `MEMORY_CACHE=false` 灰度（见 §12.6.5） (c) cache 命中时 trace log 必打 `cache-hit` 事件 |
| **R2** | **Hash key 归一化不明确**：`"Build a clock app"` 和 `"build a clock app."` 应该命中同一缓存吗？ | **保守归一化**：仅去首尾空白 + 折叠中间多空白为单空格。**不**做 lowercase / 不去标点 / 不脱中英文标点差异。理由：classifier 是 LLM 调用，对小变化敏感程度比 hash 强；归一化太激进反而误命中。 |
| **R3** | **Prompt / model 升级时旧 cache 静默失效**：`CLASSIFIER_PROMPT` 改了，旧 cache 仍命中，返回与新逻辑不一致的结果。 | Cache key = `sha256(normalize(brief) + "::" + PROMPT_VERSION + "::" + model)`。`PROMPT_VERSION` 是 `classifier.ts` 里的常量字符串，每次改 prompt 必须 bump（review checklist 必查项）。 |
| **R4** | **Fallback 路径不该缓存**：`fallbackClassification()` 是 LLM 输出 JSON parse 失败的降级，缓存它就把降级结果钉死了。 | `classifyProject()` 加 cache wrapper 时，**仅当 LLM 调用 + JSON parse 都成功时写入 cache**。fallback 路径直接返回，不写。 |
| **R5** | **`MEMORY_CACHE` flag 默认值的两难**：默认 true → 用户升级 AgenticBuilder 后立刻就有行为变化；默认 false → 永远没人用上 cache。 | Phase B 合并时**默认 false**（灰度）；跑完 §11.2 黄金集 + 1 周观察期 + 1 次实际项目验证 → 一个独立 PR 把默认改 true（让"开启 cache"变成可独立 review/回滚的事件）。 |

### 12.6.2 Cache key 规范（精确定义）

```ts
// src/lib/agents/shared/project-classifier.ts
const PROMPT_VERSION = "v1-2026-04-28";  // BUMP whenever CLASSIFIER_PROMPT changes

function normalizeBrief(brief: string): string {
  return brief.trim().replace(/\s+/g, " ");
}

function classificationCacheKey(brief: string, model: string): string {
  const payload = `${normalizeBrief(brief)}::${PROMPT_VERSION}::${model}`;
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
```

写入 cache 的 record `id = "CL-" + key`、`tags = ["classifier", "promptVersion:" + PROMPT_VERSION]`，便于 `memory:list --kind=classification` 浏览，便于按 promptVersion 批量清。

### 12.6.3 Cache 写入 / 读取流程

```
classifyProject(brief):
  if (!memoryCacheEnabled()) → 走原逻辑（直接 LLM）

  key = classificationCacheKey(brief, model)
  cached = await getSystemMemory().get("CL-" + key)
  if (cached):
    trace(cache-hit, key)
    return JSON.parse(cached.body) + bumpHit(cached.id)

  trace(cache-miss, key)
  result = await callLLM(...)
  if (jsonParseFailed):
    return fallbackClassification(...)  // 不写 cache (R4)

  void getSystemMemory().save({
    id: "CL-" + key,
    layer: "L1", kind: "classification", source: "cache",
    title: `Classification · ${result.tier} · ${result.type}`,
    body: JSON.stringify({...result, briefHash: key, promptVersion: PROMPT_VERSION}),
    tags: ["classifier", `tier:${result.tier}`, `type:${result.type}`, `promptVersion:${PROMPT_VERSION}`],
    refs: {},
  })
  return result
```

### 12.6.4 失效与治理 CLI（Phase B 必交付）

新增子命令（在现有 `memory:*` 之外）：

```bash
# 列出所有 classification cache（按 promptVersion 分组）
npm run memory:list -- --kind=classification

# 单条清除
npm run memory:invalidate-classification -- --brief-hash=<key>
npm run memory:invalidate-classification -- --id=CL-<key>

# 批量清除某个旧 promptVersion 的所有 cache
npm run memory:invalidate-classification -- --prompt-version=v1-2026-04-28

# 清空所有 classification cache（保留其他记忆）
npm run memory:invalidate-classification -- --all
```

实现：复用 `MemoryStore.list()` + `delete()`，CLI 只是个组合。

### 12.6.5 灰度计划（Phase B）

| 时点 | MEMORY_ENABLED | MEMORY_INJECT | MEMORY_CACHE | 说明 |
|---|---|---|---|---|
| Phase B PR 合并 | true | false | **false** | 代码就位，但 cache 不读不写。零行为变化，仅黄金集测试可手动开 |
| Phase B + 黄金集通过 | true | false | false | §11.2 通过，仍不打开 |
| Phase B + 1 周 + 1 真实项目验证 | true | false | false | 观察 cache key 规范、PROMPT_VERSION 实际表现 |
| Phase B 默认开启 PR | true | false | **true** | 独立 PR，单独 review，单独可回滚 |

**关键纪律**：Phase B 默认 false 期间，验证流程是**手动设 `MEMORY_CACHE=true` 跑黄金集**，不是合并就开。这与 Phase A 的"默认 inject=false 灰度"对称。

### 12.6.6 Phase B 验证清单（覆盖到 R1-R5）

在 §11.2 黄金集基础上额外加：

- [ ] **R1**：注入一条 buggy classification cache（`type: "WRONG"`），跑同 brief 应命中并返回 WRONG → `memory:invalidate-classification` 后再跑应回到 LLM 路径并写入正确结果
- [ ] **R2**：`brief = "Build a clock app"` 和 `brief = "  Build  a  clock  app  "` 必须命中同 cache；和 `"build a clock app."` 必须 **不**命中（保守归一化）
- [ ] **R3**：bump `PROMPT_VERSION` 后，相同 brief cache miss、写入新 record；旧 record 保留
- [ ] **R4**：mock LLM 返回非法 JSON → fallback 触发 → `memory:list --kind=classification` 应**无**新增记录
- [ ] **R5**：`MEMORY_CACHE=false` 时 `recall` 永不命中、`save` 永不写入；切回 true 立即恢复

### 12.6.7 与现有 model-leaderboard 的关系

Phase B 的 classification cache 只关心**输入 → 输出**，不关心 model 性能。它和 `model-leaderboard.jsonl` / `model-routing` 是两件事：

- **Classification cache (L1)** = "这个 brief 该归哪一类" 的缓存（避免 LLM 重复调用）
- **Model routing (L1)** = "这一类项目某个 stage 用哪个 model 性价比最高"（来自跨项目聚合，详见 §7.5.6）

两者都属于 L1，但 cache key、写入触发、失效机制完全独立。Phase B 只做前者，model-routing 是 Phase D。

---

## 13. 演进路径

### 13.1 何时考虑切换到 Graphiti

触发条件（任一满足）：

- L1 `failure-pattern` 数量 > 200，关键词召回精度跌破 0.5。
- 出现明确的图查询需求（"playwright 相关的所有 → 路由到 → vite-config 的所有失败"）。
- 多用户场景出现，需要时序去重 / 实体合并。

切换路径：

1. 实现 `GraphitiStore implements MemoryStore`。
2. 写一个 `npm run memory:export` 把 FileStore 的所有 record 灌入 Graphiti（保留 id）。
3. 通过 env 切换 `MEMORY_BACKEND=graphiti`。
4. 业务代码零改动。

### 13.2 v2 待办

- 自动 distill（不依赖人工触发）
- 向量召回（sqlite-vec）
- 跨用户云端同步
- 记忆质量自动评分（用召回后的 task 成败率反向打分）
- 记忆"过期"机制（stack/version 升级时自动 deprecate）

---

## 14. 待定问题（需 owner 决策）

| Q | 选项 | 倾向 |
|---|---|---|
| Q1: L1 `.memory/` 是否进 git？ | (a) 全 commit (b) 只 commit markdown，索引 ignore (c) 全 ignore | **(b)**——markdown 是知识资产，索引是缓存 |
| Q2: L2 `.memory/` 是否进 generated 项目的 git？ | (a) 进 (b) 不进 | **(a)**——让生成的项目带着记忆走，二次开发也受益 |
| Q3: failure-pattern distill 用哪个 model？ | Haiku 4.5 / Sonnet 4.6 | **Sonnet 4.6**——distill 质量决定上限 |
| Q4: L2 `api-contracts.snapshot.json` 与现有 `generated-code/API_CONTRACTS.json` 关系 | (a) 替代 (b) 共存（snapshot 是历史版本） | **(b)**——避免破坏现有 pipeline |
| Q5: 召回的 token 预算上限？ | 无限 / 800 / 1500 | **1500**——超过截断，按 score 取 top |
| Q6: distillation 触发频率 | 手动 / 项目结束自动 / cron | v1 **手动**，v2 自动 |

---

## 15. 文件清单（Phase A 实现时落地）

```
src/lib/memory/
├── types.ts                          # MemoryRecord / MemoryStore / RecallQuery
├── index.ts                          # getSystemMemory / getProjectMemory
├── file-store.ts                     # FileStore implementation
├── sqlite-index.ts                   # FTS5 索引层
├── recall-config.ts                  # 排序权重
├── schemas/                          # zod schemas per kind
│   ├── classification.ts
│   ├── failure-pattern.ts
│   ├── task-history.ts
│   └── ...
├── inject.ts                         # <memory-context> wrapper
├── trace.ts                          # observability hook
├── cli.ts                            # 所有 npm run memory:* 入口
├── distiller.ts                      # L2 → L1
├── distiller-prompts.ts
└── __tests__/
    ├── file-store.test.ts
    ├── recall.test.ts
    └── concurrency.test.ts
```

orchestrator / agent 改动点：

- `src/lib/agents/shared/project-classifier.ts`：加 cache 包装。
- `src/lib/pipeline/coding-orchestrator.ts`：task 生命周期事件写 L2。
- `src/lib/agents/kickoff/code-gen-agent.ts`：prompt 拼装时 recall + inject。
- `src/lib/pipeline/self-heal/`：成功修复时写 L2 self-heal-log。

---

## 附录 A：MemoryRecord 示例

### A.1 failure-pattern（L1，手写种子）

```markdown
---
id: FP-prisma-migration-parallel
layer: L1
kind: failure-pattern
title: Prisma migration conflicts on parallel branch generation
tags: [stack:prisma, agent:codegen, severity:high]
source: manual
createdAt: 1714161600000
schemaVersion: 1
---

## Symptoms
- `prisma migrate dev` fails with "P3009: migrate found failed migrations"
- Multiple agents generated migrations with overlapping timestamps

## Root cause
并行 task 各自 codegen 出 migration 时未锁 schema 版本。

## Fix
- codegen 前 acquire schema lock
- migration 文件名加入 task id 前缀
- 失败时回退到 `prisma migrate reset` + 重新 apply

## Applicable when
任何使用 Prisma + 并行 task 的 M-tier 以上项目。
```

### A.2 task-history（L2）

```json
{
  "id": "TH-K42-T018",
  "layer": "L2",
  "kind": "task-history",
  "title": "Add JWT auth middleware",
  "tags": ["taskType:auth", "agent:codegen"],
  "source": "orchestrator",
  "refs": { "kickoffId": "K-42", "taskId": "T-018" },
  "body": "{\"status\":\"completed\",\"attempts\":2,\"costUsd\":0.34,\"durationMs\":48211,\"files\":[\"backend/src/middleware/auth.ts\",\"backend/src/routes/auth.ts\"],\"selfHealTriggered\":true,\"selfHealLogId\":\"SH-K42-001\"}",
  "metrics": { "hits": 0 },
  "createdAt": 1714161900000,
  "updatedAt": 1714161948000,
  "schemaVersion": 1
}
```
