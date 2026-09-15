import { getLandedMaxRows, type Config } from '../config.js';
import type { DateWindow } from '../briefing/window.js';
import { resolveDefaultBranch } from './default-branch.js';
import { extractTaskIds, parseMergePrNumber, parseSquashPrNumber } from './parse.js';
import {
  GitTimeoutError,
  getFirstParentLog,
  getMergeRangeBodies,
  getOriginHeadTarget,
  listBranches,
  withGitTimeout,
  type FirstParentEntry,
} from './read.js';

export interface LandedRow {
  sha: string;
  shortSha: string;
  date: string;
  subject: string;
  isMerge: boolean;
  prNumber: number | null;
  tasks: Array<{ id: string; title: string }>;
}

export type LandedResult =
  | {
      kind: 'ok';
      repo: string;
      defaultBranch: string;
      rows: LandedRow[];
      droppedCount: number;
      warning: string | null;
    }
  | { kind: 'skipped'; repo: string; reason: 'no-default-branch' | 'timeout'; warning: string | null };

/** Resolves a task ID to its title, or null for an unknown ID. */
export type TaskTitleLookup = (taskId: string) => string | null;

function toRow(repoPath: string, entry: FirstParentEntry, lookupTitle: TaskTitleLookup): LandedRow {
  // A merge's tasks live in the commits it brought in; anything else carries
  // its own. PR numbers come from the subject GitHub writes for each case.
  const messages = entry.isMerge ? getMergeRangeBodies(repoPath, entry.sha) : [entry.message];
  const ids = [...new Set(messages.flatMap(extractTaskIds))];
  const tasks = ids.flatMap((id) => {
    const title = lookupTitle(id);
    return title === null ? [] : [{ id, title }];
  });
  return {
    sha: entry.sha,
    shortSha: entry.sha.slice(0, 7),
    date: entry.author_ts.slice(0, 10),
    subject: entry.subject,
    isMerge: entry.isMerge,
    prNumber: entry.isMerge ? parseMergePrNumber(entry.subject) : parseSquashPrNumber(entry.subject),
    tasks,
  };
}

/**
 * Everything that landed on a repo's default branch in `window`: one row per
 * first-parent commit, computed from git on every call and never persisted
 * (FR-10). Read-only and local-only; every git call runs under `timeoutMs`.
 */
export function computeLandedRows(
  repoPath: string,
  repoName: string,
  config: Config,
  window: DateWindow,
  lookupTitle: TaskTitleLookup,
  timeoutMs = 500,
): LandedResult {
  let warning: string | null = null;
  try {
    return withGitTimeout(timeoutMs, (): LandedResult => {
      const resolved = resolveDefaultBranch(repoName, config, {
        originHeadTarget: getOriginHeadTarget(repoPath),
        localBranches: listBranches(repoPath),
      });
      warning = resolved.warning;
      if (resolved.kind === 'unresolved') {
        return { kind: 'skipped', repo: repoName, reason: resolved.reason, warning };
      }

      const entries = getFirstParentLog(repoPath, resolved.branch, window.start, window.end);
      const max = getLandedMaxRows(config);
      // Only rows that will be shown pay for a merge-range read.
      const rows = entries.slice(0, max).map((e) => toRow(repoPath, e, lookupTitle));
      return {
        kind: 'ok',
        repo: repoName,
        defaultBranch: resolved.branch,
        rows,
        droppedCount: Math.max(0, entries.length - max),
        warning,
      };
    });
  } catch (err) {
    if (err instanceof GitTimeoutError) {
      return { kind: 'skipped', repo: repoName, reason: 'timeout', warning };
    }
    throw err;
  }
}
