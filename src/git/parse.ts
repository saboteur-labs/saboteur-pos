const TASK_ID_PATTERN = /\[task_[0-9a-f]{8}\]/g;

export function extractTaskIds(message: string): string[] {
  const matches = message.match(TASK_ID_PATTERN);
  if (!matches) return [];
  const ids = matches.map((m) => m.slice(1, -1));
  return Array.from(new Set(ids));
}

const MERGE_PR_PATTERN = /^Merge pull request #(\d+)\b/;
const SQUASH_PR_PATTERN = /\(#(\d+)\)\s*$/;

/** PR number from a GitHub merge-commit subject (`Merge pull request #N …`). */
export function parseMergePrNumber(subject: string): number | null {
  const m = MERGE_PR_PATTERN.exec(subject);
  return m ? Number(m[1]) : null;
}

/** PR number from a trailing `(#N)`, the subject GitHub writes for a squash merge. */
export function parseSquashPrNumber(subject: string): number | null {
  const m = SQUASH_PR_PATTERN.exec(subject);
  return m ? Number(m[1]) : null;
}
