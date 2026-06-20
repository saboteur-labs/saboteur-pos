import { execFileSync } from 'child_process';

export type HeadState = { kind: 'branch'; name: string } | { kind: 'detached'; sha: string };

export interface Commit {
  sha: string;
  message: string;
  author_ts: string;
}

const FIELD = '\x1f';
const RECORD = '\x1e';

export class GitTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`git timed out after ${timeoutMs}ms`);
    this.name = 'GitTimeoutError';
  }
}

let currentTimeoutMs: number | undefined = undefined;

export function withGitTimeout<T>(timeoutMs: number, fn: () => T): T {
  const prev = currentTimeoutMs;
  currentTimeoutMs = timeoutMs;
  try {
    return fn();
  } finally {
    currentTimeoutMs = prev;
  }
}

function gitRun(repoPath: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', repoPath, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: currentTimeoutMs,
    });
  } catch (err: unknown) {
    const e = err as { code?: string; signal?: string };
    if (currentTimeoutMs !== undefined && (e.code === 'ETIMEDOUT' || e.signal === 'SIGTERM')) {
      throw new GitTimeoutError(currentTimeoutMs);
    }
    throw err;
  }
}

function gitRunSafe(repoPath: string, args: string[]): string | null {
  try {
    return gitRun(repoPath, args);
  } catch (err) {
    if (err instanceof GitTimeoutError) throw err;
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

function parseCommitLog(out: string): Commit[] {
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

export function getRecentCommits(repoPath: string, n: number): Commit[] {
  const format = `%H${FIELD}%aI${FIELD}%B${RECORD}`;
  const out = gitRunSafe(repoPath, ['log', `-n`, String(n), `--format=${format}`]);
  if (out === null || out.length === 0) return [];
  return parseCommitLog(out);
}

export function getCommitsSince(
  repoPath: string,
  sinceIso: string,
  ref?: string,
): Commit[] {
  const format = `%H${FIELD}%aI${FIELD}%B${RECORD}`;
  const args = ['log', `--since=${sinceIso}`, `--format=${format}`];
  if (ref) args.push(ref);
  else args.push('--all');
  const out = gitRunSafe(repoPath, args);
  if (out === null || out.length === 0) return [];
  return parseCommitLog(out);
}

export function listBranches(repoPath: string): string[] {
  const out = gitRunSafe(repoPath, [
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/heads/',
  ]);
  if (out === null) return [];
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Map every commit since `sinceIso` to the list of file paths it changed, in a
 * single `git log` call per repo (avoids a per-commit `git show`). The format is
 * just a record-separator + sha so the name-status lines that follow are
 * unambiguous to parse — no commit body to confuse the boundary. `--first-parent`
 * keeps merge commits from exploding into their whole side branch (they get an
 * empty file set, hence no sub-context attribution).
 */
export function getChangedFilesByCommit(repoPath: string, sinceIso: string): Map<string, string[]> {
  const out = gitRunSafe(repoPath, [
    'log',
    '--first-parent',
    '--all',
    `--since=${sinceIso}`,
    '--name-status',
    `--format=${RECORD}%H`,
  ]);
  const result = new Map<string, string[]>();
  if (out === null || out.length === 0) return result;

  for (const block of out.split(RECORD)) {
    if (block.length === 0) continue;
    const lines = block.split('\n').filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    const sha = lines[0].trim();
    const files: string[] = [];
    for (const line of lines.slice(1)) {
      // `STATUS\tpath` (or `R100\told\tnew` for renames) — take the last field.
      const parts = line.split('\t');
      const path = parts[parts.length - 1].trim();
      if (path.length > 0) files.push(path);
    }
    result.set(sha, files);
  }
  return result;
}

export function getBranchLastActivity(repoPath: string, branch: string): string | null {
  const out = gitRunSafe(repoPath, ['log', '-1', '--format=%aI', branch]);
  if (out === null) return null;
  const trimmed = out.trim();
  return trimmed.length > 0 ? trimmed : null;
}
