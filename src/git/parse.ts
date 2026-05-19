const TASK_ID_PATTERN = /\[task_[0-9a-f]{8}\]/g;

export function extractTaskIds(message: string): string[] {
  const matches = message.match(TASK_ID_PATTERN);
  if (!matches) return [];
  const ids = matches.map((m) => m.slice(1, -1));
  return Array.from(new Set(ids));
}
