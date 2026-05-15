---
{"id":"FP-mined-post-gen-audit-repair-dispatch-role-done","layer":"L1","kind":"failure-pattern","title":"post-gen-audit · repair_dispatch_role_done","tags":["mined","stage:post-gen-audit","event:repair_dispatch_role_done","category:broadcast"],"source":"distill","refs":{},"createdAt":1777369541207,"updatedAt":1777369541207,"schemaVersion":1}
---

# post-gen-audit — repair_dispatch_role_done

## What this records
Stage `post-gen-audit` emitted `repair_dispatch_role_done` notifications **15** times. This is a **status broadcast** (snapshot, dispatch confirmation, audit-clean, autorepair completion), not a failure to learn from.

## Recommended action
🔴 **Disapprove.** Status broadcasts don't represent avoidable failures.

## Raw stats
- Stage: `post-gen-audit` · Event: `repair_dispatch_role_done`
- 15 occurrences across 0 session(s)
- Outcomes: fixed=0, progress=0, gave_up=0, other=15

