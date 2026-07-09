import type Database from 'better-sqlite3';
import type { Config } from '../config.js';
import { upsertCommit, type CommitInput } from '../db/commits.js';
import { listContexts, repoEntries } from '../db/contexts.js';
import { getReposDirs } from '../config.js';
import { attributeSubContext, type SubContextRule } from './globs.js';
import { discoverAllRepos } from './discover.js';
import { extractTaskIds } from './parse.js';
import {
  GitTimeoutError,
  getChangedFilesByCommit,
  getCommitsSince,
  listBranches,
  withGitTimeout,
} from './read.js';

export interface IndexCommitsOptions {
  horizonDays?: number;
  perRepoTimeoutMs?: number;
}

export interface IndexCommitsResult {
  reposScanned: number;
  commitsIndexed: number;
  tasksUpdated: number;
  timedOut: string[];
}

const DEFAULT_HORIZON_DAYS = 60;
const DEFAULT_PER_REPO_TIMEOUT_MS = 500;

interface TaskBranchUpdate {
  repo: string;
  branch: string | null;
  author_ts: string;
}

export function indexCommits(
  db: Database.Database,
  config: Config,
  options: IndexCommitsOptions = {},
): IndexCommitsResult {
  const horizonDays = options.horizonDays ?? DEFAULT_HORIZON_DAYS;
  // Index across all configured roots; collision-excluded basenames are
  // kind 'collision' (not 'working'), so they are skipped — no ambiguous
  // commits.repo rows.
  const repos = discoverAllRepos(getReposDirs(config)).repos.filter((r) => r.kind === 'working');

  const taskIds = new Set(
    (db.prepare(`SELECT id FROM tasks`).all() as Array<{ id: string }>).map((r) => r.id),
  );

  // Pool sub-context path rules per repo, from every context that restricts a
  // repo to sub-paths. A repo with no rules is a normal (whole-repo) repo: its
  // commits are never sub-attributed, so non-monorepo behavior is unchanged.
  const rulesByRepo = new Map<string, SubContextRule[]>();
  for (const ctx of listContexts(db)) {
    for (const entry of repoEntries(ctx)) {
      if (entry.paths.length === 0) continue;
      const list = rulesByRepo.get(entry.repo) ?? [];
      for (const glob of entry.paths) list.push({ glob, context: ctx.id });
      rulesByRepo.set(entry.repo, list);
    }
  }

  const since = new Date(Date.now() - horizonDays * 24 * 60 * 60 * 1000).toISOString();
  const perRepoTimeoutMs = options.perRepoTimeoutMs ?? DEFAULT_PER_REPO_TIMEOUT_MS;
  const toUpsert: CommitInput[] = [];
  const seenShas = new Set<string>();
  const latestPerTask = new Map<string, TaskBranchUpdate>();
  const timedOut: string[] = [];

  for (const repo of repos) {
    try {
      withGitTimeout(perRepoTimeoutMs, () => {
        const rules = rulesByRepo.get(repo.name);
        // Only pay for the changed-file scan when this repo has sub-areas.
        const filesBySha = rules ? getChangedFilesByCommit(repo.path, since) : null;

        const branches = listBranches(repo.path);
        const refs = branches.length > 0 ? branches : [undefined];

        for (const ref of refs) {
          const commits = getCommitsSince(repo.path, since, ref);
          for (const c of commits) {
            if (seenShas.has(c.sha)) continue;
            const ids = extractTaskIds(c.message);
            const knownId = ids.find((id) => taskIds.has(id)) ?? null;
            const subContext = rules
              ? attributeSubContext(filesBySha!.get(c.sha) ?? [], rules)
              : null;
            // Store a commit only if it links to a known task or lands in a
            // declared sub-area — otherwise it's noise we don't index.
            if (!knownId && !subContext) continue;

            seenShas.add(c.sha);
            const branch = ref ?? null;
            toUpsert.push({
              sha: c.sha,
              repo: repo.name,
              branch,
              task_id: knownId,
              message: c.message,
              author_ts: c.author_ts,
              sub_context: subContext,
            });

            // tasks.repo/branch tracking follows the task link only.
            if (knownId) {
              const prev = latestPerTask.get(knownId);
              if (!prev || c.author_ts > prev.author_ts) {
                latestPerTask.set(knownId, { repo: repo.name, branch, author_ts: c.author_ts });
              }
            }
          }
        }
      });
    } catch (err) {
      if (err instanceof GitTimeoutError) {
        timedOut.push(repo.name);
      } else {
        throw err;
      }
    }
  }

  let tasksUpdated = 0;
  if (toUpsert.length > 0 || latestPerTask.size > 0) {
    const apply = db.transaction(() => {
      for (const c of toUpsert) upsertCommit(db, c);
      const update = db.prepare(
        `UPDATE tasks SET repo = ?, branch = ? WHERE id = ?
           AND (repo IS NOT ? OR branch IS NOT ?)`,
      );
      for (const [task_id, info] of latestPerTask) {
        const r = update.run(info.repo, info.branch, task_id, info.repo, info.branch);
        if (r.changes > 0) tasksUpdated += 1;
      }
    });
    apply();
  }

  return {
    reposScanned: repos.length,
    commitsIndexed: toUpsert.length,
    tasksUpdated,
    timedOut,
  };
}
