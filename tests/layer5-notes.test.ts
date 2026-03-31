import { writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, sabConfig, type TestEnv } from './helpers.js';

function extractTaskId(stdout: string): string {
  const match = stdout.match(/(task_[a-f0-9]+)/);
  if (!match) throw new Error(`No task ID found in: ${stdout}`);
  return match[1];
}

function extractNoteId(stdout: string): string {
  const match = stdout.match(/(note_[a-f0-9]+)/);
  if (!match) throw new Error(`No note ID found in: ${stdout}`);
  return match[1];
}

function writeMdNote(env: TestEnv, filename: string, id: string, title: string, tags: string[] = [], context = 'inbox'): void {
  const content = `---\nid: ${id}\ntitle: ${title}\ntags: [${tags.join(', ')}]\ncontext: ${context}\ncreated_at: 2026-03-26\nupdated_at: 2026-03-26\n---\n\nNote body here.\n`;
  writeFileSync(join(env.notesPath, filename), content, 'utf-8');
}

describe('Layer 5 — Notes, Sync, Wiki-links, Dependencies', () => {
  let env: TestEnv;

  beforeEach(() => { env = createTestEnv(); });
  afterEach(() => env.cleanup());

  it('sab sync indexes .md files from notes directory', () => {
    writeMdNote(env, 'auth-notes.md', 'note_aaaa1111', 'Auth Notes', ['auth', 'backend']);
    const result = sabConfig('sync', env);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Synced 1 entr');
  });

  it('sab sync is idempotent — running twice gives same count', () => {
    writeMdNote(env, 'test.md', 'note_bbbb2222', 'Test Note');
    sabConfig('sync', env);
    const result = sabConfig('sync', env);
    expect(result.stdout).toContain('Synced 1 entr');
  });

  it('sab note list shows indexed notes', () => {
    writeMdNote(env, 'my-note.md', 'note_cccc3333', 'My Note');
    sabConfig('sync', env);
    const result = sabConfig('note list', env);
    expect(result.stdout).toContain('My Note');
  });

  it('sab note find --tag filters by tag', () => {
    writeMdNote(env, 'auth.md', 'note_dddd4444', 'Auth Thoughts', ['auth', 'security']);
    writeMdNote(env, 'perf.md', 'note_eeee5555', 'Perf Notes', ['performance']);
    sabConfig('sync', env);

    const result = sabConfig('note find --tag auth', env);
    expect(result.stdout).toContain('Auth Thoughts');
    expect(result.stdout).not.toContain('Perf Notes');
  });

  it('sab note find --task filters by linked task', () => {
    const { stdout: taskOut } = sabConfig('task add "My task"', env);
    const taskId = extractTaskId(taskOut);

    const noteContent = `---\nid: note_ffff6666\ntitle: Task Note\ntags: []\ntask_id: ${taskId}\ncontext: inbox\ncreated_at: 2026-03-26\nupdated_at: 2026-03-26\n---\n\nBody.\n`;
    writeFileSync(join(env.notesPath, 'task-note.md'), noteContent, 'utf-8');
    sabConfig('sync', env);

    const result = sabConfig(`note find --task ${taskId}`, env);
    expect(result.stdout).toContain('Task Note');
  });

  it('sab note view resolves wiki-links to titles', () => {
    writeMdNote(env, 'linked.md', 'note_aaaa0001', 'Linked Note');
    const refContent = `---\nid: note_aaaa0002\ntitle: Reference Note\ntags: []\ncontext: inbox\ncreated_at: 2026-03-26\nupdated_at: 2026-03-26\n---\n\nSee [[note_aaaa0001]] for details.\n`;
    writeFileSync(join(env.notesPath, 'reference.md'), refContent, 'utf-8');
    sabConfig('sync', env);

    const result = sabConfig('note view note_aaaa0002', env);
    expect(result.stdout).toContain('[[Linked Note]]');
    expect(result.stdout).not.toContain('[[broken:');
  });

  it('unresolved wiki-links show as broken', () => {
    const content = `---\nid: note_aaaa0003\ntitle: Broken Links\ntags: []\ncontext: inbox\ncreated_at: 2026-03-26\nupdated_at: 2026-03-26\n---\n\nSee [[does-not-exist]] here.\n`;
    writeFileSync(join(env.notesPath, 'broken.md'), content, 'utf-8');
    sabConfig('sync', env);

    const result = sabConfig('note view note_aaaa0003', env);
    expect(result.stdout).toContain('[[broken: does-not-exist]]');
  });

  it('task link --blocks creates dependency with cycle detection', () => {
    const aId = extractTaskId(sabConfig('task add "Task A"', env).stdout);
    const bId = extractTaskId(sabConfig('task add "Task B"', env).stdout);
    const cId = extractTaskId(sabConfig('task add "Task C"', env).stdout);

    expect(sabConfig(`task link ${aId} --blocks ${bId}`, env).code).toBe(0);
    expect(sabConfig(`task link ${bId} --blocks ${cId}`, env).code).toBe(0);
    // Cycle: C → A would create A → B → C → A
    const cycleResult = sabConfig(`task link ${cId} --blocks ${aId}`, env);
    expect(cycleResult.code).toBe(1);
    expect(cycleResult.stderr).toContain('circular dependency');
  });

  it('completing blocking task auto-unblocks dependent', () => {
    const aId = extractTaskId(sabConfig('task add "Blocker"', env).stdout);
    const bId = extractTaskId(sabConfig('task add "Dependent"', env).stdout);

    sabConfig(`task move ${aId} active`, env);
    sabConfig(`task link ${aId} --blocks ${bId}`, env);
    sabConfig(`task block ${bId}`, env);

    // Verify B is blocked
    let view = sabConfig(`task view ${bId}`, env);
    expect(view.stdout).toContain('State:    blocked');

    // Done A → B should auto-unblock
    sabConfig(`task move ${aId} review`, env);
    sabConfig(`task done ${aId}`, env);

    view = sabConfig(`task view ${bId}`, env);
    expect(view.stdout).toContain('State:    active');
  });

  it('malformed frontmatter logs warning and does not crash', () => {
    writeFileSync(join(env.notesPath, 'malformed.md'), 'not yaml frontmatter at all\n', 'utf-8');
    const result = sabConfig('sync', env);
    expect(result.code).toBe(0);
    // No crash — may log a warning
  });
});
