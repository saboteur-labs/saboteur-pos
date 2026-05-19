import { describe, expect, it } from 'vitest';
import { extractTaskIds } from './parse.js';

describe('extractTaskIds', () => {
  it('matches a single bracketed task ID', () => {
    expect(extractTaskIds('fix login bug [task_a1b2c3d4]')).toEqual(['task_a1b2c3d4']);
  });

  it('matches multiple bracketed task IDs in one message', () => {
    expect(
      extractTaskIds('merge [task_a1b2c3d4] and [task_deadbeef]\n\nBody.'),
    ).toEqual(['task_a1b2c3d4', 'task_deadbeef']);
  });

  it('returns an empty array when no IDs are present', () => {
    expect(extractTaskIds('fix login bug')).toEqual([]);
  });

  it('does not match a bare ID (no brackets)', () => {
    expect(extractTaskIds('fix task_a1b2c3d4 login bug')).toEqual([]);
  });

  it('does not match conventional-commit scope', () => {
    expect(extractTaskIds('fix(task_a1b2c3d4): login bug')).toEqual([]);
  });

  it('does not match a short hex prefix', () => {
    expect(extractTaskIds('fix login [task_a1b2]')).toEqual([]);
  });

  it('does not match a git trailer line', () => {
    expect(extractTaskIds('fix login\n\nTask: task_a1b2c3d4')).toEqual([]);
  });

  it('does not match non-hex characters inside brackets', () => {
    expect(extractTaskIds('fix [task_zzzzzzzz]')).toEqual([]);
  });

  it('does not match an ID with the wrong length', () => {
    expect(extractTaskIds('[task_a1b2c3d4e5]')).toEqual([]);
  });

  it('deduplicates repeated IDs in the same message', () => {
    expect(
      extractTaskIds('[task_a1b2c3d4] redo [task_a1b2c3d4]'),
    ).toEqual(['task_a1b2c3d4']);
  });
});
