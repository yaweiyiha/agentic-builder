# E2E Triage report

- First run failures: **1**
- Second run: skipped (single-run triage).
- Classified: **0 deterministic**, **0 flaky**, **1 infra**, **0 self-healed on retry**

Only deterministic failures are sent to the LLM fix prompt. Flaky / infra failures are logged here and **not** passed to auto-repair — rewriting code on a flake is worse than leaving it alone.

## Deterministic failures (fed to auto-repair)

_(none)_

## Flaky failures (skipped — retry gave a different result)

_(none)_

## Infra failures (skipped — network/environment, not a code bug)

- **__infra__**
  - signature: `infra: ECONNREFUSED`

## Self-healed on retry (skipped — retry passed)

_(none)_

