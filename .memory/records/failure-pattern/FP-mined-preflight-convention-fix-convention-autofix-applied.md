---
{"id":"FP-mined-preflight-convention-fix-convention-autofix-applied","layer":"L1","kind":"failure-pattern","title":"preflight-convention-fix · convention_autofix_applied","tags":["mined","stage:preflight-convention-fix","event:convention_autofix_applied","category:broadcast"],"source":"distill","refs":{},"createdAt":1777369541212,"updatedAt":1777369541212,"schemaVersion":1}
---

# preflight-convention-fix — convention_autofix_applied

## What this records
Stage `preflight-convention-fix` emitted `convention_autofix_applied` notifications **12** times. This is a **status broadcast** (snapshot, dispatch confirmation, audit-clean, autorepair completion), not a failure to learn from.

## Recommended action
🔴 **Disapprove.** Status broadcasts don't represent avoidable failures.

## Raw stats
- Stage: `preflight-convention-fix` · Event: `convention_autofix_applied`
- 12 occurrences across 0 session(s)
- Outcomes: fixed=0, progress=0, gave_up=0, other=12

