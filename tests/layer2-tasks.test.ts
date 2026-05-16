import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, sabConfig, type TestEnv } from './helpers.js';

function extractId(stdout: string): string {
  const match = stdout.match(/(task_[a-f0-9]+)/);
  if (!match) throw new Error(`No task ID found in: ${stdout}`);
  return match[1];
}

describe('Layer 2 — Tasks + State Machine', () => {
  let env: TestEnv;

  beforeEach(() => { env = createTestEnv(); });
  afterEach(() => env.cleanup());

  it('sab task add creates a task in backlog', () => {
    const result = sabConfig('task add "Fix auth bug"', env);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Created task task_[a-f0-9]+: "Fix auth bug"/);
  });

  it('sab task add with flags sets priority, energy, effort', () => {
    const result = sabConfig('task add "Deep task" --priority high --energy deep --effort m', env);
    expect(result.code).toBe(0);
    const id = extractId(result.stdout);
    const view = sabConfig(`task view ${id}`, env);
    expect(view.stdout).toContain('Priority: high');
    expect(view.stdout).toContain('Energy:   deep');
    expect(view.stdout).toContain('Effort:   m');
  });

  it('sab task list shows created task', () => {
    sabConfig('task add "My task"', env);
    const result = sabConfig('task list', env);
    expect(result.stdout).toContain('My task');
  });

  it('state machine: valid transitions succeed', () => {
    const { stdout } = sabConfig('task add "State test"', env);
    const id = extractId(stdout);

    expect(sabConfig(`task move ${id} active`, env).code).toBe(0);
    expect(sabConfig(`task move ${id} review`, env).code).toBe(0);
    expect(sabConfig(`task done ${id}`, env).code).toBe(0);
  });

  it('state machine: done is terminal', () => {
    const { stdout } = sabConfig('task add "Terminal test"', env);
    const id = extractId(stdout);
    sabConfig(`task move ${id} active`, env);
    sabConfig(`task move ${id} review`, env);
    sabConfig(`task done ${id}`, env);

    const moveBack = sabConfig(`task move ${id} active`, env);
    expect(moveBack.code).toBe(1);
    expect(moveBack.stderr).toContain("No transitions out of 'done'");
  });

  it('state machine: invalid transition rejected with message', () => {
    const { stdout } = sabConfig('task add "Invalid trans"', env);
    const id = extractId(stdout);
    // backlog → done is invalid
    const result = sabConfig(`task move ${id} done`, env);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Cannot move task from 'backlog' to 'done'");
  });

  it('state_history appended on every transition', () => {
    const { stdout } = sabConfig('task add "History test"', env);
    const id = extractId(stdout);
    sabConfig(`task move ${id} active`, env);
    sabConfig(`task move ${id} review`, env);

    const view = sabConfig(`task view ${id}`, env);
    expect(view.stdout).toContain('backlog');
    expect(view.stdout).toContain('active');
    expect(view.stdout).toContain('review');
  });

  it('sab task block sets state to blocked', () => {
    const { stdout } = sabConfig('task add "Block test"', env);
    const id = extractId(stdout);
    sabConfig(`task move ${id} active`, env);
    const result = sabConfig(`task block ${id}`, env);
    expect(result.code).toBe(0);
    const view = sabConfig(`task view ${id}`, env);
    expect(view.stdout).toContain('State:    blocked');
  });

  it('missing title returns error', () => {
    const result = sabConfig('task add', env);
    expect(result.code).not.toBe(0);
  });

  it('unknown context returns error', () => {
    const result = sabConfig('task add "Test" --context nonexistent', env);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("does not exist");
  });

  describe('sab task delete', () => {
    it('deletes a standalone task with no dependencies', () => {
      const { stdout } = sabConfig('task add "Accidental task"', env);
      const id = extractId(stdout);

      const del = sabConfig(`task delete ${id}`, env);
      expect(del.code).toBe(0);
      expect(del.stdout).toContain('Deleted task: Accidental task');

      const view = sabConfig(`task view ${id}`, env);
      expect(view.code).toBe(1);
      expect(view.stderr).toContain('not found');
    });

    it('refuses deletion when task has outgoing dependency links', () => {
      const a = extractId(sabConfig('task add "Blocker"', env).stdout);
      const b = extractId(sabConfig('task add "Dependent"', env).stdout);
      sabConfig(`task link ${a} --blocks ${b}`, env);

      const del = sabConfig(`task delete ${a}`, env);
      expect(del.code).toBe(1);
      expect(del.stderr).toContain('Use --force');
      expect(del.stderr).toContain('1 outgoing');
    });

    it('refuses deletion when task has incoming dependency links', () => {
      const a = extractId(sabConfig('task add "Blocker"', env).stdout);
      const b = extractId(sabConfig('task add "Dependent"', env).stdout);
      sabConfig(`task link ${a} --blocks ${b}`, env);

      const del = sabConfig(`task delete ${b}`, env);
      expect(del.code).toBe(1);
      expect(del.stderr).toContain('Use --force');
      expect(del.stderr).toContain('1 incoming');
    });

    it('--force removes task and cleans up dependency arrays of related tasks', () => {
      const a = extractId(sabConfig('task add "Blocker"', env).stdout);
      const b = extractId(sabConfig('task add "Dependent"', env).stdout);
      sabConfig(`task link ${a} --blocks ${b}`, env);

      const del = sabConfig(`task delete ${a} --force`, env);
      expect(del.code).toBe(0);

      // Dependent's blocked_by should be empty
      const view = sabConfig(`task view ${b}`, env);
      expect(view.stdout).not.toContain(a);
    });

    it('--force auto-unblocks a blocked dependent when blocked_by becomes empty', () => {
      const a = extractId(sabConfig('task add "Blocker"', env).stdout);
      const b = extractId(sabConfig('task add "Dependent"', env).stdout);
      sabConfig(`task move ${b} active`, env);
      sabConfig(`task link ${a} --blocks ${b}`, env);
      sabConfig(`task block ${b}`, env);

      const del = sabConfig(`task delete ${a} --force`, env);
      expect(del.code).toBe(0);

      const view = sabConfig(`task view ${b}`, env);
      expect(view.stdout).toContain('State:    active');
    });

    it('returns error for non-existent task id', () => {
      const del = sabConfig('task delete task_nonexistent', env);
      expect(del.code).toBe(1);
      expect(del.stderr).toContain("not found");
    });
  });
});
