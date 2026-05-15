---
{"id":"FP-mined-preflight-route-audit-route-audit-snapshot","layer":"L1","kind":"failure-pattern","title":"preflight-route-audit · route_audit_snapshot","tags":["mined","stage:preflight-route-audit","event:route_audit_snapshot","category:broadcast"],"source":"distill","refs":{},"createdAt":1777369541223,"updatedAt":1777369541223,"schemaVersion":1}
---

# preflight-route-audit — route_audit_snapshot

## What this records
Stage `preflight-route-audit` emitted `route_audit_snapshot` notifications **6** times. This is a **status broadcast** (snapshot, dispatch confirmation, audit-clean, autorepair completion), not a failure to learn from.

## Recommended action
🔴 **Disapprove.** Status broadcasts don't represent avoidable failures.

## Raw stats
- Stage: `preflight-route-audit` · Event: `route_audit_snapshot`
- 6 occurrences across 0 session(s)
- Outcomes: fixed=0, progress=0, gave_up=0, other=6

