/**
 * End-to-end net for the Landed section and its Repo State changes, against a
 * real temp git repo driven through the CLI. Each `it` names the FR(s) it
 * covers, so a spec change can find its test fast. Unit-level cases live in
 * src/briefing/window.test.ts, src/git/*.test.ts and tests/layer6-briefing.test.ts.
 */
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultWeekWindow } from '../src/briefing/window.js';
import { createTestEnv, sabConfig, type TestEnv } from './helpers.js';

const GIT_ENV = '-c user.email=test@test -c user.name=Test';
const DAY = 24 * 60 * 60 * 1000;

describe('Landed end-to-end (FR-1 … FR-17)', () => {
  let env: TestEnv;
  let repo: string;
  let taskId: string;
  let agentTaskId: string;

  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => ymd(new Date());

  function git(cwd: string, args: string, when?: Date): string {
    const env2 = when
      ? { ...process.env, GIT_AUTHOR_DATE: when.toISOString(), GIT_COMMITTER_DATE: when.toISOString() }
      : process.env;
    return execSync(`git ${GIT_ENV} ${args}`, { cwd, encoding: 'utf-8', env: env2 });
  }

  function commit(cwd: string, file: string, message: string, when = new Date()): void {
    writeFileSync(join(cwd, file), message);
    git(cwd, `add ${file}`);
    git(cwd, `commit -q -m "${message.replace(/"/g, '\\"')}"`, when);
  }

  function extractId(stdout: string): string {
    const m = stdout.match(/(task_[a-f0-9]+)/);
    if (!m) throw new Error(`No task ID in: ${stdout}`);
    return m[1];
  }

  function landedOf(stdout: string): string {
    const [, section] = stdout.split('── Landed');
    return section ?? '';
  }

  beforeEach(() => {
    env = createTestEnv();
    taskId = extractId(sabConfig('task add "Trash UI"', env).stdout);
    agentTaskId = extractId(sabConfig('task add "Agent work"', env).stdout);

    repo = join(dirname(env.configPath), 'alpha');
    mkdirSync(repo);
    git(repo, 'init -q -b main');
    // Inside the default window: the week start is never in the future, and on
    // the week-start day the window is the previous week, so +1h is always past.
    const inWindow = new Date(defaultWeekWindow(new Date(), 'monday').start.getTime() + 60 * 60 * 1000);

    commit(repo, 'base.txt', 'base commit', new Date(Date.now() - 120 * DAY));
    commit(repo, 'squash.txt', `feat: importer [${taskId}] (#158)`, inWindow);
    git(repo, 'checkout -q -b feat/trash');
    commit(repo, 'a.txt', `trash view [${taskId}]`, inWindow);
    git(repo, 'checkout -q main');
    git(repo, 'merge -q --no-ff feat/trash -m "Merge pull request #200 from org/feat/trash"', inWindow);
    // A leftover agent branch carrying its own task-linked commit.
    git(repo, 'checkout -q -b worktree-agent-a2cf0deef802e26a3');
    commit(repo, 'agent.txt', `agent-only change [${agentTaskId}]`, new Date(Date.now() - 30 * DAY));
    git(repo, 'checkout -q main');
    // origin/HEAD points at a branch that is not the first conventional name.
    git(repo, 'update-ref refs/remotes/origin/main main');
    git(repo, 'symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main');

    sabConfig('context repos add inbox alpha', env);
  });

  afterEach(() => env.cleanup());

  it('renders the default calendar-week window with merge and squash rows (FR-1, FR-6, FR-8)', () => {
    const out = sabConfig('briefing', env).stdout;
    expect(out).toContain('── Landed');
    const landed = landedOf(out);
    expect(landed).toContain('alpha  ');
    expect(landed).toContain('(main)');
    // Merge row: PR number from the subject, tasks from the commits it brought in.
    expect(landed).toMatch(/#200\s+Merge pull request #200 from org\/feat\/trash/);
    // Squash row: PR number from the trailing (#N), task from its own message.
    expect(landed).toMatch(/#158\s+feat: importer/);
    expect(landed).toContain('Trash UI');
    // Header names the window.
    const { start } = defaultWeekWindow(new Date(), 'monday');
    expect(out).toContain(ymd(start));
  });

  it('honours --since/--until past the 60-day index horizon (FR-2, FR-3)', () => {
    const old = new Date(Date.now() - 120 * DAY);
    const landed = landedOf(
      sabConfig(`briefing --since ${ymd(new Date(old.getTime() - DAY))} --until ${ymd(new Date(old.getTime() + DAY))}`, env)
        .stdout,
    );
    expect(landed).toContain('base commit');
    expect(landed).not.toContain('Merge pull request #200');
  });

  it('rejects bad window flags and a bad week_start (FR-1, FR-2)', () => {
    expect(sabConfig('briefing --until 2026-09-10', env).code).not.toBe(0);
    expect(sabConfig(`briefing --since 2026-09-10 --until 2026-09-01`, env).stderr).toContain(
      'is after --until',
    );
    const config = JSON.parse(readFileSync(env.configPath, 'utf-8'));
    config.briefing.week_start = 'someday';
    writeFileSync(env.configPath, JSON.stringify(config, null, 2));
    const bad = sabConfig('briefing', env);
    expect(bad.code).not.toBe(0);
    expect(bad.stderr).toContain('briefing.week_start');
  });

  it('resolves the default branch from config, then origin/HEAD (FR-4, FR-5)', () => {
    // origin/HEAD wins over the conventional-name list on its own.
    expect(landedOf(sabConfig(`briefing --since ${today()}`, env).stdout)).not.toContain('(feat/trash)');

    const config = JSON.parse(readFileSync(env.configPath, 'utf-8'));
    config.repos = { alpha: { default_branch: 'feat/trash' } };
    writeFileSync(env.configPath, JSON.stringify(config, null, 2));
    const configured = sabConfig('briefing', env);
    expect(landedOf(configured.stdout)).toContain('(feat/trash)');

    config.repos = { alpha: { default_branch: 'ghost' } };
    writeFileSync(env.configPath, JSON.stringify(config, null, 2));
    const missing = sabConfig('briefing', env);
    expect(missing.stderr).toContain('"ghost" does not exist locally');
    expect(landedOf(missing.stdout)).toContain('(main)');
  });

  it('caps rows, counts the remainder, and is omitted when empty (FR-9)', () => {
    const config = JSON.parse(readFileSync(env.configPath, 'utf-8'));
    config.briefing.landed_max_rows = 1;
    writeFileSync(env.configPath, JSON.stringify(config, null, 2));
    const capped = landedOf(sabConfig('briefing', env).stdout);
    expect(capped).toContain('Merge pull request #200');
    expect(capped).toContain('+1 more');

    // A window with nothing in it drops the section entirely.
    const quiet = sabConfig('briefing --since 2020-01-01 --until 2020-01-02', env).stdout;
    expect(quiet).not.toContain('── Landed');
  });

  it('writes nothing to the database (FR-10, FR-12)', () => {
    const countRows = () => {
      const db = new Database(env.dbPath, { readonly: true });
      const n = (db.prepare('SELECT COUNT(*) AS c FROM commits').get() as { c: number }).c;
      db.close();
      return n;
    };
    sabConfig('briefing', env); // indexCommits runs here
    const before = countRows();
    const beforeTask = sabConfig(`task view ${taskId}`, env).stdout;
    sabConfig(`briefing --since 2020-01-01 --until ${today()}`, env);
    expect(countRows()).toBe(before);
    expect(sabConfig(`task view ${taskId}`, env).stdout).toBe(beforeTask);
  });

  it('skips a repo whose default branch cannot be resolved (FR-4, FR-11)', () => {
    const orphan = join(dirname(env.configPath), 'beta');
    mkdirSync(orphan);
    git(orphan, 'init -q -b feat/only');
    commit(orphan, 'a.txt', 'orphan work');
    sabConfig('context repos add inbox beta', env);
    expect(landedOf(sabConfig(`briefing --since ${today()}`, env).stdout)).toContain(
      'beta (no-default-branch)',
    );
  });

  it('--all ignores the context repo scope (FR-6)', () => {
    const other = join(dirname(env.configPath), 'gamma');
    mkdirSync(other);
    git(other, 'init -q -b main');
    commit(other, 'g.txt', 'gamma change');
    expect(landedOf(sabConfig(`briefing --since ${today()}`, env).stdout)).not.toContain('gamma change');
    expect(landedOf(sabConfig(`briefing --all --since ${today()}`, env).stdout)).toContain('gamma change');
  });

  it('appears in the weekly briefing over its rolling window (FR-7)', () => {
    const weekly = sabConfig('briefing --weekly', env).stdout;
    expect(weekly).toContain('Weekly Briefing');
    expect(weekly).toContain('── Landed');
    expect(weekly).toContain('Merge pull request #200');
    expect(weekly).not.toContain('base commit');

    const old = new Date(Date.now() - 120 * DAY);
    const moved = sabConfig(`briefing --weekly --since ${ymd(old)} --until ${ymd(old)}`, env).stdout;
    expect(moved).toContain('base commit');
    expect(moved).toContain('(last 7 days)'); // other sections keep their window
  });

  it('hides worktree branches from Repo State but keeps indexing them (FR-13 … FR-16)', () => {
    const config = JSON.parse(readFileSync(env.configPath, 'utf-8'));
    config.briefing.stale_branch_days = 7;
    // FR-13: with the cap at 1, only the newest task-linked commit is shown.
    config.briefing.repo_state_max_commits = 1;
    writeFileSync(env.configPath, JSON.stringify(config, null, 2));
    const capped = sabConfig('briefing --include-worktrees', env).stdout.split('── Repo State')[1];
    expect(capped.split('── Landed')[0].match(/\[?task_[0-9a-f]{8}\]?/g) ?? []).toHaveLength(1);

    config.briefing.repo_state_max_commits = 5;
    writeFileSync(env.configPath, JSON.stringify(config, null, 2));
    const hidden = sabConfig('briefing', env).stdout;
    expect(hidden).not.toContain('worktree-agent-a2cf0deef802e26a3');
    expect(hidden).not.toContain('agent-only change');

    const shown = sabConfig('briefing --include-worktrees', env).stdout;
    expect(shown).toContain('alpha/worktree-agent-a2cf0deef802e26a3');
    expect(shown).toContain('agent-only change');

    // FR-15: indexed either way. FR-16: a commit on both branches is recorded
    // against the ordinary branch, so hiding the agent branch never hides it.
    expect(sabConfig(`task view ${agentTaskId}`, env).stdout).toContain('agent-only change');
    const db = new Database(env.dbPath, { readonly: true });
    const shared = db
      .prepare('SELECT branch FROM commits WHERE message LIKE ?')
      .get('%trash view%') as { branch: string } | undefined;
    db.close();
    expect(shared?.branch).not.toMatch(/^worktree-agent-/);
  });

  it('lists worktree branches in git list only with the flag (FR-17)', () => {
    const plain = sabConfig('git list', env).stdout;
    expect(plain).not.toContain('worktree-agent-');
    expect(sabConfig('git list --include-worktrees', env).stdout).toContain(
      'worktree-agent-a2cf0deef802e26a3',
    );
  });
});
