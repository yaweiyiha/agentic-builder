export function NonExistentHelper(): string {
  return process.env.SERVICE_NAME?.trim() || 'forum-api';
}
