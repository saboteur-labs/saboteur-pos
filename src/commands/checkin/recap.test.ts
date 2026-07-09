import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import matter from 'gray-matter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CREATE_TABLES } from '../../db/schema.js';
import type { Config } from '../../config.js';
import { upsertCommits, type CommitInput } from '../../db/commits.js';
import { blockedInScope, commitsForTasks, doneSince, mostRecentStandup } from './recap.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(CREATE_TABLES);
  db.prepare(
    `INSERT INTO contexts (id, name, created_at) VALUES ('inbox', 'Inbox', '2026-01-01T00:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO sources (id, type, path, owner, enabled) VALUES ('personal-notes', 'note', '/tmp/unused', 'core', 1)`,
  ).run();
  return db;
}

function insertTask(
  db: Database.Database,
  id: string,
  overrides: Partial<{
    title: string;
    state: string;
    blocked_by: string[];
    state_history: Array<{ state: string; timestamp: string }>;
  }> = {},
): void {
  db.prepare(
    `INSERT INTO tasks (id, title, state, context_id, blocked_by, state_history, created_at, updated_at)
     VALUES (?, ?, ?, 'inbox', ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  ).run(
    id,
    overrides.title ?? `Task ${id}`,
    overrides.state ?? 'backlog',
    JSON.stringify(overrides.blocked_by ?? []),
    JSON.stringify(overrides.state_history ?? [{ state: overrides.state ?? 'backlog', timestamp: '2026-01-01T00:00:00Z' }]),
  );
}

describe('doneSince', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  it('returns tasks whose state_history has a done entry at/after the cutoff', () => {
    insertTask(db, 'task_after', {
      state: 'done',
      state_history: [
        { state: 'backlog', timestamp: '2026-01-01T00:00:00Z' },
        { state: 'done', timestamp: '2026-06-05T00:00:00Z' },
      ],
    });
    insertTask(db, 'task_before', {
      state: 'done',
      state_history: [
        { state: 'backlog', timestamp: '2025-01-01T00:00:00Z' },
        { state: 'done', timestamp: '2026-01-15T00:00:00Z' },
      ],
    });

    const results = doneSince(db, 'inbox', '2026-06-01T00:00:00Z');
    expect(results.map((t) => t.id)).toEqual(['task_after']);
  });
});

describe('blockedInScope', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  it('returns blocked tasks paired with resolved blocker titles', () => {
    insertTask(db, 'task_blocker', { title: 'The Blocker', state: 'active' });
    insertTask(db, 'task_blocked', {
      title: 'The Blocked One',
      state: 'blocked',
      blocked_by: ['task_blocker'],
    });

    const results = blockedInScope(db, 'inbox');
    expect(results).toHaveLength(1);
    expect(results[0].task.id).toBe('task_blocked');
    expect(results[0].blockerTitles).toEqual(['The Blocker']);
  });

  it('falls back to the raw id when the blocker task is missing', () => {
    insertTask(db, 'task_blocked', {
      title: 'Orphaned',
      state: 'blocked',
      blocked_by: ['task_ghost'],
    });

    const results = blockedInScope(db, 'inbox');
    expect(results[0].blockerTitles).toEqual(['task_ghost']);
  });
});

describe('commitsForTasks', () => {
  let db: Database.Database;
  let config: Config;
  let repoRoot: string;

  beforeEach(() => {
    db = makeDb();
    repoRoot = mkdtempSync(join(tmpdir(), 'sab-recap-test-'));
    config = {
      version: '1',
      db_path: ':memory:',
      secrets_path: '/tmp/secrets.json',
      repos_dir: repoRoot,
      active_context: 'inbox',
      briefing: { stale_task_days: 3, stale_branch_days: 14, provider_timeout_ms: 2000 },
      sources: [{ id: 'personal-notes', type: 'note', path: repoRoot, owner: 'core', enabled: true }],
    };
    insertTask(db, 'task_aaaaaaaa');
    insertTask(db, 'task_bbbbbbbb');
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns the flattened, deduped commits linked to the given task ids', () => {
    const commit = (overrides: Partial<CommitInput>): CommitInput => ({
      sha: 'a'.repeat(40),
      repo: 'demo',
      branch: 'main',
      task_id: null,
      message: 'msg',
      author_ts: '2026-05-01T12:00:00Z',
      sub_context: null,
      ...overrides,
    });

    upsertCommits(db, [
      commit({ sha: '1'.repeat(40), task_id: 'task_aaaaaaaa', author_ts: '2026-01-01T00:00:00Z' }),
      commit({ sha: '2'.repeat(40), task_id: 'task_aaaaaaaa', author_ts: '2026-03-01T00:00:00Z' }),
      commit({ sha: '3'.repeat(40), task_id: 'task_bbbbbbbb', author_ts: '2026-02-01T00:00:00Z' }),
      commit({ sha: '4'.repeat(40), task_id: null, author_ts: '2026-04-01T00:00:00Z' }),
    ]);

    const results = commitsForTasks(db, config, ['task_aaaaaaaa', 'task_bbbbbbbb']);
    expect(results.map((c) => c.sha).sort()).toEqual(['1'.repeat(40), '2'.repeat(40), '3'.repeat(40)].sort());
  });

  it('returns an empty array when no commits are linked', () => {
    const results = commitsForTasks(db, config, ['task_aaaaaaaa']);
    expect(results).toEqual([]);
  });
});

describe('mostRecentStandup', () => {
  let db: Database.Database;
  let notesDir: string;

  beforeEach(() => {
    db = makeDb();
    notesDir = mkdtempSync(join(tmpdir(), 'sab-recap-standup-'));
  });

  afterEach(() => {
    rmSync(notesDir, { recursive: true, force: true });
  });

  function seedStandup(id: string, createdAt: string, slot: string, body: string): void {
    const filePath = join(notesDir, `${id}.md`);
    const frontmatter = { id, title: 'Standup', tags: ['standup'], context: 'inbox', slot, created_at: createdAt, updated_at: createdAt };
    writeFileSync(filePath, matter.stringify(body, frontmatter), 'utf-8');
    db.prepare(
      `INSERT INTO knowledge_index (id, source_id, type, title, tags, task_id, context_id, path, created_at, updated_at)
       VALUES (?, 'personal-notes', 'note', 'Standup', '["standup"]', NULL, 'inbox', ?, ?, ?)`,
    ).run(id, filePath, createdAt, createdAt);
  }

  it('returns null when no standup note exists', () => {
    expect(mostRecentStandup(db, 'inbox')).toBeNull();
  });

  it('returns the most recently created standup-tagged note in scope', () => {
    mkdirSync(notesDir, { recursive: true });
    seedStandup('note_old', '2026-06-01T00:00:00Z', 'wd-1', 'Old plan.');
    seedStandup('note_new', '2026-06-05T00:00:00Z', 'wd-2', 'New plan.');

    const result = mostRecentStandup(db, 'inbox');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('note_new');
    expect(result?.slot).toBe('wd-2');
    expect(result?.body.trim()).toBe('New plan.');
    expect(result?.frontmatter.title).toBe('Standup');
  });

  it('ignores notes outside the requested context', () => {
    seedStandup('note_other_ctx', '2026-06-05T00:00:00Z', 'wd-2', 'Other context.');
    db.prepare(`UPDATE knowledge_index SET context_id = 'work' WHERE id = 'note_other_ctx'`).run();
    db.prepare(`INSERT INTO contexts (id, name, created_at) VALUES ('work', 'Work', '2026-01-01T00:00:00Z')`).run();

    expect(mostRecentStandup(db, 'inbox')).toBeNull();
  });
});
