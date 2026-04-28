---
{"id":"FP-mined-preflight-contract-completeness-contract-completeness-snapshot","layer":"L1","kind":"failure-pattern","title":"preflight-contract-completeness · contract_completeness_snapshot","tags":["mined","stage:preflight-contract-completeness","event:contract_completeness_snapshot","category:broadcast"],"source":"distill","refs":{},"createdAt":1777369541230,"updatedAt":1777369541230,"schemaVersion":1}
---

# preflight-contract-completeness — contract_completeness_snapshot

## What this records
Stage `preflight-contract-completeness` emitted `contract_completeness_snapshot` notifications **5** times. This is a **status broadcast** (snapshot, dispatch confirmation, audit-clean, autorepair completion), not a failure to learn from.

## Recommended action
🔴 **Disapprove.** Status broadcasts don't represent avoidable failures.

## Raw stats
- Stage: `preflight-contract-completeness` · Event: `contract_completeness_snapshot`
- 5 occurrences across 0 session(s)
- Outcomes: fixed=0, progress=0, gave_up=0, other=5

