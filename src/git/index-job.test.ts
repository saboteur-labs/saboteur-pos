import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { CREATE_TABLES } from '../db/schema.js';
import { indexCommits } from './index-job.js';

const GIT = '-c user.email=test@test -c user.name=Test';

function git(cwd: string, args: string): string {
  return execSync(`git ${GIT} ${args}`, { cwd, encoding: 'utf-8' });
}

function makeCommit(cwd: string, file: string, content: string, message: string): void {
  writeFileSync(join(cwd, file), content);
  git(cwd, `add ${file}`);
  git(cwd, `commit -q -m "${message.replace(/"/g, '\\"')}"`);
}

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(CREATE_TABLES);
  db.prepare(
    `INSERT INTO contexts (id, name, created_at) VALUES ('inbox', 'Inbox', '2026-01-01T00:00:00Z')`,
  ).run();
  return db;
}

function seedTask(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO tasks (id, title, state, context_id, created_at, updated_at)
     VALUES (?, ?, 'backlog', 'inbox', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  ).run(id, `Title ${id}`);
}

function configFor(reposDir: string): Config {
  return {
    version: '1',
    db_path: ':memory:',
    secrets_path: '/tmp/secrets',
    repos_dir: reposDir,
    active_context: 'inbox',
    briefing: { stale_task_days: 3, stale_branch_days: 14, provider_timeout_ms: 2000 },
    sources: [],
  };
}

describe('indexCommits', () => {
  let root: string;
  let db: Database.Database;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sab-index-'));
    db = makeDb();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    db.close();
  });

  it('indexes only commits whose bracketed task ID matches a known task', () => {
    seedTask(db, 'task_a1b2c3d4');
    const repo = join(root, 'demo');
    mkdirSync(repo);
    git(repo, 'init -q -b main');
    makeCommit(repo, 'a.txt', '1', 'plain commit, no id');
    makeCommit(repo, 'b.txt', '2', 'add feature [task_a1b2c3d4]');
    makeCommit(repo, 'c.txt', '3', 'unknown ref [task_deadbeef]');

    const result = indexCommits(db, configFor(root));

    expect(result.reposScanned).toBe(1);
    const rows = db.prepare(`SELECT sha, repo, branch, task_id, message FROM commits`).all() as Array<{
      sha: string; repo: string; branch: string | null; task_id: string; message: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].task_id).toBe('task_a1b2c3d4');
    expect(rows[0].repo).toBe('demo');
    expect(rows[0].branch).toBe('main');
    expect(rows[0].message).toContain('add feature');
  });

  it('is idempotent on re-run', () => {
    seedTask(db, 'task_a1b2c3d4');
    const repo = join(root, 'demo');
    mkdirSync(repo);
    git(repo, 'init -q -b main');
    makeCommit(repo, 'a.txt', '1', 'work [task_a1b2c3d4]');

    indexCommits(db, configFor(root));
    const firstCount = (db.prepare(`SELECT COUNT(*) as c FROM commits`).get() as { c: number }).c;
    indexCommits(db, configFor(root));
    const secondCount = (db.prepare(`SELECT COUNT(*) as c FROM commits`).get() as { c: number }).c;

    expect(firstCount).toBe(1);
    expect(secondCount).toBe(1);
  });

  it('handles multiple repos and skips non-repo dirs', () => {
    seedTask(db, 'task_aaaaaaaa');
    seedTask(db, 'task_bbbbbbbb');
    const repoA = join(root, 'alpha');
    mkdirSync(repoA);
    git(repoA, 'init -q -b main');
    makeCommit(repoA, 'a.txt', '1', 'first [task_aaaaaaaa]');

    const repoB = join(root, 'beta');
    mkdirSync(repoB);
    git(repoB, 'init -q -b main');
    makeCommit(repoB, 'b.txt', '1', 'second [task_bbbbbbbb]');

    mkdirSync(join(root, 'not-a-repo'));

    const result = indexCommits(db, configFor(root));
    expect(result.reposScanned).toBe(2);
    const rows = db.prepare(`SELECT repo, task_id FROM commits ORDER BY repo`).all();
    expect(rows).toEqual([
      { repo: 'alpha', task_id: 'task_aaaaaaaa' },
      { repo: 'beta',  task_id: 'task_bbbbbbbb' },
    ]);
  });

  it('respects the horizon window', () => {
    seedTask(db, 'task_a1b2c3d4');
    const repo = join(root, 'demo');
    mkdirSync(repo);
    git(repo, 'init -q -b main');

    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(join(repo, 'old.txt'), 'x');
    git(repo, 'add old.txt');
    execSync(
      `GIT_AUTHOR_DATE="${oldDate}" GIT_COMMITTER_DATE="${oldDate}" git ${GIT} commit -q -m "old [task_a1b2c3d4]"`,
      { cwd: repo },
    );

    makeCommit(repo, 'new.txt', 'y', 'new [task_a1b2c3d4]');

    indexCommits(db, configFor(root), { horizonDays: 60 });
    const rows = db.prepare(`SELECT message FROM commits`).all() as Array<{ message: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toContain('new');
  });
});
