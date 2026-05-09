/**
 * Database client — exports a Drizzle ORM instance backed by a lazy pg Pool.
 *
 * The pool is created on first access so that Next.js has already injected
 * .env.local into process.env before the connection is established.
 *
 * Configure DATABASE_URL in .env.local, e.g.:
 *   DATABASE_URL=postgresql://postgres@localhost/agentic_builder?host=/tmp
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForPg = globalThis as typeof globalThis & {
  __pgPool?: Pool;
  __pgConnStr?: string;
};

function getPool(): Pool {
  const connStr =
    process.env.DATABASE_URL ??
    "postgresql://postgres@localhost/agentic_builder?host=/tmp";


  // Recreate pool if connection string changed (hot-reload).
  if (globalForPg.__pgPool && globalForPg.__pgConnStr !== connStr) {
    void globalForPg.__pgPool.end().catch(() => {});
    globalForPg.__pgPool = undefined;
  }

  if (!globalForPg.__pgPool) {
    console.log("[db] Creating pg pool, connStr =", connStr.slice(0, 80));
    globalForPg.__pgConnStr = connStr;

    // Parse ?host= query param manually — pg's own URL parser ignores it.
    let poolOpts: ConstructorParameters<typeof Pool>[0];
    try {
      const u = new URL(connStr);
      const socketHost = u.searchParams.get("host");
      poolOpts = {
        user:     u.username || "postgres",
        password: u.password || undefined,
        host:     socketHost ?? (u.hostname || "/tmp"),
        port:     u.port ? Number(u.port) : undefined,
        database: u.pathname.replace(/^\//, "") || "agentic_builder",
      };
    } catch {
      poolOpts = { connectionString: connStr };
    }

    console.log("[db] Pool opts (host):", (poolOpts as Record<string, unknown>).host);
    globalForPg.__pgPool = new Pool({
      ...poolOpts,
      max: 20,
      min: 0,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 30_000,
      idleTimeoutMillis: 30_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });
    globalForPg.__pgPool.on("error", (err) => {
      console.error("[db] Unexpected pool error:", err);
    });
  }
  return globalForPg.__pgPool;
}

/**
 * Lazy Pool proxy — kept for backward-compatibility with raw SQL usage.
 * Prefer using the `db` Drizzle instance for new code.
 */
export const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop) {
    return (getPool() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

/**
 * Drizzle ORM instance — use this for all database operations.
 * Usage: `await db.select().from(projects).where(eq(projects.id, id))`
 */
export const db = drizzle({ client: pool, schema });

// Re-export schema for convenience
export * from "./schema";