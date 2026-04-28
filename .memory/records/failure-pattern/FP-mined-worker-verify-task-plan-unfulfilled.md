---
{"id":"FP-mined-worker-verify-task-plan-unfulfilled","layer":"L1","kind":"failure-pattern","title":"worker-verify · task_plan_unfulfilled","tags":["mined","stage:worker-verify","event:task_plan_unfulfilled","ext:ts","ext:tsx","ext:json","ext:js","ext:yml"],"source":"distill","refs":{},"createdAt":1777358679429,"updatedAt":1777358679429,"schemaVersion":1}
---

# worker-verify — task_plan_unfulfilled

## Symptoms
No structured reasons captured. Self-heal stage `worker-verify` triggered `task_plan_unfulfilled` repeatedly.

## Pattern
- Stage: `worker-verify`
- Event: `task_plan_unfulfilled`
- File types touched: `.ts`, `.tsx`, `.json`, `.js`, `.yml`

## Frequency
- 29 occurrences across 0 session(s)
- Outcomes: fixed=0, progress=0, gave_up=0, other=29

## Status
Mined automatically from repair-log. Default score = 0 (Layer 3 shadow). Approve via `npm run memory:approve <id>` or wait for outcome attribution to promote it.

