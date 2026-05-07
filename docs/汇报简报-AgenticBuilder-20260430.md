# AgenticBuilder 阶段性进展汇报简报

**适用日期**：____ 年 __ 月 __ 日（可自行填写）  
**汇报人 / 团队**：____________  

**文档用途**：对内/对上同步近期研发进展（偏重 2026-04-27～2026-04-29 密集交付）  
**建议汇报时长**：10～15 分钟（可按听众删减小节）  
**详细设计**：见仓库根目录 [`MEMORY_SYSTEM_DESIGN.md`](../MEMORY_SYSTEM_DESIGN.md)（v2.0，与代码对齐）

---

## 1. 一句话摘要

在近期迭代中，我们完成了三件相互支撑的事情：**① 端到端编码流水线的可调优与可恢复**（防死循环、任务重试、检查点）；**② 面向「失败—学习—再注入」的工程化记忆闭环**（L1/L2、召回注入、归因、Mining、Dashboard、A/B 对比）；**③ 产品与可观测层面的加固**（独立报告页、PRD PDF 导入、会话评分与会话历史、外部多 API 任务拆解规则落地）。整体上，系统在 **稳定性、可追溯性、可复制改进** 三个维度都有可交付的增量。

---

## 2. 近期交付按主题汇总

### 2.1 记忆系统（Memory）— Phase A～C 已落地

| 维度 | 内容 |
|------|------|
| **架构** | 两层记忆：**L1 系统记忆**（`.memory/` 跨项目）与 **L2 项目记忆**（各 generated 项目下）；三层注入：**Active / Shadow / Deprecated**，由 `metrics.score` 与标签驱动；支持 `manual:approved` **人工免检**通道。 |
| **工程** | FileStore、`memory-cli`、`event-bridge`、与流水线/编码路由对接；Vitest 单测覆盖；`.ralph` / `.agentic-snapshot` 等路径与 git 策略调整，便于审计与归档。 |
| **召回与 UI** | 在图编排侧接入 **recall 注入**；新增 **`/memory` 看板**（筛选、详情、建议）；REST：**列表/详情、approve、disapprove**。 |
| **Mining** | **规则化挖掘**失败模式到 Markdown 模版；脚本 `memory-mine-patterns`；多篇 `FP-mined-*` 记录可被审阅与迭代。 |
| **归因闭环（Outcome Attribution）** | 注入若带来任务成功 **+0.05**、失败 **-0.10**（`manual:approved` 永久免疫不归因）；幂等指针 `.attribution-cursor.json`；**`POST /api/memory/attribute`** 与 **`scripts/memory-attribute.ts`** CLI。Mining 输出按 **四类性质**分类（success-metric / broadcast / real-failure / ambiguous），UI **四色推荐条**区分建议动作。 |
| **A/B 与质量** | `scripts/memory-ab-compare.ts` 对比两组 `.ralph/` 产出（成本、时长、自愈触发、会话分等）；`tests/memory/ab-golden-set.json` 金标集合；与设计文档同步为 **v2.0 实拍版**。 |

**价值表述（给管理层）**：把以往散落在日志里的经验，升级为 **可查、可批、可归因、可对比** 的资产，缩短「同类问题反复消耗 token / 工时」的路径。

---

### 2.2 编码流水线与 Supervisor / Task 策略

| 项 | 说明 |
|----|------|
| **Anti-spiral（防工具循环失控）** | 提高单次 worker 工具轮次上限（如 6→10），在中间轮次 **温和提示**，在后段 **强制写入**，兼顾复杂流水线（聚合、扫描类）的读写预算。 |
| **会话检查点（Checkpoint）** | 新增 `session-checkpoint` 与 **`GET/DELETE /api/agents/coding/checkpoint`**，前端可加载/清空上一轮任务结果视图。 |
| **失败任务重试** | Store 侧 **retryFailedTasks**；新一次全量跑前 **删除陈旧 checkpoint**，避免 Retry 读到过期数据；**仅当会话已结束且失败任务仍存在**时展示 Retry。 |
| **任务拆解规则** | 在 task-breakdown 中强化：**多外部 HTTP API 的管线必须拆解**（客户端层 / 编排 / 流式等子任务）；**单任务每域 Soft cap（≤4 文件）**。与后续 kickoff MR 中的 **external-API CRITICAL** 段落、M-tier Bad/Good 示例联动。 |

---

### 2.3 Kickoff 与会话产物同步

- 将 **multi-API 管线强制拆解**写入系统提示与脚手架阶段指南的近顶 **CRITICAL** 区（BAD/GOOD 示例），减少「一个巨型任务扛起整条链」的失败率。  
- 同步 **`.ralph` 会话报告、scorecard / leaderboard Markdown、report history**。  
- 持久化 **last-coding-session checkpoint**；在 `.memory/records/` 下增补分类记忆等；清理过期 snapshot / 锁住依赖（如 lockfile）。

---

### 2.4 报表、导入与评分

| 项 | 说明 |
|----|------|
| **`/reports` 专属页** | 会话历史侧边栏 + 报告 Tab；导航入口。 |
| **PRD 导入** | `ImportPrdDialog` 支持 **PDF**，配合 `pdf.worker` 抽取正文。 |
| **模型记分与历史** | 报告 API 扩展返回 **scorecard / leaderboard Markdown**；跨会话「排行榜」可追溯。 |
| **Feature checklist（IC-xx）** | 交互组件类条目从 **硬门禁改为软告警**；评分侧 **不再因 IC-xx 扣综合分**，避免与设计稿未定稿阶段过度绑定。 |

*说明：会话综合分计算器另有 **v2**（按比例 E2E、infra 减负、完成度奖励、公式可追溯），与设计文档 §7.x 可对齐。*

---

### 2.5 LLM Provider 重构

- 抽象/整理 **Provider 架构**，接入 **DeepSeek V4 Pro** 等兼容路由，为多模型打分与回放实验打底。

---

## 3. 主要成果（适合口头汇报）

1. **记忆从「单机文件」升级为可运营模块**：Mining → Dashboard 审批 → 运行时注入 → 结果归因闭环，并形成 A/B 工具链。  
2. **流水线在「长尾复杂任务」上更抗造**：轮次上限与分级干预、检查点与重试语义清晰，利于排障和用户心智对齐。  
3. **产品与报告侧更清晰**：专用报告页、PDF PRD、IC-xx 软门策略与评分一致化，减少对「未定稿交互」的假性失败惩罚。  
4. **Kickoff/M-tier 的工程纪律写进 Prompt**：外部 API 类项目默认按层拆解，对齐真实软件架构实践。

---

## 4. 风险、假设与下一步（可选 Discuss）

| 类型 | 内容 |
|------|------|
| **假设** | 记忆归因系数（±0.05 / ±0.10）需在更多真实项目上观测后微调；Mining 类目规则可能需按业务域扩展。 |
| **风险** | L1/L2 量纲增大后的 **磁盘与 git diff 噪音**；需坚持「金标集合 + A/B」控回归。 |
| **下一步（示例）** | Phase D：`MEMORY_SYSTEM_DESIGN` 已标注的未完成 kind（向量、Graphiti 等）择机评估；将 A/B 纳入例行发布前流水线；Recall 覆盖率与误判率在看板指标化。 |

---

## 5. Q&A 备料（简述）

| 可能被问 | 建议答法要点 |
|-----------|----------------|
| 「记忆和向量库冲突吗？」 | 当前 deliberately **不走向量**：FTS + 标签已覆盖前两百条量级；大图谱/语义合并标注为后置。 |
| 「分数还有没有公信力？」 | 综合分服务于**会话健康度叙事**；重大事项仍看门禁通过、triage、e2e 比例与审计是否覆盖。 |
| 「商业上带来什么？」 | 缩短同类故障重复成本；多项目经验复用到 **第 N+1 个项目**的起跑线。 |

---

**版本**：草稿 v1，`git` 基线请以汇报当日主干为准；若要替换「汇报人/部门/日期」，请直接修改本页首段元信息字段。
