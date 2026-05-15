/**
 * Tests for Sequelize migration coverage check.
 */

import { describe, expect, it } from "vitest";
import {
  checkMigrationCoverage,
  formatMigrationGapInstruction,
} from "../migration-coverage";

describe("checkMigrationCoverage — gap detection", () => {
  it("flags a gap when model is touched without a migration", () => {
    const r = checkMigrationCoverage({
      writtenFiles: [
        "backend/src/models/User.ts",
        "backend/src/api/modules/users/users.controller.ts",
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.modelFilesTouched).toEqual(["backend/src/models/User.ts"]);
    expect(r.migrationFilesTouched).toEqual([]);
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]?.modelName).toBe("User");
  });

  it("ok=true when both model and migration are touched", () => {
    const r = checkMigrationCoverage({
      writtenFiles: [
        "backend/src/models/User.ts",
        "backend/src/database/migrations/0002_add_user_email.ts",
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.gaps).toEqual([]);
  });

  it("does NOT credit the legacy backend/src/migrations/ path (umzug runner uses database/migrations)", () => {
    const r = checkMigrationCoverage({
      writtenFiles: [
        "backend/src/models/User.ts",
        "backend/src/migrations/0002_add_user_email.ts",
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.migrationFilesTouched).toEqual([]);
    expect(r.gaps).toHaveLength(1);
  });

  it("ok=true when neither model nor migration is touched", () => {
    const r = checkMigrationCoverage({
      writtenFiles: [
        "backend/src/api/modules/health/health.routes.ts",
        "frontend/src/views/Home.tsx",
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.modelFilesTouched).toEqual([]);
    expect(r.migrationFilesTouched).toEqual([]);
  });

  it("flags every model touched when none have a migration", () => {
    const r = checkMigrationCoverage({
      writtenFiles: [
        "backend/src/models/User.ts",
        "backend/src/models/Project.ts",
        "backend/src/models/Task.ts",
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.gaps).toHaveLength(3);
    expect(r.gaps.map((g) => g.modelName).sort()).toEqual([
      "Project",
      "Task",
      "User",
    ]);
  });
});

describe("checkMigrationCoverage — index/aggregate exclusions", () => {
  it("models/index.ts does NOT count as a model touch", () => {
    const r = checkMigrationCoverage({
      writtenFiles: ["backend/src/models/index.ts"],
    });
    expect(r.ok).toBe(true);
    expect(r.modelFilesTouched).toEqual([]);
  });

  it("non-.ts files in models/ are ignored", () => {
    const r = checkMigrationCoverage({
      writtenFiles: ["backend/src/models/README.md"],
    });
    expect(r.modelFilesTouched).toEqual([]);
  });
});

describe("checkMigrationCoverage — path normalisation", () => {
  it("accepts back-slash paths (windows-style)", () => {
    const r = checkMigrationCoverage({
      writtenFiles: ["backend\\src\\models\\User.ts"],
    });
    expect(r.modelFilesTouched).toEqual(["backend/src/models/User.ts"]);
    expect(r.gaps).toHaveLength(1);
  });
});

describe("checkMigrationCoverage — directory overrides", () => {
  it("respects custom modelDir / migrationDir", () => {
    const r = checkMigrationCoverage({
      writtenFiles: [
        "apps/api/src/db/models/User.ts",
        "apps/api/src/db/schema-migrations/0001.ts",
      ],
      modelDir: "apps/api/src/db/models",
      migrationDir: "apps/api/src/db/schema-migrations",
    });
    expect(r.ok).toBe(true);
    expect(r.modelFilesTouched).toEqual(["apps/api/src/db/models/User.ts"]);
  });

  it("does not match outside the configured modelDir", () => {
    const r = checkMigrationCoverage({
      writtenFiles: ["frontend/src/models/Card.ts"],
    });
    expect(r.modelFilesTouched).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe("formatMigrationGapInstruction", () => {
  it("includes file path, suggested filename, and up/down requirement", () => {
    const msg = formatMigrationGapInstruction(
      { modelPath: "backend/src/models/User.ts", modelName: "User" },
      "task-add-user",
    );
    expect(msg).toContain('Task "task-add-user"');
    expect(msg).toContain("backend/src/models/User.ts");
    expect(msg).toContain("backend/src/database/migrations/NNNN_user.ts");
    expect(msg).toContain("up({");
    expect(msg).toContain("down({");
  });

  it("kebabs camelCase model names in the suggested filename", () => {
    const msg = formatMigrationGapInstruction({
      modelPath: "backend/src/models/UserProfile.ts",
      modelName: "UserProfile",
    });
    expect(msg).toContain("NNNN_user-profile.ts");
  });

  it("works without a prevTaskId hint", () => {
    const msg = formatMigrationGapInstruction({
      modelPath: "backend/src/models/Task.ts",
      modelName: "Task",
    });
    expect(msg).toContain("Model `backend/src/models/Task.ts`");
    expect(msg).not.toContain("Task \"");
  });
});
