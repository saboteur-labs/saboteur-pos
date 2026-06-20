import type Database from 'better-sqlite3';

export interface CommitRow {
  sha: string;
  repo: string;
  branch: string | null;
  task_id: string | null;
  message: string;
  author_ts: string;
  sub_context: string | null;
}

export type CommitInput = CommitRow;

export function upsertCommit(db: Database.Database, commit: CommitInput): void {
  db.prepare(
    `INSERT INTO commits (sha, repo, branch, task_id, message, author_ts, sub_context)
     VALUES (@sha, @repo, @branch, @task_id, @message, @author_ts, @sub_context)
     ON CONFLICT(sha) DO UPDATE SET
       repo        = excluded.repo,
       branch      = excluded.branch,
       task_id     = excluded.task_id,
       message     = excluded.message,
       author_ts   = excluded.author_ts,
       sub_context = excluded.sub_context`,
  ).run(commit);
}

export function upsertCommits(db: Database.Database, commits: CommitInput[]): void {
  const tx = db.transaction((batch: CommitInput[]) => {
    for (const c of batch) upsertCommit(db, c);
  });
  tx(commits);
}

export function listCommitsForTask(db: Database.Database, task_id: string): CommitRow[] {
  return db
    .prepare(
      `SELECT sha, repo, branch, task_id, message, author_ts, sub_context
       FROM commits
       WHERE task_id = ?
       ORDER BY author_ts DESC`,
    )
    .all(task_id) as CommitRow[];
}

export function listCommitsForRepoSince(
  db: Database.Database,
  repo: string,
  isoTimestamp: string,
): CommitRow[] {
  return db
    .prepare(
      `SELECT sha, repo, branch, task_id, message, author_ts, sub_context
       FROM commits
       WHERE repo = ? AND author_ts >= ?
       ORDER BY author_ts DESC`,
    )
    .all(repo, isoTimestamp) as CommitRow[];
}
