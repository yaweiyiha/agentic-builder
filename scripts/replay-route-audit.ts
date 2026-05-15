/**
 * Replay harness for the route-audit codemods (R10 + R11).
 *
 * Points at an existing generated-code/ snapshot and runs the same
 * preflight sequence the supervisor runs:
 *
 *   audit  →  auto-repair  →  audit (after)
 *
 * Prints the before/after diff so you can validate route-audit-autofix
 * changes against a real failure state in ~10s, without re-running the
 * 2-hour pipeline.
 *
 * Usage:
 *   pnpm exec tsx scripts/replay-route-audit.ts [outputDir]
 *
 * outputDir defaults to `./generated-code` (the local pipeline output).
 *
 * The script does NOT call any LLM, does NOT touch git, and DOES modify
 * the generated index.ts file in-place (same as the preflight would).
 * To re-run from the same starting point, restore index.ts from git or
 * a backup before each replay.
 */

import path from "path";
import fs from "fs/promises";
import {
  auditApiRouteRegistration,
  autoRepairRouteRegistration,
  type RouteRegistrationAudit,
} from "../src/lib/langgraph/supervisor";

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  dim: "\x1b[2m",
};

function header(label: string): void {
  console.log(`\n${C.bold}${C.blue}── ${label} ──${C.reset}`);
}

function summariseAudit(label: string, a: RouteRegistrationAudit): void {
  const flagBad = (n: number) => (n > 0 ? `${C.red}${n}${C.reset}` : `${C.green}${n}${C.reset}`);
  const flagWarn = (n: number) => (n > 0 ? `${C.yellow}${n}${C.reset}` : `${C.green}${n}${C.reset}`);
  console.log(
    `  ${C.bold}${label}${C.reset}: ` +
      `unregistered=${flagBad(a.unregisteredModules.length)} ` +
      `unresolvedImports=${flagBad(a.unresolvedRegistrations.length)} ` +
      `missingContracts=${flagBad(a.missingContractEndpoints.length)} ` +
      `undeclaredImpl=${flagWarn(a.undeclaredEndpoints.length)} ` +
      `apiPrefix=${C.bold}${a.apiRouterPrefix}${C.reset}`,
  );
  if (a.unregisteredModules.length > 0) {
    console.log(`  ${C.dim}unregisteredModules:${C.reset}`);
    for (const m of a.unregisteredModules) console.log(`    - ${m}`);
  }
  if (a.unresolvedRegistrations.length > 0) {
    console.log(`  ${C.dim}unresolvedRegistrations:${C.reset}`);
    for (const r of a.unresolvedRegistrations) console.log(`    - ${r}`);
  }
  if (a.missingContractEndpoints.length > 0) {
    const sample = a.missingContractEndpoints.slice(0, 5);
    console.log(
      `  ${C.dim}missingContractEndpoints (first ${sample.length} of ${a.missingContractEndpoints.length}):${C.reset}`,
    );
    for (const e of sample) console.log(`    - ${e.method} ${e.endpoint}`);
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outputDir = path.resolve(argv[0] ?? "generated-code");

  if (!(await fileExists(outputDir))) {
    console.error(`${C.red}error:${C.reset} outputDir does not exist: ${outputDir}`);
    process.exit(2);
  }
  const indexPath = path.join(outputDir, "backend/src/api/modules/index.ts");
  if (!(await fileExists(indexPath))) {
    console.error(
      `${C.red}error:${C.reset} expected ${indexPath} to exist — is this a valid generated-code directory?`,
    );
    process.exit(2);
  }
  const contractsPath = path.join(outputDir, "API_CONTRACTS.json");
  const hasContracts = await fileExists(contractsPath);

  console.log(`${C.bold}Replay harness for route-audit codemods${C.reset}`);
  console.log(`  outputDir:   ${outputDir}`);
  console.log(`  contracts:   ${hasContracts ? "✓ API_CONTRACTS.json found" : `${C.yellow}⚠ missing — prefix pin will be skipped${C.reset}`}`);

  // Snapshot the current index.ts so we can show the diff at the end.
  const indexBefore = await fs.readFile(indexPath, "utf-8");

  header("Audit (before)");
  const auditBefore = await auditApiRouteRegistration(outputDir);
  summariseAudit("before", auditBefore);

  header("Auto-repair");
  const repair = await autoRepairRouteRegistration(outputDir, auditBefore);
  if (!repair.appliedAny) {
    console.log(`  ${C.green}✓ no auto-repair needed${C.reset}`);
  } else {
    console.log(
      `  ${C.green}✓ auto-wired ${repair.wired.length} register*Routes call(s):${C.reset}`,
    );
    for (const name of repair.wired) console.log(`    - ${name}`);
    if (repair.skippedWires.length > 0) {
      console.log(`  ${C.yellow}∅ skipped wires:${C.reset}`);
      for (const s of repair.skippedWires) {
        console.log(`    - ${s.exportName}: ${s.reason}`);
      }
    }
  }

  header("Audit (after)");
  const auditAfter = await auditApiRouteRegistration(outputDir);
  summariseAudit("after ", auditAfter);

  header("Verdict");
  const before = auditBefore;
  const after = auditAfter;
  const stillBroken =
    after.unregisteredModules.length +
    after.unresolvedRegistrations.length +
    after.missingContractEndpoints.length;
  const fixed =
    before.unregisteredModules.length -
    after.unregisteredModules.length +
    (before.missingContractEndpoints.length -
      after.missingContractEndpoints.length);

  if (stillBroken === 0 && repair.appliedAny) {
    console.log(
      `  ${C.green}${C.bold}✓ route audit clean${C.reset} — codemod resolved ${fixed} finding(s).`,
    );
  } else if (stillBroken === 0 && !repair.appliedAny) {
    console.log(
      `  ${C.green}✓ route audit was already clean${C.reset} — nothing to do.`,
    );
  } else {
    console.log(
      `  ${C.yellow}⚠ ${stillBroken} finding(s) remain after auto-repair${C.reset} — investigate.`,
    );
  }

  // Show the index.ts diff (if any) so the user can confirm the codemod
  // produced sane output.
  const indexAfter = await fs.readFile(indexPath, "utf-8");
  if (indexBefore !== indexAfter) {
    header("index.ts diff (preview)");
    const beforeLines = indexBefore.split("\n");
    const afterLines = indexAfter.split("\n");
    // Naive line-by-line diff (good enough for small inserts).
    const maxLines = Math.max(beforeLines.length, afterLines.length);
    for (let i = 0; i < maxLines; i++) {
      const b = beforeLines[i];
      const a = afterLines[i];
      if (b === a) continue;
      if (b === undefined) {
        console.log(`  ${C.green}+ ${a}${C.reset}`);
      } else if (a === undefined) {
        console.log(`  ${C.red}- ${b}${C.reset}`);
      } else {
        console.log(`  ${C.red}- ${b}${C.reset}`);
        console.log(`  ${C.green}+ ${a}${C.reset}`);
      }
    }
  }

  process.exit(stillBroken === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`${C.red}replay harness crashed:${C.reset}`, err);
  process.exit(2);
});
