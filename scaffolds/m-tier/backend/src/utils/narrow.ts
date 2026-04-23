// String → literal-union narrowing helpers.
//
// LLM-generated controllers repeatedly write
//   model.status = body.status as "active" | "archived";
// which is unsafe and silently lets garbage through. These helpers give a
// short, type-safe alternative the codegen prompts can point at.

export function parseEnumLiteral<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback?: T,
): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  if (fallback !== undefined) return fallback;
  throw new Error(
    `Invalid enum value: ${String(value)} (allowed: ${allowed.join(", ")})`,
  );
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("Expected an object payload");
}
