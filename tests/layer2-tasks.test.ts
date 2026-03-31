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
});
