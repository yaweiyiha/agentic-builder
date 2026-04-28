---
{"id":"FP-mined-worker-context-worker-context-trimmed","layer":"L1","kind":"failure-pattern","title":"worker-context · worker_context_trimmed","tags":["mined","stage:worker-context","event:worker_context_trimmed","category:broadcast"],"source":"distill","refs":{},"createdAt":1777369541242,"updatedAt":1777369541242,"schemaVersion":1}
---

# worker-context — worker_context_trimmed

## What this records
Stage `worker-context` emitted `worker_context_trimmed` notifications **3** times. This is a **status broadcast** (snapshot, dispatch confirmation, audit-clean, autorepair completion), not a failure to learn from.

## Recommended action
🔴 **Disapprove.** Status broadcasts don't represent avoidable failures.

## Raw stats
- Stage: `worker-context` · Event: `worker_context_trimmed`
- 3 occurrences across 0 session(s)
- Outcomes: fixed=0, progress=0, gave_up=0, other=3

