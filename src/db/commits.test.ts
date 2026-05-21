import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { CREATE_TABLES } from './schema.js';
import {
  listCommitsForRepoSince,
  listCommitsForTask,
  upsertCommit,
  upsertCommits,
  type CommitInput,
} from './commits.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(CREATE_TABLES);
  // Seed contexts + tasks so FK references resolve.
  db.prepare(
    `INSERT INTO contexts (id, name, created_at) VALUES ('inbox', 'Inbox', '2026-01-01T00:00:00Z')`,
  ).run();
  for (const id of ['task_aaaaaaaa', 'task_bbbbbbbb', 'task_cccccccc']) {
    db.prepare(
      `INSERT INTO tasks (id, title, state, context_id, created_at, updated_at)
       VALUES (?, ?, 'backlog', 'inbox', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    ).run(id, `Task ${id}`);
  }
  return db;
}

function commit(overrides: Partial<CommitInput> = {}): CommitInput {
  return {
    sha: 'a'.repeat(40),
    repo: 'demo',
    branch: 'main',
    task_id: null,
    message: 'msg',
    author_ts: '2026-05-01T12:00:00Z',
    ...overrides,
  };
}

describe('commits DB layer', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  it('upsertCommit inserts a new row', () => {
    upsertCommit(db, commit({ sha: 'a'.repeat(40), task_id: null }));
    const rows = db.prepare(`SELECT * FROM commits`).all();
    expect(rows).toHaveLength(1);
  });

  it('upsertCommit overwrites by sha (no duplicates)', () => {
    upsertCommit(db, commit({ sha: 'b'.repeat(40), message: 'first' }));
    upsertCommit(db, commit({ sha: 'b'.repeat(40), message: 'second' }));
    const rows = db.prepare(`SELECT message FROM commits`).all() as Array<{ message: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe('second');
  });

  it('listCommitsForTask returns rows newest-first', () => {
    upsertCommits(db, [
      commit({ sha: '1'.repeat(40), task_id: 'task_aaaaaaaa', author_ts: '2026-01-01T00:00:00Z' }),
      commit({ sha: '2'.repeat(40), task_id: 'task_aaaaaaaa', author_ts: '2026-03-01T00:00:00Z' }),
      commit({ sha: '3'.repeat(40), task_id: 'task_aaaaaaaa', author_ts: '2026-02-01T00:00:00Z' }),
      commit({ sha: '4'.repeat(40), task_id: 'task_bbbbbbbb', author_ts: '2026-04-01T00:00:00Z' }),
    ]);
    const rows = listCommitsForTask(db, 'task_aaaaaaaa');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.author_ts)).toEqual([
      '2026-03-01T00:00:00Z',
      '2026-02-01T00:00:00Z',
      '2026-01-01T00:00:00Z',
    ]);
  });

  it('listCommitsForRepoSince honours the cutoff', () => {
    upsertCommits(db, [
      commit({ sha: '1'.repeat(40), repo: 'alpha', author_ts: '2026-01-01T00:00:00Z' }),
      commit({ sha: '2'.repeat(40), repo: 'alpha', author_ts: '2026-05-01T00:00:00Z' }),
      commit({ sha: '3'.repeat(40), repo: 'alpha', author_ts: '2026-06-01T00:00:00Z' }),
      commit({ sha: '4'.repeat(40), repo: 'beta',  author_ts: '2026-06-01T00:00:00Z' }),
    ]);
    const rows = listCommitsForRepoSince(db, 'alpha', '2026-04-01T00:00:00Z');
    expect(rows.map((r) => r.sha)).toEqual([
      '3'.repeat(40),
      '2'.repeat(40),
    ]);
  });

  it('upsertCommits wraps the batch in a single transaction', () => {
    // If the second insert fails, the first must roll back.
    const good = commit({ sha: 'c'.repeat(40) });
    const bad = { ...commit({ sha: 'd'.repeat(40) }), repo: null as unknown as string };
    expect(() => upsertCommits(db, [good, bad])).toThrow();
    const count = (db.prepare(`SELECT COUNT(*) as c FROM commits`).get() as { c: number }).c;
    expect(count).toBe(0);
  });
});
