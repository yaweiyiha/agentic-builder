/**
 * Smoke test for `src/lib/langgraph/e2e-triage.ts`.
 *
 * Drives the triage classifier against realistic Playwright console output
 * captured from an actual run, including yesterday's failing E2E-002 /
 * E2E-005 case (the one that motivated the triage design).
 *
 * Run with:  npx tsx scripts/smoke-e2e-triage.ts
 */

import {
  triageE2eFailures,
  parsePlaywrightFailures,
  hasInfraSignal,
} from "../src/lib/langgraph/e2e-triage";

let totalAssertions = 0;
let failedAssertions = 0;

function assert(name: string, cond: boolean, detail?: unknown): void {
  totalAssertions++;
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failedAssertions++;
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n── ${title} ──────────────────────────────────────────`);
}

// ─── Case 1 — real "E2E-002/005 both fail" output from yesterday ─────────

section("Case 1: two failures, deterministic on both runs");

const firstRunBothFail = `
  Running 7 tests using 4 workers

  1) [chromium] › e2e/home.spec.ts:25:3 › Home Page - Record Entry and Display › E2E-002 — Submit valid record successfully

     Error: expect(locator).toBeDisabled() failed
     Locator:  getByRole('button', { name: 'Submit' })
     Expected: disabled
     Received: enabled
     Timeout:  10000ms

  2) [chromium] › e2e/home.spec.ts:119:3 › Home Page - Record Entry and Display › E2E-005 — Retry failed record loading

     Error: expect(locator).toBeVisible() failed
     Locator:  locator('text=Loading').first()
     Expected: visible
     Timeout:  10000ms

  2 failed
    [chromium] › e2e/home.spec.ts:25:3 › Home Page - Record Entry and Display › E2E-002 — Submit valid record successfully
    [chromium] › e2e/home.spec.ts:119:3 › Home Page - Record Entry and Display › E2E-005 — Retry failed record loading
  5 passed (29.3s)
`;

const secondRunBothFail = firstRunBothFail; // identical errors on retry

{
  const failures = parsePlaywrightFailures(firstRunBothFail);
  assert("parse extracts 2 failures", failures.length === 2, {
    got: failures.map((f) => f.name),
  });
  assert(
    "first failure is E2E-002",
    failures[0]?.name.includes("E2E-002"),
    failures[0]?.name,
  );
  assert(
    "second failure is E2E-005",
    failures[1]?.name.includes("E2E-005"),
    failures[1]?.name,
  );
  assert(
    "project parsed as chromium",
    failures[0]?.project === "chromium",
    failures[0]?.project,
  );
  assert(
    "error signature non-empty",
    (failures[0]?.errorSignature?.length ?? 0) > 10,
    failures[0]?.errorSignature,
  );

  const triage = triageE2eFailures({
    firstRunOutput: firstRunBothFail,
    firstRunExitCode: 1,
    secondRunOutput: secondRunBothFail,
    secondRunExitCode: 1,
  });
  assert("two deterministic failures", triage.deterministic.length === 2);
  assert("zero flaky", triage.flaky.length === 0);
  assert("zero infra", triage.infra.length === 0);
  assert("zero self-healed", triage.selfHealed.length === 0);
  assert(
    "summary line looks right",
    triage.summary.includes("2 deterministic") &&
      triage.summary.includes("0 flaky"),
    triage.summary,
  );
  assert(
    "report mentions deterministic tests",
    triage.report.includes("E2E-002") && triage.report.includes("E2E-005"),
    triage.report.slice(0, 300),
  );
}

// ─── Case 2 — flake (failed first run, passed retry) ─────────────────────

section("Case 2: first run fails, retry passes → self-healed flake");

const retryPassed = `
  Running 7 tests using 4 workers

  7 passed (28.1s)
`;

{
  const triage = triageE2eFailures({
    firstRunOutput: firstRunBothFail,
    firstRunExitCode: 1,
    secondRunOutput: retryPassed,
    secondRunExitCode: 0,
  });
  assert("zero deterministic", triage.deterministic.length === 0);
  assert("zero flaky", triage.flaky.length === 0);
  assert(
    "two self-healed (E2E-002 + E2E-005)",
    triage.selfHealed.length === 2,
  );
  assert(
    "report acknowledges self-healing",
    triage.report.toLowerCase().includes("self-healed"),
    triage.report.slice(0, 300),
  );
}

// ─── Case 3 — same test fails both times but with different error ────────

section("Case 3: same test fails both runs, different signature → flaky");

const firstRunA = `
  1) [chromium] › e2e/home.spec.ts:25:3 › Home Page › E2E-002 — Submit valid record successfully

     Error: expect(locator).toBeDisabled() failed
     Received: enabled

  1 failed
    [chromium] › e2e/home.spec.ts:25:3 › Home Page › E2E-002 — Submit valid record successfully
  6 passed (12.0s)
`;

const firstRunB = `
  1) [chromium] › e2e/home.spec.ts:25:3 › Home Page › E2E-002 — Submit valid record successfully

     Error: expect(locator).toHaveValue('') failed
     Received: "Test"

  1 failed
    [chromium] › e2e/home.spec.ts:25:3 › Home Page › E2E-002 — Submit valid record successfully
  6 passed (12.0s)
`;

{
  const triage = triageE2eFailures({
    firstRunOutput: firstRunA,
    firstRunExitCode: 1,
    secondRunOutput: firstRunB,
    secondRunExitCode: 1,
  });
  assert("zero deterministic", triage.deterministic.length === 0);
  assert("one flaky", triage.flaky.length === 1);
  assert("zero infra", triage.infra.length === 0);
}

// ─── Case 4 — infra signal short-circuit ─────────────────────────────────

section("Case 4: ECONNREFUSED in output → infra");

const infraOutput = `
  Running 7 tests using 4 workers

  Error: connect ECONNREFUSED 127.0.0.1:3000

  Error: Target page, context or browser has been closed

  7 failed
`;

{
  assert("hasInfraSignal detects ECONNREFUSED", hasInfraSignal(infraOutput));
  assert("hasInfraSignal rejects clean output", !hasInfraSignal(retryPassed));

  // Infra on first run alone — caller would NOT run a second pass.
  const triage = triageE2eFailures({
    firstRunOutput: infraOutput,
    firstRunExitCode: 1,
  });
  assert(
    "at least one infra failure",
    triage.infra.length >= 1,
    triage.infra.map((r) => r.name),
  );
  assert("zero deterministic", triage.deterministic.length === 0);
}

// ─── Case 5 — no retry → conservative deterministic ──────────────────────

section("Case 5: no retry output → all failures treated as deterministic");

{
  const triage = triageE2eFailures({
    firstRunOutput: firstRunBothFail,
    firstRunExitCode: 1,
  });
  // Without a retry we can't tell flake from bug; we prefer deterministic
  // (caller still decides whether to invoke the LLM).
  assert("two deterministic", triage.deterministic.length === 2);
  assert("zero flaky", triage.flaky.length === 0);
  assert(
    "report notes no retry",
    triage.report.includes("Second run: skipped"),
    triage.report.slice(0, 400),
  );
}

// ─── Case 6 — mixed: one deterministic, one self-healed ──────────────────

section("Case 6: mixed — E2E-002 deterministic, E2E-005 self-healed");

const retryOnlyE2E002 = `
  1) [chromium] › e2e/home.spec.ts:25:3 › Home Page - Record Entry and Display › E2E-002 — Submit valid record successfully

     Error: expect(locator).toBeDisabled() failed
     Locator:  getByRole('button', { name: 'Submit' })

  1 failed
    [chromium] › e2e/home.spec.ts:25:3 › Home Page - Record Entry and Display › E2E-002 — Submit valid record successfully
  6 passed (15.2s)
`;

{
  const triage = triageE2eFailures({
    firstRunOutput: firstRunBothFail,
    firstRunExitCode: 1,
    secondRunOutput: retryOnlyE2E002,
    secondRunExitCode: 1,
  });
  assert(
    "one deterministic (E2E-002)",
    triage.deterministic.length === 1 &&
      triage.deterministic[0].name.includes("E2E-002"),
    triage.deterministic.map((r) => r.name),
  );
  assert(
    "one self-healed (E2E-005)",
    triage.selfHealed.length === 1 &&
      triage.selfHealed[0].name.includes("E2E-005"),
    triage.selfHealed.map((r) => r.name),
  );
  assert("zero flaky", triage.flaky.length === 0);
  assert("zero infra", triage.infra.length === 0);
}

// ─── summary ─────────────────────────────────────────────────────────────

console.log("\n────────────────────────────────────────────────────────");
if (failedAssertions === 0) {
  console.log(
    `✓ All ${totalAssertions} assertions passed.`,
  );
  process.exit(0);
} else {
  console.log(
    `✗ ${failedAssertions}/${totalAssertions} assertion(s) failed.`,
  );
  process.exit(1);
}
