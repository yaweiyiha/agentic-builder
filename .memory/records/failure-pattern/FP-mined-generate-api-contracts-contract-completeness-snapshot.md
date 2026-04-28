---
{"id":"FP-mined-generate-api-contracts-contract-completeness-snapshot","layer":"L1","kind":"failure-pattern","title":"generate_api_contracts · contract_completeness_snapshot","tags":["mined","stage:generate_api_contracts","event:contract_completeness_snapshot","category:broadcast"],"source":"distill","refs":{},"createdAt":1777369541220,"updatedAt":1777369541220,"schemaVersion":1}
---

# generate_api_contracts — contract_completeness_snapshot

## What this records
Stage `generate_api_contracts` emitted `contract_completeness_snapshot` notifications **7** times. This is a **status broadcast** (snapshot, dispatch confirmation, audit-clean, autorepair completion), not a failure to learn from.

## Recommended action
🔴 **Disapprove.** Status broadcasts don't represent avoidable failures.

## Raw stats
- Stage: `generate_api_contracts` · Event: `contract_completeness_snapshot`
- 7 occurrences across 0 session(s)
- Outcomes: fixed=0, progress=0, gave_up=0, other=7

