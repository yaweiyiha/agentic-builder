import type { KickoffWorkItem } from "./types";

export function parseKickoffTaskBreakdownFromMetadata(
  metadata: Record<string, unknown> | undefined,
): KickoffWorkItem[] {
  if (!metadata) return [];
  const tb = metadata.taskBreakdown;
  if (!Array.isArray(tb)) return [];
  return tb.filter(isKickoffWorkItem);
}

function isKickoffWorkItem(x: unknown): x is KickoffWorkItem {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const isStringArray = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((item) => typeof item === "string");
  const filesOk =
    o.files === undefined ||
    isStringArray(o.files) ||
    (typeof o.files === "object" &&
      o.files !== null &&
      isStringArray((o.files as Record<string, unknown>).creates) &&
      isStringArray((o.files as Record<string, unknown>).modifies) &&
      isStringArray((o.files as Record<string, unknown>).reads));
  const coversOk =
    o.coversRequirementIds === undefined ||
    (Array.isArray(o.coversRequirementIds) &&
      o.coversRequirementIds.every((id) => typeof id === "string"));
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    typeof o.phase === "string" &&
    typeof o.description === "string" &&
    typeof o.estimatedHours === "number" &&
    (o.executionKind === "ai_autonomous" ||
      o.executionKind === "human_confirm_after") &&
    filesOk &&
    coversOk
  );
}

