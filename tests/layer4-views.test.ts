import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, sabConfig, type TestEnv } from './helpers.js';

function extractId(stdout: string): string {
  const match = stdout.match(/(task_[a-f0-9]+)/);
  if (!match) throw new Error(`No task ID found in: ${stdout}`);
  return match[1];
}

describe('Layer 4 — Derived Task Views', () => {
  let env: TestEnv;

  beforeEach(() => { env = createTestEnv(); });
  afterEach(() => env.cleanup());

  function addAndActivate(title: string, flags = ''): string {
    const { stdout } = sabConfig(`task add "${title}" ${flags}`, env);
    const id = extractId(stdout);
    sabConfig(`task move ${id} active`, env);
    return id;
  }

  it('active view shows only active tasks', () => {
    const aId = addAndActivate('Active task');
    const bRes = sabConfig('task add "Backlog task"', env);
    const bId = extractId(bRes.stdout);
    void bId;

    const result = sabConfig('task list --view active', env);
    expect(result.stdout).toContain('Active task');
    expect(result.stdout).not.toContain('Backlog task');
  });

  it('backlog view shows only backlog tasks', () => {
    addAndActivate('Active task');
    sabConfig('task add "Backlog task"', env);

    const result = sabConfig('task list --view backlog', env);
    expect(result.stdout).not.toContain('Active task');
    expect(result.stdout).toContain('Backlog task');
  });

  it('today view sorts by priority desc, energy desc', () => {
    const lowId = addAndActivate('Low task', '--priority low');
    const critId = addAndActivate('Critical deep task', '--priority critical --energy deep');
    const highId = addAndActivate('High shallow task', '--priority high --energy shallow');

    const result = sabConfig('task list --view today', env);
    const critPos = result.stdout.indexOf('Critical deep task');
    const highPos = result.stdout.indexOf('High shallow task');
    const lowPos = result.stdout.indexOf('Low task');

    expect(critPos).toBeLessThan(highPos);
    expect(highPos).toBeLessThan(lowPos);
  });

  it('deep-work view excludes tasks with blocked_by', () => {
    const aId = addAndActivate('Deep task A', '--energy deep');
    const bId = addAndActivate('Deep task B', '--energy deep');
    // Link aId blocks bId — then bId has blocked_by set
    sabConfig(`task link ${aId} --blocks ${bId}`, env);

    const result = sabConfig('task list --view deep-work', env);
    expect(result.stdout).toContain('Deep task A');
    expect(result.stdout).not.toContain('Deep task B');
  });

  it('blocked view shows blocked tasks', () => {
    const id = addAndActivate('Blocked task');
    sabConfig(`task block ${id}`, env);

    const result = sabConfig('task list --view blocked', env);
    expect(result.stdout).toContain('Blocked task');
  });

  it('review view shows in-review tasks', () => {
    const id = addAndActivate('Review task');
    sabConfig(`task move ${id} review`, env);

    const result = sabConfig('task list --view review', env);
    expect(result.stdout).toContain('Review task');
  });
});
