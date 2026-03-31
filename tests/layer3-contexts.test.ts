import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, sabConfig, type TestEnv } from './helpers.js';

function extractId(stdout: string): string {
  const match = stdout.match(/(task_[a-f0-9]+)/);
  if (!match) throw new Error(`No task ID found in: ${stdout}`);
  return match[1];
}

describe('Layer 3 — Contexts', () => {
  let env: TestEnv;

  beforeEach(() => { env = createTestEnv(); });
  afterEach(() => env.cleanup());

  it('sab context new creates a context', () => {
    const result = sabConfig('context new work --name "Work"', env);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Created context: work');
  });

  it('sab context list shows inbox and created contexts', () => {
    sabConfig('context new work', env);
    const result = sabConfig('context list', env);
    expect(result.stdout).toContain('inbox');
    expect(result.stdout).toContain('work');
  });

  it('sab context use sets active context', () => {
    sabConfig('context new work', env);
    sabConfig('context use work', env);
    const result = sabConfig('context show', env);
    expect(result.stdout.trim()).toBe('work');
  });

  it('inbox cannot be deleted', () => {
    const result = sabConfig('context delete inbox', env);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('inbox is a reserved context');
  });

  it('delete with items requires --reassign or --force', () => {
    sabConfig('context new work', env);
    sabConfig('task add "Work task" --context work', env);
    const result = sabConfig('context delete work', env);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Use --reassign');
  });

  it('--force orphans items to inbox', () => {
    sabConfig('context new work', env);
    const addResult = sabConfig('task add "Work task" --context work', env);
    const id = extractId(addResult.stdout);
    sabConfig('context delete work --force', env);

    const view = sabConfig(`task view ${id}`, env);
    expect(view.stdout).toContain('Context:  inbox');
  });

  it('--reassign migrates items to target', () => {
    sabConfig('context new work', env);
    sabConfig('context new personal', env);
    const addResult = sabConfig('task add "Work task" --context work', env);
    const id = extractId(addResult.stdout);
    sabConfig('context delete work --reassign personal', env);

    const view = sabConfig(`task view ${id}`, env);
    expect(view.stdout).toContain('Context:  personal');
  });

  it('sab task list scopes to active context', () => {
    sabConfig('context new work', env);
    sabConfig('task add "Inbox task"', env);
    sabConfig('task add "Work task" --context work', env);

    const result = sabConfig('task list', env);
    expect(result.stdout).toContain('Inbox task');
    expect(result.stdout).not.toContain('Work task');
  });

  it('--all bypasses context filter', () => {
    sabConfig('context new work', env);
    sabConfig('task add "Inbox task"', env);
    sabConfig('task add "Work task" --context work', env);

    const result = sabConfig('task list --all', env);
    expect(result.stdout).toContain('Inbox task');
    expect(result.stdout).toContain('Work task');
  });

  it('invalid slug format rejected', () => {
    const result = sabConfig('context new "My Work"', env);
    expect(result.code).toBe(1);
  });

  it('inbox slug reserved', () => {
    const result = sabConfig('context new inbox', env);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("'inbox' is a reserved context name");
  });
});
