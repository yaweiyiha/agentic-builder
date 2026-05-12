/**
 * TimescaleDB safety helpers.
 *
 * TimescaleDB is **not** part of stock PostgreSQL. Homebrew, GitHub Actions
 * runners, most cloud preview DBs, and any developer who just `brew install
 * postgresql` will NOT have the extension. If a migration unconditionally
 * runs `CREATE EXTENSION IF NOT EXISTS timescaledb` it throws and aborts
 * the whole migration sequence — taking the backend down with it.
 *
 * **HARD RULE for every backend worker:**
 * Any SQL that touches TimescaleDB-specific features (CREATE EXTENSION,
 * create_hypertable, time_bucket, continuous aggregates, retention
 * policies) MUST go through one of the helpers below. NEVER inline raw
 * TimescaleDB SQL in a migration's `up()` body.
 *
 * The helpers all respect the `TIMESCALE_DISABLED=1` env var (set in
 * `.env.example` for local dev) and silently skip the operation. They
 * also catch the runtime error from missing extension and log a warning
 * — the migration succeeds, the row gets stored as a plain table, and
 * the backend keeps running.
 *
 * Hypertable-only optimisations (compression, retention) degrade
 * gracefully: queries still work against the plain table, just without
 * the perf benefit.
 */

import type { QueryInterface, Sequelize } from "sequelize";

function isDisabled(): boolean {
  const v = process.env.TIMESCALE_DISABLED;
  return v === "1" || v === "true";
}

/**
 * Try to enable the TimescaleDB extension. NEVER throws; logs a warning
 * if the extension is unavailable so the caller can continue.
 *
 * Use this at the TOP of your first scoring/timeseries migration's
 * `up()` body — not inline `await queryInterface.sequelize.query(...)`.
 */
export async function enableTimescaleExtension(
  sequelize: Sequelize,
): Promise<{ enabled: boolean; reason?: string }> {
  if (isDisabled()) {
    console.warn(
      "[timescale] TIMESCALE_DISABLED is set — skipping CREATE EXTENSION. " +
        "Hypertables will be created as plain tables.",
    );
    return { enabled: false, reason: "disabled-by-env" };
  }
  try {
    await sequelize.query("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;");
    return { enabled: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[timescale] CREATE EXTENSION failed (${msg}); falling back to plain ` +
        "PostgreSQL. Install TimescaleDB or set TIMESCALE_DISABLED=1 to suppress.",
    );
    return { enabled: false, reason: "extension-unavailable" };
  }
}

/**
 * Turn a regular table into a hypertable if TimescaleDB is available.
 * Falls back silently to the plain table when not.
 *
 * Call AFTER `queryInterface.createTable(...)` for any time-series table.
 */
export async function createHypertableIfPossible(
  queryInterface: QueryInterface,
  table: string,
  timeColumn: string,
  options: { chunkTimeInterval?: string } = {},
): Promise<{ converted: boolean }> {
  if (isDisabled()) return { converted: false };
  try {
    const chunk = options.chunkTimeInterval ?? "7 days";
    await queryInterface.sequelize.query(
      `SELECT create_hypertable('${table}', '${timeColumn}', ` +
        `chunk_time_interval => INTERVAL '${chunk}', ` +
        `if_not_exists => TRUE, migrate_data => TRUE);`,
    );
    return { converted: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[timescale] create_hypertable('${table}','${timeColumn}') skipped: ${msg}`,
    );
    return { converted: false };
  }
}

/**
 * Run an arbitrary TimescaleDB-only query (compression policy, retention,
 * continuous aggregate refresh). No-op when Timescale is unavailable.
 */
export async function runTimescaleQuery(
  sequelize: Sequelize,
  query: string,
  description: string,
): Promise<{ executed: boolean }> {
  if (isDisabled()) return { executed: false };
  try {
    await sequelize.query(query);
    return { executed: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[timescale] ${description} skipped: ${msg}`);
    return { executed: false };
  }
}
