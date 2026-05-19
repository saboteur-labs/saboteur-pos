import type Database from 'better-sqlite3';
import type { Config } from '../config.js';
import { upsertCommit, type CommitInput } from '../db/commits.js';
import { resolvePath } from '../config.js';
import { discoverRepos } from './discover.js';
import { extractTaskIds } from './parse.js';
import { getCommitsSince, listBranches } from './read.js';

export interface IndexCommitsOptions {
  horizonDays?: number;
}

export interface IndexCommitsResult {
  reposScanned: number;
  commitsIndexed: number;
  tasksUpdated: number;
}

const DEFAULT_HORIZON_DAYS = 60;

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
  const reposDir = resolvePath(config.repos_dir);
  const repos = discoverRepos(reposDir).filter((r) => r.kind === 'working');

  const taskIds = new Set(
    (db.prepare(`SELECT id FROM tasks`).all() as Array<{ id: string }>).map((r) => r.id),
  );

  const since = new Date(Date.now() - horizonDays * 24 * 60 * 60 * 1000).toISOString();
  const toUpsert: CommitInput[] = [];
  const seenShas = new Set<string>();
  const latestPerTask = new Map<string, TaskBranchUpdate>();

  for (const repo of repos) {
    const branches = listBranches(repo.path);
    const refs = branches.length > 0 ? branches : [undefined];

    for (const ref of refs) {
      const commits = getCommitsSince(repo.path, since, ref);
      for (const c of commits) {
        if (seenShas.has(c.sha)) continue;
        const ids = extractTaskIds(c.message);
        const knownId = ids.find((id) => taskIds.has(id));
        if (!knownId) continue;

        seenShas.add(c.sha);
        const branch = ref ?? null;
        toUpsert.push({
          sha: c.sha,
          repo: repo.name,
          branch,
          task_id: knownId,
          message: c.message,
          author_ts: c.author_ts,
        });

        const prev = latestPerTask.get(knownId);
        if (!prev || c.author_ts > prev.author_ts) {
          latestPerTask.set(knownId, { repo: repo.name, branch, author_ts: c.author_ts });
        }
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
  };
}
