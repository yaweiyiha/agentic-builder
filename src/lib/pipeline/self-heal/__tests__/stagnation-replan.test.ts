/**
 * Tests for stagnation-replan — the pure helper that takes diagnostics
 * + a chat callable and produces a 3-step action plan.
 */

import { describe, expect, it } from "vitest";
import {
  buildReplanContext,
  computeStagnationReplan,
  type StagnationReplanInput,
} from "../stagnation-replan";

function makeInput(
  over: Partial<StagnationReplanInput> = {},
): StagnationReplanInput {
  return {
    diagnosticsSnapshot: {
      tscErrors: ["backend/src/app.ts:24 — TS2322"],
      routeAudit: ["unregistered: backend/src/api/modules/auth/auth.routes.ts"],
    },
    repeatedActions: ["read_file:backend/src/app.ts ×8"],
    repeatedReads: ["backend/src/app.ts"],
    lastProgressReason: "initial integration review",
    iterationsConsumed: 12,
    chat: async () => "",
    ...over,
  };
}

describe("buildReplanContext", () => {
  it("includes iteration count + last progress reason", () => {
    const ctx = buildReplanContext(makeInput());
    expect(ctx).toContain("12 iteration(s)");
    expect(ctx).toContain("initial integration review");
  });

  it("lists repeated reads under a DO-NOT-suggest warning header", () => {
    const ctx = buildReplanContext(
      makeInput({ repeatedReads: ["a.ts", "b.ts"] }),
    );
    expect(ctx).toMatch(/DO NOT suggest reading these again/);
    expect(ctx).toContain("`a.ts`");
    expect(ctx).toContain("`b.ts`");
  });

  it("includes TSC + route audit sections when present", () => {
    const ctx = buildReplanContext(
      makeInput({
        diagnosticsSnapshot: {
          tscErrors: ["err1", "err2"],
          routeAudit: ["unreg1"],
        },
      }),
    );
    expect(ctx).toContain("## TSC errors");
    expect(ctx).toContain("## Route audit findings");
    expect(ctx).toContain("err1");
    expect(ctx).toContain("unreg1");
  });

  it("omits sections that have no findings", () => {
    const ctx = buildReplanContext(
      makeInput({
        diagnosticsSnapshot: { tscErrors: ["err1"] },
      }),
    );
    expect(ctx).not.toContain("## Route audit");
    expect(ctx).not.toContain("## Contract usage");
    expect(ctx).not.toContain("## Migration coverage");
  });

  it("caps each section at 10 entries", () => {
    const long = Array.from({ length: 20 }, (_, i) => `err-${i}`);
    const ctx = buildReplanContext(
      makeInput({ diagnosticsSnapshot: { tscErrors: long } }),
    );
    expect(ctx).toContain("err-9");
    expect(ctx).not.toContain("err-10");
  });
});

describe("computeStagnationReplan — happy path", () => {
  it("parses 3-bullet response", async () => {
    const r = await computeStagnationReplan(
      makeInput({
        chat: async () =>
          [
            "- Fix backend/src/app.ts:24 — change prefix to /api/v1.",
            "- Register registerAuthRoutes in backend/src/api/modules/index.ts.",
            "- Run pnpm tsc to surface remaining errors.",
          ].join("\n"),
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.diagnostics.bulletCount).toBe(3);
    expect(r.plan).toContain("Fix backend/src/app.ts:24");
    expect(r.plan).toContain("Register registerAuthRoutes");
  });

  it("strips markdown fences from LLM output", async () => {
    const r = await computeStagnationReplan(
      makeInput({
        chat: async () =>
          ["```markdown", "- step 1", "- step 2", "- step 3", "```"].join("\n"),
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.plan).not.toContain("```");
    expect(r.plan).toContain("step 1");
  });

  it("accepts multiple bullet styles (* + 1. )", async () => {
    const r = await computeStagnationReplan(
      makeInput({
        chat: async () => ["* a", "+ b", "1. c"].join("\n"),
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.diagnostics.bulletCount).toBe(3);
  });

  it("caps to 5 bullets if LLM emits more", async () => {
    const lots = Array.from({ length: 8 }, (_, i) => `- step ${i}`).join("\n");
    const r = await computeStagnationReplan(
      makeInput({ chat: async () => lots }),
    );
    expect(r.diagnostics.bulletCount).toBe(5);
  });
});

describe("computeStagnationReplan — failure modes", () => {
  it("returns ok=false when chat throws", async () => {
    const r = await computeStagnationReplan(
      makeInput({
        chat: async () => {
          throw new Error("rate limit");
        },
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.plan).toBe("");
    expect(r.diagnostics.reason).toContain("rate limit");
  });

  it("returns ok=false when no bullets parse", async () => {
    const r = await computeStagnationReplan(
      makeInput({
        chat: async () => "This is just prose with no bullets.",
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.diagnostics.bulletCount).toBe(0);
    expect(r.diagnostics.reason).toMatch(/no bullets/);
  });

  it("returns ok=true when at least one bullet parses (even though prompt asks for 3)", async () => {
    // Prompt asks for 3 but we don't hard-reject single-bullet outputs —
    // LLM compliance varies and we'd rather take 1 bullet than fall through
    // to abort.
    const r = await computeStagnationReplan(
      makeInput({ chat: async () => "- single fix" }),
    );
    expect(r.ok).toBe(true);
    expect(r.diagnostics.bulletCount).toBe(1);
  });
});
