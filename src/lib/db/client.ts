/**
 * Database client — exports a Drizzle ORM instance backed by a pg Pool.
 *
 * Configure DATABASE_URL in .env.local, e.g.:
 *   DATABASE_URL=postgresql://postgres@localhost/agentic_builder
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

function createPool(): Pool {
  const connStr =
    process.env.DATABASE_URL ??
    "postgresql://postgres@localhost/agentic_builder";

  // Parse ?host= query param manually — pg's own URL parser ignores it.
  let poolOpts: ConstructorParameters<typeof Pool>[0];
  try {
    const u = new URL(connStr);
    const socketHost = u.searchParams.get("host");
    poolOpts = {
      user:     u.username || "postgres",
      password: u.password || undefined,
      host:     socketHost ?? (u.hostname || "127.0.0.1"),
      port:     u.port ? Number(u.port) : undefined,
      database: u.pathname.replace(/^\//, "") || "agentic_builder",
    };
  } catch {
    poolOpts = { connectionString: connStr };
  }

  console.log("[db] Creating pg pool, host:", (poolOpts as Record<string, unknown>).host);

  const pool = new Pool({
    ...poolOpts,
    max: 20,
    min: 0,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });

  pool.on("error", (err) => {
    console.error("[db] Unexpected pool error:", err);
  });

  return pool;
}

/**
 * pg Pool — direct instance, no Proxy indirection.
 * Prefer using the `db` Drizzle instance for new code.
 */
export const pool: Pool = createPool();

/**
 * Drizzle ORM instance — use this for all database operations.
 * Usage: `await db.select().from(projects).where(eq(projects.id, id))`
 */
export const db = drizzle({ client: pool, schema });

// Re-export schema for convenience
export * from "./schema";