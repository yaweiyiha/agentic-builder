---
{"id":"FP-mined-integration-gate-frontend-api-client-uniqueness-snapshot","layer":"L1","kind":"failure-pattern","title":"integration-gate · frontend_api_client_uniqueness_snapshot","tags":["mined","stage:integration-gate","event:frontend_api_client_uniqueness_snapshot","category:broadcast"],"source":"distill","refs":{},"createdAt":1777369541236,"updatedAt":1777369541236,"schemaVersion":1}
---

# integration-gate — frontend_api_client_uniqueness_snapshot

## What this records
Stage `integration-gate` emitted `frontend_api_client_uniqueness_snapshot` notifications **4** times. This is a **status broadcast** (snapshot, dispatch confirmation, audit-clean, autorepair completion), not a failure to learn from.

## Recommended action
🔴 **Disapprove.** Status broadcasts don't represent avoidable failures.

## Raw stats
- Stage: `integration-gate` · Event: `frontend_api_client_uniqueness_snapshot`
- 4 occurrences across 0 session(s)
- Outcomes: fixed=0, progress=0, gave_up=0, other=4

