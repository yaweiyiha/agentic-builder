/**
 * Document agent generation settings. Keeps DeepSeek direct long-doc budgets
 * separate from OpenRouter's more conservative defaults.
 */
function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function usesOpenRouter(): boolean {
  const provider = process.env.LLM_PROVIDER?.trim().toLowerCase();
  return (
    provider === "openrouter" ||
    isTruthyEnvFlag(process.env.USE_OPENROUTER) ||
    isTruthyEnvFlag(process.env.FORCE_OPENROUTER)
  );
}

function readTokenEnv(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function resolveDocMaxTokens(
  envName: string,
  defaults: { deepseek: number; openrouter: number },
): number {
  return readTokenEnv(envName) ?? (usesOpenRouter() ? defaults.openrouter : defaults.deepseek);
}

export function docGenerationThinking(): undefined {
  return undefined;
}
