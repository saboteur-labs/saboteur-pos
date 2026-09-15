import { execSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getBranch,
  getFirstParentLog,
  getHeadState,
  getMergeRangeBodies,
  getOriginHeadTarget,
  getRecentCommits,
  isDirty,
} from './read.js';

const GIT_ENV = '-c user.email=test@test -c user.name=Test';

function git(cwd: string, args: string): string {
  return execSync(`git ${GIT_ENV} ${args}`, { cwd, encoding: 'utf-8' });
}

function makeCommit(cwd: string, file: string, content: string, message: string, dateIso?: string): void {
  writeFileSync(join(cwd, file), content);
  git(cwd, `add ${file}`);
  const env = dateIso ? { ...process.env, GIT_AUTHOR_DATE: dateIso, GIT_COMMITTER_DATE: dateIso } : process.env;
  execSync(`git ${GIT_ENV} commit -q -m "${message}"`, { cwd, env });
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
  describe('getOriginHeadTarget', () => {
    it('returns the branch origin/HEAD points at', () => {
      makeCommit(repo, 'a.txt', '1', 'initial');
      git(repo, 'update-ref refs/remotes/origin/development HEAD');
      git(repo, 'symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/development');
      expect(getOriginHeadTarget(repo)).toBe('development');
    });

    it('returns null when origin/HEAD is unset', () => {
      makeCommit(repo, 'a.txt', '1', 'initial');
      expect(getOriginHeadTarget(repo)).toBeNull();
    });
  });

  describe('getFirstParentLog and getMergeRangeBodies', () => {
    const at = (day: number) => `2026-09-${String(day).padStart(2, '0')}T12:00:00+00:00`;

    beforeEach(() => {
      makeCommit(repo, 'a.txt', '1', 'old direct commit', at(1));
      makeCommit(repo, 'b.txt', '2', 'direct commit [task_aaaaaaaa]', at(10));
      git(repo, 'checkout -q -b feat/x');
      makeCommit(repo, 'c.txt', '3', 'feature part one [task_bbbbbbbb]', at(11));
      makeCommit(repo, 'd.txt', '4', 'feature part two [task_cccccccc]', at(12));
      git(repo, 'checkout -q main');
      execSync(`git ${GIT_ENV} merge -q --no-ff feat/x -m "Merge pull request #7 from org/feat/x"`, {
        cwd: repo,
        env: { ...process.env, GIT_AUTHOR_DATE: at(13), GIT_COMMITTER_DATE: at(13) },
      });
    });

    it('lists first-parent commits in the window, newest first, flagging merges', () => {
      const log = getFirstParentLog(repo, 'main', new Date(at(5)), new Date(at(20)));
      expect(log.map((e) => e.subject)).toEqual([
        'Merge pull request #7 from org/feat/x',
        'direct commit [task_aaaaaaaa]',
      ]);
      expect(log[0].isMerge).toBe(true);
      expect(log[1].isMerge).toBe(false);
      expect(log[1].message).toContain('[task_aaaaaaaa]');
      expect(log[0].sha).toMatch(/^[0-9a-f]{40}$/);
      expect(log[0].author_ts.startsWith('2026-09-13')).toBe(true);
    });

    it('excludes commits authored at or after the window end', () => {
      const log = getFirstParentLog(repo, 'main', new Date(at(5)), new Date(at(13)));
      expect(log.map((e) => e.subject)).toEqual(['direct commit [task_aaaaaaaa]']);
    });

    it('finds in-window commits behind a newer commit authored outside it', () => {
      // A backdated HEAD would prune a `--since` walk before reaching the
      // commits the window is about.
      makeCommit(repo, 'z.txt', '9', 'backdated head', at(2));
      const log = getFirstParentLog(repo, 'main', new Date(at(5)), new Date(at(20)));
      expect(log.map((e) => e.subject)).toEqual([
        'Merge pull request #7 from org/feat/x',
        'direct commit [task_aaaaaaaa]',
      ]);
    });

    it('returns an empty list for an unknown ref', () => {
      expect(getFirstParentLog(repo, 'nope', new Date(at(1)), new Date(at(20)))).toEqual([]);
    });

    it('returns the messages a merge brought in via its second parent', () => {
      const [merge] = getFirstParentLog(repo, 'main', new Date(at(5)), new Date(at(20)));
      const bodies = getMergeRangeBodies(repo, merge.sha);
      expect(bodies).toHaveLength(2);
      expect(bodies.join('\n')).toContain('[task_bbbbbbbb]');
      expect(bodies.join('\n')).toContain('[task_cccccccc]');
      expect(bodies.join('\n')).not.toContain('[task_aaaaaaaa]');
    });
  });
});
