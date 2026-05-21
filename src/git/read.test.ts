import { execSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBranch, getHeadState, getRecentCommits, isDirty } from './read.js';

const GIT_ENV = '-c user.email=test@test -c user.name=Test';

function git(cwd: string, args: string): string {
  return execSync(`git ${GIT_ENV} ${args}`, { cwd, encoding: 'utf-8' });
}

function makeCommit(cwd: string, file: string, content: string, message: string): void {
  writeFileSync(join(cwd, file), content);
  git(cwd, `add ${file}`);
  git(cwd, `commit -q -m "${message}"`);
}

describe('git read primitives', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'sab-read-'));
    git(repo, 'init -q -b main');
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  describe('getHeadState', () => {
    it('returns branch state for a normal HEAD', () => {
      makeCommit(repo, 'a.txt', 'hello', 'initial');
      const state = getHeadState(repo);
      expect(state.kind).toBe('branch');
      if (state.kind === 'branch') {
        expect(state.name).toBe('main');
      }
    });

    it('returns detached state with 7-char sha when HEAD is detached', () => {
      makeCommit(repo, 'a.txt', 'hello', 'initial');
      const sha = git(repo, 'rev-parse HEAD').trim();
      git(repo, `checkout -q ${sha}`);
      const state = getHeadState(repo);
      expect(state.kind).toBe('detached');
      if (state.kind === 'detached') {
        expect(state.sha).toHaveLength(7);
        expect(sha.startsWith(state.sha)).toBe(true);
      }
    });
  });

  describe('getBranch', () => {
    it('returns the branch name on a normal HEAD', () => {
      makeCommit(repo, 'a.txt', 'hello', 'initial');
      expect(getBranch(repo)).toBe('main');
    });

    it('returns null on detached HEAD', () => {
      makeCommit(repo, 'a.txt', 'hello', 'initial');
      const sha = git(repo, 'rev-parse HEAD').trim();
      git(repo, `checkout -q ${sha}`);
      expect(getBranch(repo)).toBeNull();
    });
  });

  describe('isDirty', () => {
    it('returns false on a clean repo', () => {
      makeCommit(repo, 'a.txt', 'hello', 'initial');
      expect(isDirty(repo)).toBe(false);
    });

    it('returns true with an untracked file', () => {
      makeCommit(repo, 'a.txt', 'hello', 'initial');
      writeFileSync(join(repo, 'b.txt'), 'untracked');
      expect(isDirty(repo)).toBe(true);
    });

    it('returns true with an unstaged modification', () => {
      makeCommit(repo, 'a.txt', 'hello', 'initial');
      writeFileSync(join(repo, 'a.txt'), 'changed');
      expect(isDirty(repo)).toBe(true);
    });
  });

  describe('getRecentCommits', () => {
    it('returns commits newest-first with sha, message, and author_ts', () => {
      makeCommit(repo, 'a.txt', '1', 'first');
      makeCommit(repo, 'b.txt', '2', 'second');
      makeCommit(repo, 'c.txt', '3', 'third');
      const commits = getRecentCommits(repo, 3);
      expect(commits).toHaveLength(3);
      expect(commits[0].message).toContain('third');
      expect(commits[1].message).toContain('second');
      expect(commits[2].message).toContain('first');
      for (const c of commits) {
        expect(c.sha).toMatch(/^[0-9a-f]{40}$/);
        expect(c.author_ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    });

    it('honours the n parameter', () => {
      makeCommit(repo, 'a.txt', '1', 'first');
      makeCommit(repo, 'b.txt', '2', 'second');
      makeCommit(repo, 'c.txt', '3', 'third');
      expect(getRecentCommits(repo, 2)).toHaveLength(2);
    });

    it('returns an empty array for a repo with no commits', () => {
      expect(getRecentCommits(repo, 5)).toEqual([]);
    });

    it('preserves multi-line commit messages', () => {
      makeCommit(repo, 'a.txt', '1', 'subject\n\nbody line');
      const commits = getRecentCommits(repo, 1);
      expect(commits[0].message).toContain('subject');
      expect(commits[0].message).toContain('body line');
    });
  });
});
