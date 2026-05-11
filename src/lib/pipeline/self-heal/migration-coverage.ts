/**
 * Sequelize migration coverage — verifies that whenever a worker task
 * modifies a Sequelize model under `backend/src/models/`, the same task
 * also writes a corresponding migration under `backend/src/migrations/`.
 *
 * Pure function: given the file list a worker just wrote, return the
 * set of model files that lack an accompanying migration. The caller
 * (agent-subgraph after each task) persists the result to
 * `<outputDir>/.ralph/migration-coverage.json` so a downstream self-heal
 * pass can convert gaps into repair tasks.
 *
 * MVP scope: detect-only, not auto-fix. The validator does not look at
 * git diffs, AST, or migration content correctness — it answers the
 * binary question "did this task touch a model without writing a
 * migration?". Phase 2 is to actually run the migration against an
 * ephemeral SQLite DB and verify up()/down() round-trips.
 */

export interface MigrationCoverageInput {
  /** Files written this task. Paths can use either separator. */
  writtenFiles: readonly string[];
  /** Override the model directory (forward-slash, no trailing slash). */
  modelDir?: string;
  /** Override the migration directory. */
  migrationDir?: string;
}

export interface MigrationCoverageGap {
  modelPath: string;
  /** Model file's basename without the .ts extension — useful for
   *  suggesting a migration filename. */
  modelName: string;
}

export interface MigrationCoverageResult {
  ok: boolean;
  modelFilesTouched: string[];
  migrationFilesTouched: string[];
  gaps: MigrationCoverageGap[];
}

const DEFAULT_MODEL_DIR = "backend/src/models";
const DEFAULT_MIGRATION_DIR = "backend/src/migrations";

const TS_FILE = /\.ts$/i;
const MODEL_INDEX_NAMES = new Set(["index.ts", "index.tsx"]);

export function checkMigrationCoverage(
  input: MigrationCoverageInput,
): MigrationCoverageResult {
  const modelDir = stripTrailing(
    (input.modelDir ?? DEFAULT_MODEL_DIR).replace(/\\/g, "/"),
  );
  const migrationDir = stripTrailing(
    (input.migrationDir ?? DEFAULT_MIGRATION_DIR).replace(/\\/g, "/"),
  );
  const modelPrefix = modelDir + "/";
  const migrationPrefix = migrationDir + "/";

  const normalised = input.writtenFiles.map((p) => p.replace(/\\/g, "/"));

  const modelTouched = normalised.filter(
    (p) =>
      p.startsWith(modelPrefix) &&
      TS_FILE.test(p) &&
      !MODEL_INDEX_NAMES.has(basename(p)),
  );
  const migrationTouched = normalised.filter(
    (p) => p.startsWith(migrationPrefix) && TS_FILE.test(p),
  );

  const gaps: MigrationCoverageGap[] =
    modelTouched.length > 0 && migrationTouched.length === 0
      ? modelTouched.map((modelPath) => ({
          modelPath,
          modelName: basename(modelPath).replace(/\.ts$/i, ""),
        }))
      : [];

  return {
    ok: gaps.length === 0,
    modelFilesTouched: modelTouched.sort(),
    migrationFilesTouched: migrationTouched.sort(),
    gaps,
  };
}

/**
 * Format a human-readable repair instruction for a coverage gap. Used by
 * the self-heal pass that turns gaps into tasks. Kept here so it stays in
 * lockstep with the gap shape.
 */
export function formatMigrationGapInstruction(
  gap: MigrationCoverageGap,
  prevTaskId?: string,
): string {
  const lead = prevTaskId
    ? `Task "${prevTaskId}" modified \`${gap.modelPath}\` but did not write a Sequelize migration. `
    : `Model \`${gap.modelPath}\` was modified without a corresponding Sequelize migration. `;
  return (
    lead +
    `Add \`backend/src/migrations/NNNN_${kebab(gap.modelName)}.ts\` (where ` +
    "NNNN is one greater than the highest existing migration number) " +
    "exporting both `async up({ context: queryInterface })` and " +
    "`async down({ context: queryInterface })` covering every column / type / " +
    `index change introduced in \`${gap.modelPath}\`. Do NOT modify existing ` +
    "migrations — always add a new file."
  );
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

function stripTrailing(p: string): string {
  return p.endsWith("/") ? p.slice(0, -1) : p;
}

function kebab(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}
