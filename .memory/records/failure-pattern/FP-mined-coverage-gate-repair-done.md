---
{"id":"FP-mined-coverage-gate-repair-done","layer":"L1","kind":"failure-pattern","title":"coverage-gate · repair_done","tags":["mined","stage:coverage-gate","event:repair_done","category:success-metric"],"source":"distill","refs":{},"createdAt":1777369541203,"updatedAt":1777428490117,"schemaVersion":1}
---

# coverage-gate — repair_done

## What this records
Self-heal **successfully repaired** `coverage-gate` issues in **12 of 15** attempts. This is a **recovery metric**, not a failure pattern.

## Recommended action
🔴 **Disapprove or Delete.** Recovery metrics don't teach the LLM how to avoid anything — they describe the self-heal system working as designed. Injecting this would waste prompt budget without actionable advice.

## Raw stats
- Stage: `coverage-gate` · Event: `repair_done`
- 15 occurrences across 0 session(s)
- Outcomes: fixed=12, progress=2, gave_up=0, other=1

