---
{"id":"FP-mined-preflight-deps-import-gaps-installed","layer":"L1","kind":"failure-pattern","title":"preflight-deps · import_gaps_installed","tags":["mined","stage:preflight-deps","event:import_gaps_installed","category:broadcast"],"source":"distill","refs":{},"createdAt":1777369541235,"updatedAt":1777369541235,"schemaVersion":1}
---

# preflight-deps — import_gaps_installed

## What this records
Stage `preflight-deps` emitted `import_gaps_installed` notifications **4** times. This is a **status broadcast** (snapshot, dispatch confirmation, audit-clean, autorepair completion), not a failure to learn from.

## Recommended action
🔴 **Disapprove.** Status broadcasts don't represent avoidable failures.

## Raw stats
- Stage: `preflight-deps` · Event: `import_gaps_installed`
- 4 occurrences across 0 session(s)
- Outcomes: fixed=0, progress=0, gave_up=0, other=4

