/**
 * Normalized commands for the unified bottom command bar (continue / regenerate).
 */
export function isContinueCommand(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(continue|yes|ok|proceed|y|go|next)$/i.test(t);
}

export function isRegenerateCommand(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(regenerate|retry|redo|again)$/i.test(t);
}
