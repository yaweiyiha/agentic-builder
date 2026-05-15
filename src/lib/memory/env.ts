/**
 * Three-level memory feature flags. See design doc §12.5.2.
 *
 *   MEMORY_ENABLED — total kill switch (default true)
 *   MEMORY_INJECT  — whether recall results are injected into prompts
 *                    (default false in Phase A → only writes are observed)
 *   MEMORY_CACHE   — whether classification cache is consulted (default true)
 */

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  return fallback;
}

export function memoryEnabled(): boolean {
  return parseBool(process.env.MEMORY_ENABLED, true);
}

export function memoryInjectEnabled(): boolean {
  if (!memoryEnabled()) return false;
  return parseBool(process.env.MEMORY_INJECT, false);
}

export function memoryCacheEnabled(): boolean {
  if (!memoryEnabled()) return false;
  return parseBool(process.env.MEMORY_CACHE, true);
}

/**
 * Phase-specific inject toggles. Default off so PRD/Design memory can be
 * collected for several runs (writes-only) before flipping on prompt
 * injection. Falls back to MEMORY_INJECT when the phase-specific flag is
 * unset, allowing a single global switch when desired.
 */
export function memoryInjectEnabledForPrd(): boolean {
  if (!memoryEnabled()) return false;
  if (process.env.MEMORY_PRD_INJECT !== undefined) {
    return parseBool(process.env.MEMORY_PRD_INJECT, false);
  }
  return memoryInjectEnabled();
}

export function memoryInjectEnabledForDesign(): boolean {
  if (!memoryEnabled()) return false;
  if (process.env.MEMORY_DESIGN_INJECT !== undefined) {
    return parseBool(process.env.MEMORY_DESIGN_INJECT, false);
  }
  return memoryInjectEnabled();
}
