/**
 * Reads the previous run's `.ralph/runtime-smoke.json` and renders it as a
 * markdown block for the verify-fix worker prompt.
 *
 * Why this exists:
 *   `runRuntimeSmokeGate` runs AFTER the verify-fix loop. The loop itself
 *   never sees the resulting `bootFailed` / stderr tail — the gate just
 *   marks the run as failed at the end. When the gate fails twice in a
 *   row (which is common), the LLM never gets the actual reason
 *   ("DATABASE_URL missing", "Sequelize column mismatch", etc.) and
 *   stagnates trying to derive it from static analysis.
 *
 *   We mitigate by surfacing the previous run's smoke evidence at the
 *   START of the next verify-fix loop — so when the loop opens it can
 *   immediately read "last time you didn't fix DATABASE_URL; here is the
 *   stderr tail" instead of grep'ing blindly.
 */

import { fsRead } from "@/lib/langgraph/tools";

interface SmokeFailure {
  code?: string;
  target?: string;
  directive?: string;
  evidence?: string;
}

interface SmokeReport {
  bootFailed?: boolean;
  pass?: boolean;
  port?: number;
  failures?: SmokeFailure[];
  generatedAt?: string;
}

/**
 * Returns an empty string when the report doesn't exist or the previous
 * smoke run actually passed (in which case we don't want to mislead the
 * worker by quoting stale stderr).
 */
export async function formatPreviousRuntimeSmokeBlock(
  outputDir: string,
): Promise<string> {
  const raw = await fsRead(".ralph/runtime-smoke.json", outputDir);
  if (raw.startsWith("FILE_NOT_FOUND") || raw.startsWith("REJECTED")) return "";
  let parsed: SmokeReport;
  try {
    parsed = JSON.parse(raw) as SmokeReport;
  } catch {
    return "";
  }
  if (parsed.pass === true) return "";
  const failures = Array.isArray(parsed.failures) ? parsed.failures : [];
  if (failures.length === 0) return "";

  const lines: string[] = [];
  lines.push("");
  lines.push(
    "## Previous runtime smoke gate failed (READ stderr — DO NOT re-derive blindly)",
  );
  lines.push(
    `Last smoke run on port ${parsed.port ?? "?"} reported ${failures.length} failure(s)${parsed.bootFailed ? " — backend never started" : ""}. Below is the captured evidence; treat it as authoritative for what's currently broken at runtime.`,
  );
  lines.push("");
  for (const f of failures.slice(0, 5)) {
    lines.push(`- **[${f.code ?? "unknown"}] ${f.target ?? "?"}**`);
    if (f.directive) lines.push(`  - Action: ${f.directive}`);
    if (f.evidence) {
      const tail = f.evidence.slice(-1500);
      lines.push("  - Evidence (stderr tail / response body):");
      lines.push("    ```");
      for (const line of tail.split("\n").slice(-30)) {
        lines.push(`    ${line}`);
      }
      lines.push("    ```");
    }
  }
  if (failures.length > 5) {
    lines.push(
      `- … (+${failures.length - 5} more failure(s) — full data in \`.ralph/runtime-smoke.json\`)`,
    );
  }
  lines.push("");
  lines.push(
    "First action this iteration: identify the root cause from the stderr tail above (missing env var, model init crash, broken import, etc.) and patch the responsible file. Do NOT skip this for static analysis — the runtime evidence is decisive.",
  );
  return lines.join("\n");
}
