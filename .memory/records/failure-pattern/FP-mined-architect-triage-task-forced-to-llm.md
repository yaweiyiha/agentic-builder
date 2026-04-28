---
{"id":"FP-mined-architect-triage-task-forced-to-llm","layer":"L1","kind":"failure-pattern","title":"architect-triage · Task references 10 file(s) outside the scaffold's protected…","tags":["mined","stage:architect-triage","event:task_forced_to_llm","ext:ts","ext:env","ext:yml","ext:js","ext:sql"],"source":"distill","refs":{},"createdAt":1777358679432,"updatedAt":1777358679432,"schemaVersion":1}
---

# architect-triage — task_forced_to_llm

## Symptoms
Recurring reasons observed in self-heal events:

- (×3) Task references 10 file(s) outside the scaffold's protected paths — real work must be generated.
- (×3) Task references 15 file(s) outside the scaffold's protected paths — real work must be generated.
- (×2) Task references 13 file(s) outside the scaffold's protected paths — real work must be generated.

## Pattern
- Stage: `architect-triage`
- Event: `task_forced_to_llm`
- File types touched: `.ts`, `.env`, `.yml`, `.js`, `.sql`

## Frequency
- 18 occurrences across 0 session(s)
- Outcomes: fixed=0, progress=0, gave_up=0, other=18

## Sample task titles
- Setup database schema and Sequelize models for records
- Setup database models and validation schemas
- Setup database models and API contracts

## Status
Mined automatically from repair-log. Default score = 0 (Layer 3 shadow). Approve via `npm run memory:approve <id>` or wait for outcome attribution to promote it.

