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
import { Pool } from "pg";
import { pool } from "./client";

// Use process.cwd() rather than __dirname — Next.js webpack bundling
// rewrites __dirname to a `/ROOT/...` placeholder that doesn't exist on
// disk, so resolving from the project root is the only stable path.
const migrationsDir = path.resolve(process.cwd(), "src/lib/db/migrations");
const DB_AUTO_PROVISION = process.env.DB_AUTO_PROVISION === "true";

/**
 * Parse the DATABASE_URL and return connection options pointing to the
 * *maintenance* database ("postgres") so we can CREATE the target database
 * if it doesn't exist yet.
 * Always connects as the OS superuser (omit user/password so libpq uses
 * peer/ident auth), regardless of what's in DATABASE_URL.
 */
function maintenancePoolOpts(): ConstructorParameters<typeof Pool>[0] {
  const connStr =
    process.env.DATABASE_URL ??
    "postgresql://postgres@localhost/agentic_builder?host=/tmp";
  try {
    const u = new URL(connStr);
    const socketHost = u.searchParams.get("host");
    return {
      // No user/password — connect as the OS user (superuser on dev machines)
      host:     socketHost ?? (u.hostname || "localhost"),
      port:     u.port ? Number(u.port) : 5432,
      database: "postgres", // maintenance DB — always exists
      connectionTimeoutMillis: 5_000,
    };
  } catch {
    return { database: "postgres", connectionTimeoutMillis: 5_000 };
  }
}

/**
 * Derive the target database name from DATABASE_URL.
 */
function targetDbName(): string {
  const connStr =
    process.env.DATABASE_URL ??
    "postgresql://postgres@localhost/agentic_builder?host=/tmp";
  try {
    const u = new URL(connStr);
    return u.pathname.replace(/^\//, "") || "agentic_builder";
  } catch {
    return "agentic_builder";
  }
}

/**
 * Ensure the target role and database exist. Creates them if they don't.
 * Connects to the maintenance "postgres" DB as the current OS superuser.
 */
export async function ensureDatabase(): Promise<void> {
  if (!DB_AUTO_PROVISION) {
    return;
  }

  const dbName = targetDbName();

  // Extract target role & password directly from DATABASE_URL
  const connStr =
    process.env.DATABASE_URL ??
    "postgresql://postgres@localhost/agentic_builder?host=/tmp";
  let roleUser = "postgres";
  let rolePass: string | undefined;
  try {
    const u = new URL(connStr);
    if (u.username) roleUser = u.username;
    if (u.password) rolePass = u.password;
  } catch { /* ignore */ }

  const mainPool = new Pool(maintenancePoolOpts());
  try {
    try {
      // 1. Ensure the role exists
      const { rows: roleRows } = await mainPool.query(
        "SELECT 1 FROM pg_roles WHERE rolname = $1",
        [roleUser],
      );
      if (roleRows.length === 0) {
        console.log(`[migrate] Role "${roleUser}" not found — creating…`);
        const pwClause = rolePass
          ? ` PASSWORD '${rolePass.replace(/'/g, "''")}'`
          : "";
        await mainPool.query(
          `CREATE ROLE "${roleUser}" WITH LOGIN${pwClause}`,
        );
        console.log(`[migrate] ✓ Role "${roleUser}" created.`);
      } else {
        console.log(`[migrate] Role "${roleUser}" already exists.`);
      }

      // 2. Ensure the database exists
      const { rows: dbRows } = await mainPool.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        [dbName],
      );
      if (dbRows.length === 0) {
        console.log(`[migrate] Database "${dbName}" not found — creating…`);
        await mainPool.query(
          `CREATE DATABASE "${dbName}" OWNER "${roleUser}"`,
        );
        console.log(`[migrate] ✓ Database "${dbName}" created.`);
      } else {
        console.log(`[migrate] Database "${dbName}" already exists.`);
      }
    } catch (err) {
      console.warn(
        "[migrate] Skipping automatic DB provisioning. " +
          "Set DB_AUTO_PROVISION=true and use a privileged account if you need CREATE ROLE/CREATE DATABASE.",
      );
      console.warn("[migrate] Provisioning error:", err);
    }
  } finally {
    await mainPool.end();
  }
}

export async function runMigrations(): Promise<void> {
  // Ensure the database exists before attempting to connect / migrate.
  await ensureDatabase();
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
