import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import matter from 'gray-matter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CREATE_TABLES } from '../../db/schema.js';
import type { Config } from '../../config.js';
import { createCheckinNote } from './writeCheckinNote.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(CREATE_TABLES);
  db.prepare(
    `INSERT INTO contexts (id, name, created_at) VALUES ('inbox', 'Inbox', '2026-01-01T00:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO sources (id, type, path, owner, enabled) VALUES ('personal-notes', 'note', ?, 'core', 1)`,
  ).run('/tmp/unused');
  return db;
}

describe('createCheckinNote', () => {
  let db: Database.Database;
  let notesDir: string;
  let config: Config;

  beforeEach(() => {
    db = makeDb();
    notesDir = mkdtempSync(join(tmpdir(), 'sab-checkin-test-'));
    config = {
      version: '1',
      db_path: ':memory:',
      secrets_path: '/tmp/secrets.json',
      repos_dir: notesDir,
      active_context: 'inbox',
      briefing: { stale_task_days: 3, stale_branch_days: 14, provider_timeout_ms: 2000 },
      sources: [{ id: 'personal-notes', type: 'note', path: notesDir, owner: 'core', enabled: true }],
    };
  });

  afterEach(() => {
    rmSync(notesDir, { recursive: true, force: true });
  });

  it('writes a file and an index row, and returns {id, path}', () => {
    const result = createCheckinNote(db, config, {
      title: 'Standup',
      tags: ['standup'],
      extraFrontmatter: { slot: 'wd-1' },
      body: 'Plan: ship the thing.',
      contextId: 'inbox',
    });

    expect(existsSync(result.path)).toBe(true);
    expect(result.id).toMatch(/^note_/);

    const raw = readFileSync(result.path, 'utf-8');
    const parsed = matter(raw);
    expect(parsed.data.id).toBe(result.id);
    expect(parsed.data.title).toBe('Standup');
    expect(parsed.data.tags).toEqual(['standup']);
    expect(parsed.data.context).toBe('inbox');
    expect(parsed.data.slot).toBe('wd-1');
    expect(parsed.content.trim()).toBe('Plan: ship the thing.');

    const row = db.prepare(`SELECT * FROM knowledge_index WHERE id = ?`).get(result.id) as {
      id: string;
      type: string;
      context_id: string;
      path: string;
      tags: string;
    };
    expect(row).toBeDefined();
    expect(row.type).toBe('note');
    expect(row.context_id).toBe('inbox');
    expect(row.path).toBe(result.path);
    expect(JSON.parse(row.tags)).toEqual(['standup']);
  });

  it('never overwrites: two calls with identical title/tags/date produce distinct files that both persist', () => {
    const first = createCheckinNote(db, config, {
      title: 'Standup',
      tags: ['standup'],
      extraFrontmatter: { slot: 'wd-1' },
      body: 'First entry.',
      contextId: 'inbox',
    });
    const second = createCheckinNote(db, config, {
      title: 'Standup',
      tags: ['standup'],
      extraFrontmatter: { slot: 'wd-1' },
      body: 'Second entry.',
      contextId: 'inbox',
    });

    expect(first.path).not.toBe(second.path);
    expect(existsSync(first.path)).toBe(true);
    expect(existsSync(second.path)).toBe(true);
    expect(readFileSync(first.path, 'utf-8')).toContain('First entry.');
    expect(readFileSync(second.path, 'utf-8')).toContain('Second entry.');

    const count = (db.prepare(`SELECT COUNT(*) as c FROM knowledge_index`).get() as { c: number }).c;
    expect(count).toBe(2);
  });
});
