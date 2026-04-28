---
{"id":"FP-mined-post-gen-audit-audit-clean","layer":"L1","kind":"failure-pattern","title":"post-gen-audit · audit_clean","tags":["mined","stage:post-gen-audit","event:audit_clean","category:broadcast"],"source":"distill","refs":{},"createdAt":1777369541218,"updatedAt":1777369541218,"schemaVersion":1}
---

# post-gen-audit — audit_clean

## What this records
Stage `post-gen-audit` emitted `audit_clean` notifications **7** times. This is a **status broadcast** (snapshot, dispatch confirmation, audit-clean, autorepair completion), not a failure to learn from.

## Recommended action
🔴 **Disapprove.** Status broadcasts don't represent avoidable failures.

## Raw stats
- Stage: `post-gen-audit` · Event: `audit_clean`
- 7 occurrences across 0 session(s)
- Outcomes: fixed=0, progress=0, gave_up=0, other=7

