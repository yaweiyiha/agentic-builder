/**
 * Per-kind body schema registry.
 *
 * Each kind declares whether its body is markdown (free-form, length-checked
 * only) or JSON (validated against a zod schema).
 *
 * Kinds without a registered schema fall through to "markdown only" — useful
 * for v1 placeholder kinds before their structure is locked.
 */

import { z, type ZodTypeAny } from "zod";

import { MemorySchemaError, type MemoryKind } from "../types";
import { TaskHistoryBodySchema } from "./task-history";
import { ProjectCardBodySchema } from "./project-card";
import { CodebaseMapBodySchema } from "./codebase-map";
import { ClassificationBodySchema } from "./classification";
import { SelfHealLogBodySchema } from "./self-heal-log";

export type BodyFormat = "markdown" | "json";

interface KindSpec {
  format: BodyFormat;
  /** Required for `format: "json"`. Ignored for markdown. */
  schema?: ZodTypeAny;
  /** Soft cap; v1 hard limit is 16KB enforced in FileStore. */
  maxBytes?: number;
}

const REGISTRY: Partial<Record<MemoryKind, KindSpec>> = {
  // L2 — Phase A
  "project-card": { format: "markdown", maxBytes: 8 * 1024 },
  "task-history": { format: "json", schema: TaskHistoryBodySchema },
  "codebase-map": { format: "markdown", maxBytes: 16 * 1024 },

  // L1 — Phase B
  classification: { format: "json", schema: ClassificationBodySchema },

  // L2 — Phase C
  "self-heal-log": { format: "json", schema: SelfHealLogBodySchema },

  // L1 — Phase D (preparation-phase patterns)
  // Free-form markdown: pattern body is a short natural-language guidance
  // string the next PRD/Design agent prompt can consume verbatim.
  "prd-pattern": { format: "markdown", maxBytes: 4 * 1024 },
  "design-pattern": { format: "markdown", maxBytes: 4 * 1024 },

  // Other kinds — markdown by default until their schema lands
  // (failure-pattern, decision, handoff-note, etc.)
};

export function getKindSpec(kind: MemoryKind): KindSpec {
  return REGISTRY[kind] ?? { format: "markdown", maxBytes: 16 * 1024 };
}

export function validateBody(kind: MemoryKind, body: string): void {
  const spec = getKindSpec(kind);

  const bytes = Buffer.byteLength(body, "utf8");
  const cap = spec.maxBytes ?? 16 * 1024;
  if (bytes > cap) {
    throw new MemorySchemaError(
      kind,
      `body exceeds ${cap} bytes (got ${bytes}); split into multiple records or externalize`,
    );
  }

  if (spec.format !== "json") return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw new MemorySchemaError(
      kind,
      `body must be JSON: ${(e as Error).message}`,
    );
  }
  const result = spec.schema!.safeParse(parsed);
  if (!result.success) {
    throw new MemorySchemaError(
      kind,
      `body failed schema: ${z.prettifyError(result.error)}`,
    );
  }
}

export {
  TaskHistoryBodySchema,
  ProjectCardBodySchema,
  CodebaseMapBodySchema,
  ClassificationBodySchema,
  SelfHealLogBodySchema,
};
