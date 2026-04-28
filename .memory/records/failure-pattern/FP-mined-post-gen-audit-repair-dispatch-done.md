---
{"id":"FP-mined-post-gen-audit-repair-dispatch-done","layer":"L1","kind":"failure-pattern","title":"post-gen-audit · repair_dispatch_done","tags":["mined","stage:post-gen-audit","event:repair_dispatch_done"],"source":"distill","refs":{},"createdAt":1777358679440,"updatedAt":1777358679440,"schemaVersion":1}
---

# post-gen-audit — repair_dispatch_done

## Symptoms
No structured reasons captured. Self-heal stage `post-gen-audit` triggered `repair_dispatch_done` repeatedly.

## Pattern
- Stage: `post-gen-audit`
- Event: `repair_dispatch_done`

## Frequency
- 9 occurrences across 0 session(s)
- Outcomes: fixed=0, progress=0, gave_up=0, other=9

## Status
Mined automatically from repair-log. Default score = 0 (Layer 3 shadow). Approve via `npm run memory:approve <id>` or wait for outcome attribution to promote it.

