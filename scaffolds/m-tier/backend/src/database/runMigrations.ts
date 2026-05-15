/**
 * Umzug-based Sequelize migration runner.
 *
 * Loads every `*.ts` / `*.js` file under `src/database/migrations/` (each
 * exporting `up({ context: queryInterface })` and `down(...)`), tracks
 * applied state in a `migrations_meta` table, and provides:
 *
 *   - `runMigrations()` — apply all pending (called from `initDb()`)
 *   - `revertLastMigration()` — roll back one step (for dev)
 *   - CLI: `pnpm migrate` / `pnpm migrate:down`
 *
 * Idempotent: re-applying after no new files is a no-op. Disable the
 * auto-run from `initDb()` by setting `AUTO_MIGRATE=0` (default is on;
 * production deploys should set 0 and run `pnpm migrate` as an explicit
 * release step). Worker tasks that add columns / tables to a model under
 * `backend/src/models/` MUST also add a sibling migration file here —
 * the post-task `migration-coverage` check enforces it.
 */

import path from "node:path";
import { Umzug, SequelizeStorage } from "umzug";

import { sequelize } from "../db";

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

export const umzug = new Umzug({
  migrations: {
    glob: ["*.{ts,js}", { cwd: MIGRATIONS_DIR }],
    resolve: ({ name, path: filePath, context }) => {
      // Lazy-import so a syntax error in one migration doesn't tear down
      // the whole bootstrap — umzug will surface the failure at run time.
      return {
        name,
        up: async () => {
          if (!filePath) throw new Error(`migration ${name} has no path`);
          const mod = await import(filePath);
          if (typeof mod.up !== "function") {
            throw new Error(`migration ${name} does not export up()`);
          }
          await mod.up({ context });
        },
        down: async () => {
          if (!filePath) throw new Error(`migration ${name} has no path`);
          const mod = await import(filePath);
          if (typeof mod.down !== "function") {
            throw new Error(`migration ${name} does not export down()`);
          }
          await mod.down({ context });
        },
      };
    },
  },
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({
    sequelize,
    tableName: "migrations_meta",
  }),
  logger: console,
});

export async function runMigrations(): Promise<void> {
  const pending = await umzug.pending();
  if (pending.length === 0) {
    console.log("[migrate] no pending migrations.");
    return;
  }
  console.log(`[migrate] applying ${pending.length} migration(s)...`);
  await umzug.up();
  console.log("[migrate] done.");
}

export async function revertLastMigration(): Promise<void> {
  await umzug.down();
}

// CLI entry — invoked by `pnpm migrate` / `pnpm migrate:down`.
if (require.main === module) {
  const cmd = process.argv[2] ?? "up";
  (async () => {
    if (cmd === "up") {
      await runMigrations();
    } else if (cmd === "down") {
      await revertLastMigration();
    } else {
      console.error(`unknown command: ${cmd} (expected up|down)`);
      process.exit(1);
    }
    await sequelize.close();
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
