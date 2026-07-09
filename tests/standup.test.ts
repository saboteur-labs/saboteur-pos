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

// pre-work slot asks 5 questions
const PRE_WORK_INPUT = 'Working on the standup feature\nShip the pre-work slot\n3 hours\nFocused\nNone\n';

describe('sab standup', () => {
  let env: TestEnv;

  beforeEach(() => { env = createTestEnv(); });
  afterEach(() => env.cleanup());

  it('sab standup --help runs without crashing', () => {
    const result = sabConfig('standup --help', env);
    expect(result.code).toBe(0);
  });

  it('--all is rejected with a clear error and no note is created', () => {
    const before = sabConfig('note find --tag standup', env);
    const result = sabConfig('standup --all', env, PRE_WORK_INPUT);
    expect(result.code).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain('--all');
    const after = sabConfig('note find --tag standup', env);
    expect(after.stdout).toBe(before.stdout);
  });

  it('--slot pre-work creates a note with slot frontmatter and is discoverable via tag', () => {
    const result = sabConfig('standup --slot pre-work', env, PRE_WORK_INPUT);
    expect(result.code).toBe(0);
    const noteId = extractNoteId(result.stdout);
    const notePath = extractPath(result.stdout);
    expect(existsSync(notePath)).toBe(true);

    const findResult = sabConfig('note find --tag standup', env);
    expect(findResult.stdout).toContain(noteId);
  });

  it('slot inference without --slot produces a note with one of the valid slots', () => {
    const result = sabConfig('standup', env, PRE_WORK_INPUT);
    expect(result.code).toBe(0);
    const notePath = extractPath(result.stdout);
    const content = readFileSync(notePath, 'utf-8') as string;
    const slotMatch = content.match(/slot:\s*(\S+)/);
    expect(slotMatch).not.toBeNull();
    expect(['pre-work', 'wd-1', 'wd-2', 'wd-3', 'post-work']).toContain(slotMatch![1]);
  });

  it('running standup twice creates two distinct notes, neither overwriting the other', () => {
    const first = sabConfig('standup --slot pre-work', env, PRE_WORK_INPUT);
    const second = sabConfig('standup --slot pre-work', env, PRE_WORK_INPUT);

    const firstId = extractNoteId(first.stdout);
    const secondId = extractNoteId(second.stdout);
    const firstPath = extractPath(first.stdout);
    const secondPath = extractPath(second.stdout);

    expect(firstId).not.toBe(secondId);
    expect(firstPath).not.toBe(secondPath);
    expect(existsSync(firstPath)).toBe(true);
    expect(existsSync(secondPath)).toBe(true);
  });

  it('recap shows a done task before prompting', () => {
    const { stdout: taskOut } = sabConfig('task add "Ship the recap"', env);
    const taskId = extractTaskId(taskOut);

    sabConfig(`task move ${taskId} active`, env);
    sabConfig(`task move ${taskId} review`, env);
    sabConfig(`task move ${taskId} done`, env);

    const result = sabConfig('standup --slot pre-work', env, PRE_WORK_INPUT);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(taskId);
    expect(result.stdout).toContain('Ship the recap');
  });

  it('wd-1 slot asks the reduced 2-question set', () => {
    const result = sabConfig('standup --slot wd-1', env, 'Ship the feature\nNone\n');
    expect(result.code).toBe(0);
    const notePath = extractPath(result.stdout);
    const content = readFileSync(notePath, 'utf-8') as string;
    expect(content).toContain("What's the one thing that must get done today?");
    expect(content).toContain('Are there any blockers to clear?');
    expect(content).not.toContain('What are you working on today?');
  });

  it('post-work slot asks the 4-question set', () => {
    const result = sabConfig(
      'standup --slot post-work',
      env,
      'Yes\nSome context switching\nOne review comment\nNone\n',
    );
    expect(result.code).toBe(0);
    const notePath = extractPath(result.stdout);
    const content = readFileSync(notePath, 'utf-8') as string;
    expect(content).toContain('Did you do what you set out to do last session?');
  });

  it('rejects an invalid --slot value', () => {
    const result = sabConfig('standup --slot bogus-slot', env, PRE_WORK_INPUT);
    expect(result.code).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain('invalid slot');
  });
});
