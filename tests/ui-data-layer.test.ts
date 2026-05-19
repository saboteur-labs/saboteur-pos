import { writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { getDb } from '../src/db/index.js';
import { getTasks, getTaskById } from '../ui/server/data/tasks.js';
import { getNotes, getNoteById } from '../ui/server/data/notes.js';
import { getBriefingData } from '../ui/server/data/briefing.js';
import { createTestEnv, sabConfig, type TestEnv } from './helpers.js';

function extractId(stdout: string): string {
  const match = stdout.match(/(task_[a-f0-9]+)/);
  if (!match) throw new Error(`No task ID found in: ${stdout}`);
  return match[1];
}

describe('UI data layer — tasks', () => {
  let env: TestEnv;

  beforeEach(() => { env = createTestEnv(); });
  afterEach(() => env.cleanup());

  it('getTasks returns all non-done tasks by default', () => {
    sabConfig('task add "Alpha"', env);
    sabConfig('task add "Beta"', env);
    const db = getDb(env.dbPath);
    const tasks = getTasks(db);
    db.close();
    expect(tasks.length).toBe(2);
    const titles = tasks.map((t) => t.title);
    expect(titles).toContain('Alpha');
    expect(titles).toContain('Beta');
  });

  it('getTasks filters by contextId', () => {
    sabConfig('context new work', env);
    sabConfig('task add "Inbox task"', env);
    sabConfig('task add "Work task" --context work', env);
    const db = getDb(env.dbPath);
    const tasks = getTasks(db, { contextId: 'work' });
    db.close();
    expect(tasks.length).toBe(1);
    expect(tasks[0].title).toBe('Work task');
  });

  it('getTasks filters by view=active', () => {
    const { stdout } = sabConfig('task add "My task"', env);
    const id = extractId(stdout);
    sabConfig(`task move ${id} active`, env);
    sabConfig('task add "Backlog task"', env);
    const db = getDb(env.dbPath);
    const active = getTasks(db, { view: 'active' });
    db.close();
    expect(active.every((t) => t.state === 'active')).toBe(true);
    expect(active.some((t) => t.title === 'My task')).toBe(true);
    expect(active.some((t) => t.title === 'Backlog task')).toBe(false);
  });

  it('getTasks filters by view=blocked', () => {
    const { stdout } = sabConfig('task add "Blocked task"', env);
    const id = extractId(stdout);
    sabConfig(`task block ${id}`, env);
    const db = getDb(env.dbPath);
    const blocked = getTasks(db, { view: 'blocked' });
    db.close();
    expect(blocked.length).toBe(1);
    expect(blocked[0].state).toBe('blocked');
  });

  it('getTaskById returns null for unknown id', () => {
    const db = getDb(env.dbPath);
    const result = getTaskById(db, 'task_doesnotexist');
    db.close();
    expect(result).toBeNull();
  });

  it('getTaskById returns a fully parsed task', () => {
    const { stdout } = sabConfig('task add "View me" --priority high --energy deep', env);
    const id = extractId(stdout);
    const db = getDb(env.dbPath);
    const task = getTaskById(db, id);
    db.close();
    expect(task).not.toBeNull();
    expect(task!.title).toBe('View me');
    expect(task!.priority).toBe('high');
    expect(task!.energy).toBe('deep');
    expect(Array.isArray(task!.blocks)).toBe(true);
    expect(Array.isArray(task!.blocked_by)).toBe(true);
    expect(Array.isArray(task!.state_history)).toBe(true);
  });
});

describe('UI data layer — notes', () => {
  let env: TestEnv;

  beforeEach(() => { env = createTestEnv(); });
  afterEach(() => env.cleanup());

  function writeNote(env: TestEnv, filename: string, id: string, title: string, context = 'inbox') {
    const content = `---\nid: ${id}\ntitle: ${title}\ntags: []\ncontext: ${context}\ncreated_at: 2026-01-01\nupdated_at: 2026-01-01\n---\n\nNote body for ${title}.\n`;
    writeFileSync(join(env.notesPath, filename), content, 'utf-8');
    sabConfig('sync', env);
  }

  it('getNotes returns indexed notes', () => {
    writeNote(env, 'alpha.md', 'note_alpha001', 'Alpha Note');
    writeNote(env, 'beta.md', 'note_beta002', 'Beta Note');
    const db = getDb(env.dbPath);
    const notes = getNotes(db);
    db.close();
    expect(notes.length).toBe(2);
    expect(notes.some((n) => n.title === 'Alpha Note')).toBe(true);
  });

  it('getNotes filters by contextId', () => {
    sabConfig('context new work', env);
    writeNote(env, 'inbox.md', 'note_inbox001', 'Inbox Note', 'inbox');
    writeNote(env, 'work.md', 'note_work002', 'Work Note', 'work');
    const db = getDb(env.dbPath);
    const notes = getNotes(db, { contextId: 'work' });
    db.close();
    expect(notes.length).toBe(1);
    expect(notes[0].title).toBe('Work Note');
  });

  it('getNoteById returns null for unknown id', () => {
    const db = getDb(env.dbPath);
    const result = getNoteById(db, 'note_doesnotexist');
    db.close();
    expect(result).toBeNull();
  });

  it('getNoteById returns note with body', () => {
    writeNote(env, 'hello.md', 'note_hello001', 'Hello Note');
    const db = getDb(env.dbPath);
    const note = getNoteById(db, 'note_hello001');
    db.close();
    expect(note).not.toBeNull();
    expect(note!.title).toBe('Hello Note');
    expect(note!.body).toContain('Note body for Hello Note');
  });

  it('getNoteById returns empty body if file is missing from disk', () => {
    writeNote(env, 'temp.md', 'note_temp001', 'Temp Note');
    const db = getDb(env.dbPath);
    // Manually corrupt the path so the file can't be read
    db.prepare(`UPDATE knowledge_index SET path = '/nonexistent/path.md' WHERE id = 'note_temp001'`).run();
    const note = getNoteById(db, 'note_temp001');
    db.close();
    expect(note).not.toBeNull();
    expect(note!.body).toBe('');
  });
});

describe('UI data layer — briefing', () => {
  let env: TestEnv;

  beforeEach(() => { env = createTestEnv(); });
  afterEach(() => env.cleanup());

  it('returns zero counts for empty workspace', () => {
    const db = getDb(env.dbPath);
    const config = loadConfig(env.configPath);
    const data = getBriefingData(db, config);
    db.close();
    expect(data.inboxTaskCount).toBe(0);
    expect(data.inboxNoteCount).toBe(0);
    expect(data.activeTasks).toHaveLength(0);
    expect(data.staleTasks).toHaveLength(0);
    expect(data.blockedTasks).toHaveLength(0);
    expect(data.reviewTasks).toHaveLength(0);
    expect(data.yesterdayNotes).toHaveLength(0);
  });

  it('activeContext and contextName match config', () => {
    const db = getDb(env.dbPath);
    const config = loadConfig(env.configPath);
    const data = getBriefingData(db, config);
    db.close();
    expect(data.activeContext).toBe('inbox');
    expect(data.contextName).toBe('Inbox');
  });

  it('contextId override works', () => {
    sabConfig('context new work', env);
    const db = getDb(env.dbPath);
    const config = loadConfig(env.configPath);
    const data = getBriefingData(db, config, 'work');
    db.close();
    expect(data.activeContext).toBe('work');
  });

  it('inboxTaskCount reflects tasks in inbox context', () => {
    sabConfig('task add "Inbox task"', env);
    const db = getDb(env.dbPath);
    const config = loadConfig(env.configPath);
    const data = getBriefingData(db, config);
    db.close();
    expect(data.inboxTaskCount).toBe(1);
  });

  it('activeTasks sorted priority-first (critical before low)', () => {
    const lowId = extractId(sabConfig('task add "Low task" --priority low', env).stdout);
    const critId = extractId(sabConfig('task add "Critical task" --priority critical', env).stdout);
    sabConfig(`task move ${lowId} active`, env);
    sabConfig(`task move ${critId} active`, env);
    const db = getDb(env.dbPath);
    const config = loadConfig(env.configPath);
    const data = getBriefingData(db, config);
    db.close();
    const critIdx = data.activeTasks.findIndex((t) => t.title === 'Critical task');
    const lowIdx = data.activeTasks.findIndex((t) => t.title === 'Low task');
    expect(critIdx).toBeGreaterThanOrEqual(0);
    expect(critIdx).toBeLessThan(lowIdx);
  });

  it('stale tasks appear in staleTasks and not activeTasks', () => {
    const config = loadConfig(env.configPath);
    config.briefing.stale_task_days = 0;
    writeFileSync(env.configPath, JSON.stringify(config, null, 2));

    const id = extractId(sabConfig('task add "Stale task"', env).stdout);
    sabConfig(`task move ${id} active`, env);

    const db = getDb(env.dbPath);
    const freshConfig = loadConfig(env.configPath);
    const data = getBriefingData(db, freshConfig);
    db.close();

    expect(data.staleTasks.some((t) => t.title === 'Stale task')).toBe(true);
    expect(data.activeTasks.some((t) => t.title === 'Stale task')).toBe(false);
  });

  it('blockedTasks contains tasks in blocked state', () => {
    const id = extractId(sabConfig('task add "Blocked one"', env).stdout);
    sabConfig(`task block ${id}`, env);
    const db = getDb(env.dbPath);
    const config = loadConfig(env.configPath);
    const data = getBriefingData(db, config);
    db.close();
    expect(data.blockedTasks.some((t) => t.title === 'Blocked one')).toBe(true);
  });

  it('reviewTasks contains tasks in review state', () => {
    const id = extractId(sabConfig('task add "In review"', env).stdout);
    sabConfig(`task move ${id} active`, env);
    sabConfig(`task move ${id} review`, env);
    const db = getDb(env.dbPath);
    const config = loadConfig(env.configPath);
    const data = getBriefingData(db, config);
    db.close();
    expect(data.reviewTasks.some((t) => t.title === 'In review')).toBe(true);
  });
});
