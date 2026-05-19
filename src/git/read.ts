import { execFileSync } from 'child_process';

export type HeadState = { kind: 'branch'; name: string } | { kind: 'detached'; sha: string };

export interface Commit {
  sha: string;
  message: string;
  author_ts: string;
}

const FIELD = '\x1f';
const RECORD = '\x1e';

function gitRun(repoPath: string, args: string[]): string {
  return execFileSync('git', ['-C', repoPath, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitRunSafe(repoPath: string, args: string[]): string | null {
  try {
    return gitRun(repoPath, args);
  } catch {
    return null;
  }
}

export function getHeadState(repoPath: string): HeadState {
  const branch = gitRunSafe(repoPath, ['symbolic-ref', '--short', '-q', 'HEAD']);
  if (branch !== null) {
    return { kind: 'branch', name: branch.trim() };
  }
  const sha = gitRunSafe(repoPath, ['rev-parse', '--short=7', 'HEAD']);
  return { kind: 'detached', sha: (sha ?? '').trim() };
}

export function getBranch(repoPath: string): string | null {
  const state = getHeadState(repoPath);
  return state.kind === 'branch' ? state.name : null;
}

export function isDirty(repoPath: string): boolean {
  const out = gitRunSafe(repoPath, ['status', '--porcelain']);
  if (out === null) return false;
  return out.trim().length > 0;
}

export function getRecentCommits(repoPath: string, n: number): Commit[] {
  const format = `%H${FIELD}%aI${FIELD}%B${RECORD}`;
  const out = gitRunSafe(repoPath, ['log', `-n`, String(n), `--format=${format}`]);
  if (out === null || out.length === 0) return [];

  const records = out.split(RECORD).filter((r) => r.length > 0);
  const commits: Commit[] = [];
  for (const record of records) {
    const trimmed = record.replace(/^\n+/, '');
    const firstSep = trimmed.indexOf(FIELD);
    if (firstSep === -1) continue;
    const secondSep = trimmed.indexOf(FIELD, firstSep + 1);
    if (secondSep === -1) continue;
    const sha = trimmed.slice(0, firstSep);
    const author_ts = trimmed.slice(firstSep + 1, secondSep);
    const message = trimmed.slice(secondSep + 1).replace(/\n+$/, '');
    commits.push({ sha, message, author_ts });
  }
  return commits;
}
