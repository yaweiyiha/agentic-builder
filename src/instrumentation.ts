/**
 * Next.js Instrumentation Hook
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Runs once when the Next.js server starts (both dev and production).
 * Used here to automatically run database migrations so new machines
 * don't need to manually execute `pnpm db:migrate`.
 */

export async function register() {
  // Only run in the Node.js runtime (not in Edge runtime / client)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { runMigrations } = await import("./lib/db/migrate");
      await runMigrations();
    } catch (err) {
      // Log the error but don't crash the server — the app may still be
      // usable if the DB is temporarily unavailable.
      console.error(
        "[instrumentation] DB migration failed — ensure PostgreSQL is running " +
          "and DATABASE_URL is configured in .env.local\n",
        err,
      );
    }
  }
}
