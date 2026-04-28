/**
 * PostgreSQL connection pool — lazy singleton via globalThis.
 * The pool is created on first access so that Next.js has already injected
 * .env.local into process.env before the connection is established.
 *
 * Configure DATABASE_URL in .env.local, e.g.:
 *   DATABASE_URL=postgresql://postgres@localhost/agentic_builder?host=/tmp
 */

import { Pool } from "pg";

const globalForPg = globalThis as typeof globalThis & {
  __pgPool?: Pool;
  __pgConnStr?: string;
};

function getPool(): Pool {
  // Read env every call so hot-reload always picks up the latest value.
  const connStr =
    process.env.DATABASE_URL ??
    "postgresql://postgres@localhost/agentic_builder?host=/tmp";

  // Recreate pool if connection string changed.
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
        max: 10,
        idleTimeoutMillis: 30_000,
      };
    } catch {
      poolOpts = { connectionString: connStr, max: 10, idleTimeoutMillis: 30_000 };
    }

    console.log("[db] Pool opts (host):", (poolOpts as Record<string, unknown>).host);
    globalForPg.__pgPool = new Pool(poolOpts);
    globalForPg.__pgPool.on("error", (err) => {
      console.error("[db] Unexpected pool error:", err);
    });
  }
  return globalForPg.__pgPool;
}

/**
 * Lazy proxy — behaves exactly like a Pool but defers creation until first use.
 * Usage: `await db.query(...)` — identical to before.
 */
export const db: Pool = new Proxy({} as Pool, {
  get(_target, prop) {
    return (getPool() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
