import type Database from 'better-sqlite3';
import type { Config } from '../config.js';
import { upsertCommits, type CommitInput } from '../db/commits.js';
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
}

const DEFAULT_HORIZON_DAYS = 60;

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
        toUpsert.push({
          sha: c.sha,
          repo: repo.name,
          branch: ref ?? null,
          task_id: knownId,
          message: c.message,
          author_ts: c.author_ts,
        });
      }
    }
  }

  if (toUpsert.length > 0) {
    upsertCommits(db, toUpsert);
  }

  return {
    reposScanned: repos.length,
    commitsIndexed: toUpsert.length,
  };
}
