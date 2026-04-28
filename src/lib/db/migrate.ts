/**
 * Database migration runner — reads SQL files in order and executes them.
 * Usage:  npx tsx src/lib/db/migrate.ts
 */

import fs from "fs";
import path from "path";
import { db } from "./client";

async function migrate() {
  const migrationsDir = path.join(__dirname, "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const client = await db.connect();
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
    await db.end();
  }
}

migrate().catch((err) => {
  console.error("[migrate] Failed:", err);
  process.exit(1);
});
