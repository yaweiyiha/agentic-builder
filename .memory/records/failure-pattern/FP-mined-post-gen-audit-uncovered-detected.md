---
{"id":"FP-mined-post-gen-audit-uncovered-detected","layer":"L1","kind":"failure-pattern","title":"post-gen-audit · uncovered_detected","tags":["mined","stage:post-gen-audit","event:uncovered_detected","category:ambiguous"],"source":"distill","refs":{},"createdAt":1777369541214,"updatedAt":1777369541214,"schemaVersion":1}
---

# post-gen-audit — uncovered_detected

## What this records
Stage `post-gen-audit` emitted `uncovered_detected` **11** times. The cluster lacks clear classification signals (no rich reasons, no fix/give-up split, no obvious failure keyword in the event name).

## Recommended action
🟡 **Review manually based on your knowledge of this stage:**
- If it's a recovery / notification — **Disapprove**
- If it's a real failure the LLM could avoid — **Edit `How to avoid` (add the section), then Approve**
- Otherwise — **Disapprove** for now; revisit when richer event data accumulates

## Raw stats
- Stage: `post-gen-audit` · Event: `uncovered_detected`
- 11 occurrences across 0 session(s)
- Outcomes: fixed=0, progress=0, gave_up=0, other=11

