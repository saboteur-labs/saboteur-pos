import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { computeLandedRows } from './landed.js';

const GIT_ENV = '-c user.email=test@test -c user.name=Test';
const at = (day: number) => `2026-09-${String(day).padStart(2, '0')}T12:00:00+00:00`;

function git(cwd: string, args: string, dateIso?: string): string {
  const env = dateIso ? { ...process.env, GIT_AUTHOR_DATE: dateIso, GIT_COMMITTER_DATE: dateIso } : process.env;
  return execSync(`git ${GIT_ENV} ${args}`, { cwd, encoding: 'utf-8', env });
}

function commit(cwd: string, file: string, message: string, day: number): void {
  writeFileSync(join(cwd, file), message);
  git(cwd, `add ${file}`);
  git(cwd, `commit -q -m "${message}"`, at(day));
}

function cfg(over: Partial<Config['briefing']> = {}, repos?: Config['repos']): Config {
  return {
    version: '1',
    db_path: '',
    secrets_path: '',
    repos_dir: '',
    active_context: 'inbox',
    briefing: { stale_task_days: 3, stale_branch_days: 14, provider_timeout_ms: 2000, ...over },
    sources: [],
    repos,
  };
}

const TITLES: Record<string, string> = {
  task_aaaaaaaa: 'squash task',
  task_bbbbbbbb: 'merged task one',
  task_cccccccc: 'merged task two',
};
const lookup = (id: string) => TITLES[id] ?? null;
const window = { start: new Date(at(5)), end: new Date(at(25)) };

describe('computeLandedRows (FR-6, FR-8, FR-9)', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'sab-landed-'));
    git(repo, 'init -q -b main');
    commit(repo, 'a.txt', 'before the window', 1);
    commit(repo, 'b.txt', 'direct commit with unknown id [task_deadbeef]', 10);
    commit(repo, 'c.txt', 'feat: storage backend [task_aaaaaaaa] (#158)', 11);
    git(repo, 'checkout -q -b feat/x');
    commit(repo, 'd.txt', 'part one [task_bbbbbbbb]', 12);
    commit(repo, 'e.txt', 'part two [task_cccccccc] [task_bbbbbbbb]', 13);
    git(repo, 'checkout -q main');
    git(repo, 'merge -q --no-ff feat/x -m "Merge pull request #200 from org/feat/x"', at(14));
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('builds one row per first-parent commit, newest first', () => {
    const r = computeLandedRows(repo, 'demo', cfg(), window, lookup);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.defaultBranch).toBe('main');
    expect(r.droppedCount).toBe(0);
    expect(r.rows.map((row) => row.subject)).toEqual([
      'Merge pull request #200 from org/feat/x',
      'feat: storage backend [task_aaaaaaaa] (#158)',
      'direct commit with unknown id [task_deadbeef]',
    ]);
  });

  it('takes a merge row\'s tasks from the commits it brought in, de-duplicated', () => {
    const r = computeLandedRows(repo, 'demo', cfg(), window, lookup);
    if (r.kind !== 'ok') throw new Error('expected ok');
    const [merge] = r.rows;
    expect(merge.prNumber).toBe(200);
    expect(merge.isMerge).toBe(true);
    expect(merge.shortSha).toHaveLength(7);
    expect(merge.date).toBe('2026-09-14');
    expect(merge.tasks.map((t) => t.title).sort()).toEqual(['merged task one', 'merged task two']);
  });

  it('takes a non-merge row\'s tasks and PR number from its own message', () => {
    const r = computeLandedRows(repo, 'demo', cfg(), window, lookup);
    if (r.kind !== 'ok') throw new Error('expected ok');
    const squash = r.rows[1];
    expect(squash.prNumber).toBe(158);
    expect(squash.tasks).toEqual([{ id: 'task_aaaaaaaa', title: 'squash task' }]);
  });

  it('keeps a row whose task IDs resolve to nothing', () => {
    const r = computeLandedRows(repo, 'demo', cfg(), window, lookup);
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.rows[2].tasks).toEqual([]);
    expect(r.rows[2].prNumber).toBeNull();
  });

  it('caps rows at landed_max_rows and counts the rest', () => {
    const r = computeLandedRows(repo, 'demo', cfg({ landed_max_rows: 2 }), window, lookup);
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.rows).toHaveLength(2);
    expect(r.droppedCount).toBe(1);
  });

  it('skips a repo with no resolvable default branch', () => {
    git(repo, 'branch -q -m main trunk-ish');
    const r = computeLandedRows(repo, 'demo', cfg(), window, lookup);
    expect(r).toMatchObject({ kind: 'skipped', reason: 'no-default-branch' });
  });

  it('passes through the warning for a configured branch that does not exist', () => {
    const r = computeLandedRows(repo, 'demo', cfg({}, { demo: { default_branch: 'trunk' } }), window, lookup);
    expect(r.kind).toBe('ok');
    expect(r.warning).toMatch(/trunk/);
  });
});
