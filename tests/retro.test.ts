import { existsSync, readFileSync } from 'fs';
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

function extractPath(stdout: string): string {
  const match = stdout.match(/→ (.+\.md)/);
  if (!match) throw new Error(`No note path found in: ${stdout}`);
  return match[1].trim();
}

const FULL_INPUT = Array.from({ length: 10 }, (_, i) => `answer ${i + 1}`).join('\n') + '\n';
const DAILY_INPUT = 'answer 1\nanswer 2\nanswer 3\n';

describe('sab retro', () => {
  let env: TestEnv;

  beforeEach(() => { env = createTestEnv(); });
  afterEach(() => env.cleanup());

  it('sab retro --help runs without crashing', () => {
    const result = sabConfig('retro --help', env);
    expect(result.code).toBe(0);
  });

  it('missing --scope errors with non-zero exit and no note created', () => {
    const before = sabConfig('note find --tag retro', env);
    const result = sabConfig('retro', env, FULL_INPUT);
    expect(result.code).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain('--scope');
    const after = sabConfig('note find --tag retro', env);
    expect(after.stdout).toBe(before.stdout);
  });

  it('invalid --scope value errors', () => {
    const result = sabConfig('retro --scope bogus', env, FULL_INPUT);
    expect(result.code).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain('project, feature, daily');
  });

  it('--all is rejected for retro too', () => {
    const result = sabConfig('retro --all --scope project', env, FULL_INPUT);
    expect(result.code).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain('--all');
  });

  it('--scope daily asks exactly 3 questions and defaults scope_ref to today', () => {
    const result = sabConfig('retro --scope daily', env, DAILY_INPUT);
    expect(result.code).toBe(0);
    const notePath = extractPath(result.stdout);
    const content = readFileSync(notePath, 'utf-8') as string;
    expect(content).toContain('scope: daily');
    const today = new Date().toISOString().slice(0, 10);
    expect(content).toContain(`scope_ref: '${today}'`);
    // only the 3 daily questions should appear
    expect(content).toContain('What actually happened?');
    expect(content).toContain('What surprised you?');
    expect(content).toContain("What's the concrete next step or follow-up?");
    expect(content).not.toContain('What did you expect going in?');
  });

  it('--scope daily respects an explicit --date', () => {
    const result = sabConfig('retro --scope daily --date 2026-01-15', env, DAILY_INPUT);
    expect(result.code).toBe(0);
    const notePath = extractPath(result.stdout);
    const content = readFileSync(notePath, 'utf-8') as string;
    expect(content).toContain("scope_ref: '2026-01-15'");
  });

  it('rejects a malformed --date', () => {
    const result = sabConfig('retro --scope daily --date not-a-date', env, DAILY_INPUT);
    expect(result.code).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain('date');
  });

  it('--scope project asks the full 10-question set and scopes to context slug', () => {
    const result = sabConfig('retro --scope project', env, FULL_INPUT);
    expect(result.code).toBe(0);
    const notePath = extractPath(result.stdout);
    const content = readFileSync(notePath, 'utf-8') as string;
    expect(content).toContain('scope: project');
    expect(content).toContain("scope_ref: inbox");
    expect(content).toContain('What did you expect going in?');
    expect(content).toContain("What's the concrete next step or follow-up?");
  });

  it('--scope feature requires --task', () => {
    const result = sabConfig('retro --scope feature', env, FULL_INPUT);
    expect(result.code).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain('--task');
  });

  it('--scope feature rejects a nonexistent task id', () => {
    const result = sabConfig('retro --scope feature --task task_doesnotexist', env, FULL_INPUT);
    expect(result.code).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain('not found');
  });

  it('--scope feature with a valid task succeeds, asks 10 questions, and is tagged/scoped correctly', () => {
    const { stdout: taskOut } = sabConfig('task add "Feature retro subject"', env);
    const taskId = extractTaskId(taskOut);

    const result = sabConfig(`retro --scope feature --task ${taskId}`, env, FULL_INPUT);
    expect(result.code).toBe(0);
    const noteId = extractNoteId(result.stdout);
    const notePath = extractPath(result.stdout);
    expect(existsSync(notePath)).toBe(true);
    const content = readFileSync(notePath, 'utf-8') as string;
    expect(content).toContain('scope: feature');
    expect(content).toContain(`scope_ref: ${taskId}`);
    expect(content).toContain('What did you expect going in?');

    const findResult = sabConfig('note find --tag retro', env);
    expect(findResult.stdout).toContain(noteId);
  });

  it('project recap shows a done task within the lookback window before prompting', () => {
    const { stdout: taskOut } = sabConfig('task add "Ship the retro recap"', env);
    const taskId = extractTaskId(taskOut);

    sabConfig(`task move ${taskId} active`, env);
    sabConfig(`task move ${taskId} review`, env);
    sabConfig(`task move ${taskId} done`, env);

    const result = sabConfig('retro --scope project', env, FULL_INPUT);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(taskId);
    expect(result.stdout).toContain('Ship the retro recap');
  });
});
