#!/usr/bin/env tsx
/**
 * A/B comparison harness — Phase C-6.
 *
 * Compares two coding sessions side-by-side: typically a baseline run
 * (`MEMORY_INJECT=false`) against a treatment run (`MEMORY_INJECT=true`)
 * over the same brief. Reads the existing artefacts each session writes:
 *   - `<dir>/.ralph/coding-session-report.json`  (cost, duration, gate score)
 *   - `<dir>/.ralph/repair-log.jsonl`            (self-heal triggers)
 *
 * Usage:
 *   npm run memory:ab-compare -- \
 *     --baseline=path/to/baseline-output \
 *     --treatment=path/to/treatment-output
 *
 * No LLM calls. No memory mutations. Pure local analysis — invoke as
 * many times as you like.
 *
 * Recommended workflow (per design doc §11.4):
 *   1. Pick a brief from `tests/memory/ab-golden-set.json`
 *   2. Run kickoff with `MEMORY_INJECT=false` → save output to `out-baseline/`
 *   3. Run kickoff with `MEMORY_INJECT=true`  → save output to `out-treatment/`
 *   4. Run this script with both paths
 *   5. Verdict: treatment self-heal triggers should drop ≥20% on average
 *      across 5+ briefs to declare the inject path valuable.
 */

import fs from "node:fs/promises";
import path from "node:path";

interface SessionReport {
  sessionId: string;
  startedAt: string;
  status: "pass" | "fail" | "aborted";
  score?: { score: number; grade: string };
  grade?: string;
  durationMs: number;
  totalCostUsd: number;
}

interface RepairCounts {
  totalEvents: number;
  byStage: Record<string, number>;
  byEvent: Record<string, number>;
  giveUps: number;
  truncations: number;
  stagnations: number;
}

interface Snapshot {
  label: string;
  sourceDir: string;
  report: SessionReport | null;
  repair: RepairCounts;
}

async function readReport(dir: string): Promise<SessionReport | null> {
  const p = path.join(dir, ".ralph", "coding-session-report.json");
  try {
    const raw = await fs.readFile(p, "utf8");
    const parsed = JSON.parse(raw);
    return {
      sessionId: parsed.sessionId,
      startedAt: parsed.startedAt,
      status: parsed.status,
      score: parsed.score,
      grade: parsed.score?.grade ?? parsed.grade,
      durationMs: parsed.durationMs ?? 0,
      totalCostUsd: parsed.totalCostUsd ?? 0,
    };
  } catch (err) {
    console.warn(`[warn] no session report at ${p}: ${(err as Error).message}`);
    return null;
  }
}

async function readRepair(dir: string): Promise<RepairCounts> {
  const counts: RepairCounts = {
    totalEvents: 0,
    byStage: {},
    byEvent: {},
    giveUps: 0,
    truncations: 0,
    stagnations: 0,
  };
  const p = path.join(dir, ".ralph", "repair-log.jsonl");
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch {
    return counts;
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const ev = JSON.parse(t) as {
        stage?: string;
        event?: string;
        stillMissing?: string[];
      };
      counts.totalEvents++;
      if (ev.stage) counts.byStage[ev.stage] = (counts.byStage[ev.stage] ?? 0) + 1;
      if (ev.event) counts.byEvent[ev.event] = (counts.byEvent[ev.event] ?? 0) + 1;
      const evName = (ev.event ?? "").toLowerCase();
      if (/(final|exhausted|gave?_?up|abandon)/.test(evName) && (ev.stillMissing?.length ?? 0) > 0) {
        counts.giveUps++;
      }
      if (/truncated/.test(evName)) counts.truncations++;
      if (/stagnation/.test(evName)) counts.stagnations++;
    } catch {
      /* skip */
    }
  }
  return counts;
}

async function loadSnapshot(dir: string, label: string): Promise<Snapshot> {
  const abs = path.resolve(dir);
  return {
    label,
    sourceDir: abs,
    report: await readReport(abs),
    repair: await readRepair(abs),
  };
}

function pct(a: number, b: number): string {
  if (b === 0) return a === 0 ? "—" : "+∞%";
  const delta = ((a - b) / b) * 100;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtUsd(v: number): string {
  return `$${v.toFixed(4)}`;
}

function row(label: string, base: string, treat: string, delta: string): string {
  return `  ${label.padEnd(28)}  ${base.padEnd(18)}  ${treat.padEnd(18)}  ${delta}`;
}

function renderTable(b: Snapshot, t: Snapshot): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`Baseline:   ${b.sourceDir}`);
  lines.push(`Treatment:  ${t.sourceDir}`);
  lines.push("");
  lines.push(
    "  " +
      "metric".padEnd(28) +
      "  " +
      "baseline".padEnd(18) +
      "  " +
      "treatment".padEnd(18) +
      "  delta",
  );
  lines.push("  " + "─".repeat(78));

  const br = b.report;
  const tr = t.report;
  if (br && tr) {
    lines.push(row("session.status", br.status, tr.status, "—"));
    lines.push(
      row(
        "session.grade",
        br.score?.grade ?? br.grade ?? "—",
        tr.score?.grade ?? tr.grade ?? "—",
        "—",
      ),
    );
    lines.push(
      row(
        "session.score",
        (br.score?.score ?? 0).toFixed(1),
        (tr.score?.score ?? 0).toFixed(1),
        ((tr.score?.score ?? 0) - (br.score?.score ?? 0)).toFixed(1),
      ),
    );
    lines.push(
      row("durationMs", fmtMs(br.durationMs), fmtMs(tr.durationMs), pct(tr.durationMs, br.durationMs)),
    );
    lines.push(
      row(
        "totalCostUsd",
        fmtUsd(br.totalCostUsd),
        fmtUsd(tr.totalCostUsd),
        pct(tr.totalCostUsd, br.totalCostUsd),
      ),
    );
  }

  lines.push(
    row(
      "repair.totalEvents",
      String(b.repair.totalEvents),
      String(t.repair.totalEvents),
      pct(t.repair.totalEvents, b.repair.totalEvents),
    ),
  );
  lines.push(
    row(
      "repair.giveUps  (lower=better)",
      String(b.repair.giveUps),
      String(t.repair.giveUps),
      pct(t.repair.giveUps, b.repair.giveUps),
    ),
  );
  lines.push(
    row(
      "repair.truncations",
      String(b.repair.truncations),
      String(t.repair.truncations),
      pct(t.repair.truncations, b.repair.truncations),
    ),
  );
  lines.push(
    row(
      "repair.stagnations",
      String(b.repair.stagnations),
      String(t.repair.stagnations),
      pct(t.repair.stagnations, b.repair.stagnations),
    ),
  );

  // Top-3 stage diffs
  const stages = new Set([
    ...Object.keys(b.repair.byStage),
    ...Object.keys(t.repair.byStage),
  ]);
  const stageDiffs = Array.from(stages)
    .map((s) => {
      const ba = b.repair.byStage[s] ?? 0;
      const ta = t.repair.byStage[s] ?? 0;
      return { stage: s, baseline: ba, treatment: ta, diff: ta - ba };
    })
    .sort((a, b2) => Math.abs(b2.diff) - Math.abs(a.diff));
  if (stageDiffs.length) {
    lines.push("");
    lines.push("  Repair count by stage (top diffs):");
    for (const { stage, baseline, treatment, diff } of stageDiffs.slice(0, 6)) {
      const arrow = diff > 0 ? "↑" : diff < 0 ? "↓" : "·";
      lines.push(`    ${arrow} ${stage.padEnd(34)}  ${baseline} → ${treatment}  (Δ=${diff})`);
    }
  }

  // Verdict
  lines.push("");
  if (br && tr) {
    const heuristics: string[] = [];
    if (b.repair.totalEvents > 0) {
      const drop = ((b.repair.totalEvents - t.repair.totalEvents) / b.repair.totalEvents) * 100;
      if (drop >= 20) heuristics.push(`✓ self-heal triggers down ${drop.toFixed(0)}% (≥20% target)`);
      else if (drop > 0)
        heuristics.push(`~ self-heal triggers down ${drop.toFixed(0)}% (below 20% target)`);
      else heuristics.push(`✗ self-heal triggers UP ${(-drop).toFixed(0)}%`);
    }
    if (br.totalCostUsd > 0) {
      const dCost = ((tr.totalCostUsd - br.totalCostUsd) / br.totalCostUsd) * 100;
      heuristics.push(
        `${dCost <= 5 ? "✓" : "~"} cost change ${dCost >= 0 ? "+" : ""}${dCost.toFixed(0)}% (≤5% acceptable)`,
      );
    }
    const sb = br.score?.score ?? 0;
    const st = tr.score?.score ?? 0;
    if (sb > 0 && st > 0) {
      heuristics.push(`${st >= sb ? "✓" : "✗"} session score ${sb.toFixed(0)} → ${st.toFixed(0)}`);
    }
    if (heuristics.length) {
      lines.push("  Heuristic verdict:");
      for (const h of heuristics) lines.push(`    ${h}`);
    }
  }
  return lines.join("\n");
}

interface Args {
  baseline: string | null;
  treatment: string | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { baseline: null, treatment: null };
  for (const a of argv) {
    if (a.startsWith("--baseline=")) out.baseline = a.slice("--baseline=".length);
    else if (a.startsWith("--treatment=")) out.treatment = a.slice("--treatment=".length);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.baseline || !args.treatment) {
    console.error(
      "usage: memory ab-compare --baseline=<dir> --treatment=<dir>\n" +
        "  Each <dir> should be the project root containing `.ralph/`.\n" +
        "  Typically: out-baseline/ (MEMORY_INJECT=false) and\n" +
        "             out-treatment/ (MEMORY_INJECT=true) over the same brief.",
    );
    process.exit(1);
  }
  const [baseline, treatment] = await Promise.all([
    loadSnapshot(args.baseline, "baseline"),
    loadSnapshot(args.treatment, "treatment"),
  ]);
  console.log(renderTable(baseline, treatment));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
