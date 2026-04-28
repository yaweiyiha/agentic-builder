---
{"id":"FP-mined-architect-triage-task-forced-to-llm","layer":"L1","kind":"failure-pattern","title":"architect-triage · Task references 10 file(s) outside the scaffold's protected…","tags":["mined","stage:architect-triage","event:task_forced_to_llm","category:real-failure","ext:ts","ext:env","ext:yml","ext:js","ext:sql"],"source":"distill","refs":{},"createdAt":1777369541201,"updatedAt":1777369541201,"schemaVersion":1}
---

# architect-triage — task_forced_to_llm

## What this records
Stage `architect-triage` triggered `task_forced_to_llm` **20** times across 0 session(s).

## Symptoms
Top reasons captured in past events:

- (×3) Task references 10 file(s) outside the scaffold's protected paths — real work must be generated.
- (×3) Task references 15 file(s) outside the scaffold's protected paths — real work must be generated.
- (×2) Task references 13 file(s) outside the scaffold's protected paths — real work must be generated.

## How to avoid (FILL IN)
> ⚠️ This section is the actual content the LLM will see. Write specific, actionable guidance:
>
> - Describe the trigger condition (e.g., "when task references files outside scaffold protected paths")
> - Give the prevention rule (e.g., "check `scaffolds/<tier>/` before listing creates")
> - Mention any task-type / stack signals that flag this pattern

## Recommended action
🟢 **Edit "How to avoid" with project-specific guidance, then Approve.** 20 occurrences indicate this is a real recurring problem.

## Sample task titles
- Setup database schema and Sequelize models for records
- Setup database models and validation schemas
- Setup database models and API contracts

## Raw stats
- Stage: `architect-triage` · Event: `task_forced_to_llm`
- 20 occurrences across 0 session(s)
- Outcomes: fixed=0, progress=0, gave_up=0, other=20
- File types touched: `.ts`, `.env`, `.yml`, `.js`, `.sql`

