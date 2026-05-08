/**
 * Database migration runner — reads SQL files in order and executes them.
 *
 * CLI usage:  npx tsx src/lib/db/migrate.ts
 * npm script: pnpm db:migrate-sql
 *
 * Also exported as `runMigrations()` so the Next.js server can call it
 * automatically on startup via src/instrumentation.ts.
 */

import fs from "fs";
import path from "path";
import { pool } from "./client";

const migrationsDir = path.join(__dirname, "migrations");

export async function runMigrations(): Promise<void> {
  // Nothing to do if the migrations directory doesn't exist yet.
  if (!fs.existsSync(migrationsDir)) {
    console.warn("[migrate] Migrations directory not found, skipping:", migrationsDir);
    return;
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("[migrate] No SQL migration files found, nothing to do.");
    return;
  }

  const client = await pool.connect();
  try {
    for (const file of files) {
      console.log(`[migrate] Running ${file}…`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      await client.query(sql);
      console.log(`[migrate] ✓ ${file}`);
    }
    console.log("[migrate] All migrations complete.");
  } finally {
    client.release();
  }
}

// Allow running directly: npx tsx src/lib/db/migrate.ts
if (require.main === module) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      console.error("[migrate] Failed:", err);
      process.exit(1);
    });
}
