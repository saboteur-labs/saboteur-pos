import { execSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultWeekWindow } from '../src/briefing/window.js';
import { createTestEnv, sabConfig, type TestEnv } from './helpers.js';

const GIT_ENV = '-c user.email=test@test -c user.name=Test';
function git(cwd: string, args: string): string {
  return execSync(`git ${GIT_ENV} ${args}`, { cwd, encoding: 'utf-8' });
}
function makeCommit(cwd: string, file: string, content: string, message: string): void {
  writeFileSync(join(cwd, file), content);
  git(cwd, `add ${file}`);
  git(cwd, `commit -q -m "${message.replace(/"/g, '\\"')}"`);
}

function extractId(stdout: string): string {
  const match = stdout.match(/(task_[a-f0-9]+)/);
  if (!match) throw new Error(`No task ID found in: ${stdout}`);
  return match[1];
}

describe('Layer 6 — Daily Briefing', () => {
  let env: TestEnv;

  beforeEach(() => { env = createTestEnv(); });
  afterEach(() => env.cleanup());

  it('briefing shows Section 2 (active context) always', () => {
    const result = sabConfig('briefing', env);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Active Context: inbox');
  });

  it('briefing shows empty state message when nothing active', () => {
    const result = sabConfig('briefing', env);
    // Inbox is empty, no active tasks → empty message
    expect(result.stdout).toContain('Nothing active in inbox');
  });

  it('Section 1 (inbox) omitted when inbox is empty', () => {
    // Use a different context so inbox stays empty
    sabConfig('context new work', env);
    const result = sabConfig('briefing --context work', env);
    expect(result.stdout).not.toContain('── Inbox');
  });

  it('Section 1 (inbox) shows when inbox has tasks', () => {
    sabConfig('task add "Inbox task"', env); // lands in inbox (active_context)
    const result = sabConfig('briefing', env);
    expect(result.stdout).toContain('── Inbox');
    expect(result.stdout).toContain('unsorted task');
  });

  it('Section 3 shows active tasks sorted by priority', () => {
    const lowId = extractId(sabConfig('task add "Low task" --priority low', env).stdout);
    const critId = extractId(sabConfig('task add "Critical task" --priority critical', env).stdout);
    sabConfig(`task move ${lowId} active`, env);
    sabConfig(`task move ${critId} active`, env);

    const result = sabConfig('briefing', env);
    const critPos = result.stdout.indexOf('Critical task');
    const lowPos = result.stdout.indexOf('Low task');
    expect(critPos).toBeGreaterThan(0);
    expect(critPos).toBeLessThan(lowPos);
  });

  it('stale tasks appear in Section 4 and NOT Section 3', () => {
    // We cannot easily backdate updated_at — this test verifies logic with a fresh stale_task_days=0 config
    // Workaround: override the config stale_task_days to 0 so all active tasks are immediately stale
    const config = JSON.parse(readFileSync(env.configPath, 'utf-8'));
    config.briefing.stale_task_days = 0;
    writeFileSync(env.configPath, JSON.stringify(config, null, 2));

    const id = extractId(sabConfig('task add "Stale task"', env).stdout);
    sabConfig(`task move ${id} active`, env);

    const result = sabConfig('briefing', env);
    // Should appear in stale section
    expect(result.stdout).toContain('── Stale Tasks');
    expect(result.stdout).toContain('Stale task');

    // Should NOT appear under Active Tasks section
    const activeSection = result.stdout.split('── Stale')[0];
    const staleSection = result.stdout.split('── Stale')[1] ?? '';
    expect(staleSection).toContain('Stale task');
  });

  it('Section 5 (blocked) shows blocked tasks with blocker IDs', () => {
    const aId = extractId(sabConfig('task add "Blocker"', env).stdout);
    const bId = extractId(sabConfig('task add "Blocked task"', env).stdout);
    sabConfig(`task move ${aId} active`, env);
    sabConfig(`task link ${aId} --blocks ${bId}`, env);
    sabConfig(`task block ${bId}`, env);

    const result = sabConfig('briefing', env);
    expect(result.stdout).toContain('── Blocked Tasks');
    expect(result.stdout).toContain('Blocked task');
  });

  it('Section 5 omitted when no blocked tasks', () => {
    sabConfig('context new work', env);
    const result = sabConfig('briefing --context work', env);
    expect(result.stdout).not.toContain('── Blocked Tasks');
  });

  it('Section 6 (in review) shows and omits correctly', () => {
    sabConfig('context new work', env);
    const noReview = sabConfig('briefing --context work', env);
    expect(noReview.stdout).not.toContain('── In Review');

    const id = extractId(sabConfig('task add "Review me" --context work', env).stdout);
    sabConfig(`task move ${id} active`, env);
    sabConfig(`task move ${id} review`, env);

    const withReview = sabConfig('briefing --context work', env);
    expect(withReview.stdout).toContain('── In Review');
    expect(withReview.stdout).toContain('Review me');
  });

  it('Section 7 (yesterday notes) omitted when empty', () => {
    sabConfig('context new work', env);
    const result = sabConfig('briefing --context work', env);
    expect(result.stdout).not.toContain("── Yesterday's Notes");
  });

  it('Section 7 shows notes updated in last day', () => {
    const noteContent = `---\nid: note_brief001\ntitle: Fresh Note\ntags: []\ncontext: inbox\ncreated_at: 2026-03-26\nupdated_at: ${new Date().toISOString().slice(0, 10)}\n---\n\nBody.\n`;
    writeFileSync(join(env.notesPath, 'fresh-note.md'), noteContent, 'utf-8');
    sabConfig('sync', env);

    const result = sabConfig('briefing', env);
    expect(result.stdout).toContain("── Yesterday's Notes");
    expect(result.stdout).toContain('Fresh Note');
  });

  it('--context flag runs briefing for a different context', () => {
    sabConfig('context new work', env);
    const id = extractId(sabConfig('task add "Work task" --context work', env).stdout);
    sabConfig(`task move ${id} active`, env);

    const result = sabConfig('briefing --context work', env);
    expect(result.stdout).toContain('Active Context: work');
    expect(result.stdout).toContain('Work task');
  });

  it('Section 8 (repo state) shows branch, dirty flag, and linked commits', () => {
    const id = extractId(sabConfig('task add "Login bug"', env).stdout);
    sabConfig(`task move ${id} active`, env);
    const reposRoot = dirname(env.configPath); // createTestEnv sets repos_dir = root
    const repoPath = join(reposRoot, 'demo');
    mkdirSync(repoPath);
    git(repoPath, 'init -q -b main');
    makeCommit(repoPath, 'a.txt', '1', `fix login [${id}]`);
    // Repos are opt-in per context: link it so the active context shows it.
    sabConfig('context repos add inbox demo', env);

    const result = sabConfig('briefing', env);
    expect(result.stdout).toContain('── Repo State');
    expect(result.stdout).toContain('demo');
    expect(result.stdout).toContain('main');
    expect(result.stdout).toContain('clean');
    expect(result.stdout).toContain('fix login');
    expect(result.stdout).toContain('Login bug');
  });

  it('Section 8 surfaces detached HEAD as detached @ <sha>', () => {
    const reposRoot = dirname(env.configPath);
    const repoPath = join(reposRoot, 'demo');
    mkdirSync(repoPath);
    git(repoPath, 'init -q -b main');
    makeCommit(repoPath, 'a.txt', '1', 'first');
    const sha = git(repoPath, 'rev-parse HEAD').trim();
    git(repoPath, `checkout -q ${sha}`);
    sabConfig('context repos add inbox demo', env);

    const result = sabConfig('briefing', env);
    expect(result.stdout).toContain('detached @');
    expect(result.stdout).toContain(sha.slice(0, 7));
  });

  it('Section 8 marks repos with uncommitted changes as dirty', () => {
    const reposRoot = dirname(env.configPath);
    const repoPath = join(reposRoot, 'demo');
    mkdirSync(repoPath);
    git(repoPath, 'init -q -b main');
    makeCommit(repoPath, 'a.txt', '1', 'first');
    writeFileSync(join(repoPath, 'b.txt'), 'untracked');
    sabConfig('context repos add inbox demo', env);

    const result = sabConfig('briefing', env);
    expect(result.stdout).toContain('dirty');
  });

  it('Section 8 is omitted when repos_dir has no working repos', () => {
    const result = sabConfig('briefing', env);
    expect(result.stdout).not.toContain('── Repo State');
  });

  it('empty-scope context shows the link hint, not the repo', () => {
    const reposRoot = dirname(env.configPath);
    const repoPath = join(reposRoot, 'demo');
    mkdirSync(repoPath);
    git(repoPath, 'init -q -b main');
    makeCommit(repoPath, 'a.txt', '1', 'first');
    // inbox has no repos linked.

    const result = sabConfig('briefing', env);
    expect(result.stdout).toContain("(no repos linked to 'inbox')");
    expect(result.stdout).toContain('sab context repos add inbox');
    expect(result.stdout).not.toContain('demo');
  });

  it('--all bypasses repo scoping and shows all working repos without the hint', () => {
    const reposRoot = dirname(env.configPath);
    const repoPath = join(reposRoot, 'demo');
    mkdirSync(repoPath);
    git(repoPath, 'init -q -b main');
    makeCommit(repoPath, 'a.txt', '1', 'first');
    // inbox still has no repos linked — --all must show it anyway.

    const result = sabConfig('briefing --all', env);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('demo');
    expect(result.stdout).toContain('main');
    expect(result.stdout).not.toContain('no repos linked');
  });

  it('discovers working repos across multiple repos_dirs', () => {
    const reposRoot = dirname(env.configPath);
    const a = join(reposRoot, 'roots-a');
    const b = join(reposRoot, 'roots-b');
    for (const [base, name] of [[a, 'alpha'], [b, 'beta']] as const) {
      const p = join(base, name);
      mkdirSync(p, { recursive: true });
      git(p, 'init -q -b main');
      makeCommit(p, 'f.txt', '1', 'first');
    }
    const config = JSON.parse(readFileSync(env.configPath, 'utf-8'));
    config.repos_dirs = [a, b];
    writeFileSync(env.configPath, JSON.stringify(config, null, 2));

    const result = sabConfig('briefing --all', env);
    expect(result.stdout).toContain('alpha');
    expect(result.stdout).toContain('beta');
  });

  it('excludes same-basename repos across roots and warns (collision)', () => {
    const reposRoot = dirname(env.configPath);
    const a = join(reposRoot, 'roots-a');
    const b = join(reposRoot, 'roots-b');
    for (const base of [a, b]) {
      const p = join(base, 'demo');
      mkdirSync(p, { recursive: true });
      git(p, 'init -q -b main');
      makeCommit(p, 'f.txt', '1', 'first');
    }
    const config = JSON.parse(readFileSync(env.configPath, 'utf-8'));
    config.repos_dirs = [a, b];
    writeFileSync(env.configPath, JSON.stringify(config, null, 2));

    const result = sabConfig('briefing --all', env);
    // Not rendered as a working repo header...
    expect(result.stdout).not.toMatch(/demo\s+\(main\)/);
    // ...but surfaced in the skipped footer and warned on stderr.
    expect(result.stdout).toContain('name-collision');
    expect(result.stderr).toContain('demo');
    expect(result.stderr).toMatch(/rename/i);
  });

  it('Stale Branches subsection lists branches older than stale_branch_days', () => {
    // Lower the threshold so we can age branches realistically with --date
    const config = JSON.parse(readFileSync(env.configPath, 'utf-8'));
    config.briefing.stale_branch_days = 14;
    writeFileSync(env.configPath, JSON.stringify(config, null, 2));

    const reposRoot = dirname(env.configPath);
    const repoPath = join(reposRoot, 'demo');
    mkdirSync(repoPath);
    git(repoPath, 'init -q -b main');
    makeCommit(repoPath, 'a.txt', '1', 'fresh on main');
    git(repoPath, 'checkout -q -b old-feature');

    const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(join(repoPath, 'b.txt'), 'stale');
    git(repoPath, 'add b.txt');
    execSync(
      `GIT_AUTHOR_DATE="${oldDate}" GIT_COMMITTER_DATE="${oldDate}" git ${GIT_ENV} commit -q -m "stale branch commit"`,
      { cwd: repoPath },
    );
    git(repoPath, 'checkout -q main');
    sabConfig('context repos add inbox demo', env);

    const result = sabConfig('briefing', env);
    expect(result.stdout).toContain('Stale Branches');
    expect(result.stdout).toContain('demo/old-feature');
    expect(result.stdout).toMatch(/20d|21d/);
  });

  it('Bare and broken repos are surfaced in a skipped footer', () => {
    const reposRoot = dirname(env.configPath);
    const working = join(reposRoot, 'working');
    mkdirSync(working);
    git(working, 'init -q -b main');
    makeCommit(working, 'a.txt', '1', 'first');

    const bare = join(reposRoot, 'bare.git');
    mkdirSync(bare);
    git(bare, 'init -q --bare');

    const broken = join(reposRoot, 'broken');
    mkdirSync(broken);
    writeFileSync(join(broken, '.git'), 'gitdir: /nowhere');
    sabConfig('context repos add inbox working', env);

    const result = sabConfig('briefing', env);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('working');
    expect(result.stdout).toContain('Skipped 2 repos');
    expect(result.stdout).toContain('bare.git (bare)');
    expect(result.stdout).toContain('broken (read-error)');
  });

  it('Stale Branches subsection is omitted when no branches are stale', () => {
    const reposRoot = dirname(env.configPath);
    const repoPath = join(reposRoot, 'demo');
    mkdirSync(repoPath);
    git(repoPath, 'init -q -b main');
    makeCommit(repoPath, 'a.txt', '1', 'fresh');

    const result = sabConfig('briefing', env);
    expect(result.stdout).toContain('── Repo State');
    expect(result.stdout).not.toContain('Stale Branches');
  });

  it('--weekly aggregates shipped, stalled, and repo activity over the last 7 days', async () => {
    const Database = (await import('better-sqlite3')).default;

    const shippedIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const id = extractId(sabConfig(`task add "Shipped ${i}"`, env).stdout);
      sabConfig(`task move ${id} active`, env);
      sabConfig(`task move ${id} review`, env);
      sabConfig(`task move ${id} done`, env);
      shippedIds.push(id);
    }

    const stalledIds: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const id = extractId(sabConfig(`task add "Stalled ${i}"`, env).stdout);
      sabConfig(`task move ${id} active`, env);
      stalledIds.push(id);
    }
    // Backdate the latest state_history entry on stalled tasks beyond the 7-day window
    {
      const db = new Database(env.dbPath);
      const oldIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      for (const id of stalledIds) {
        const row = db.prepare(`SELECT state_history FROM tasks WHERE id = ?`).get(id) as {
          state_history: string;
        };
        const hist = JSON.parse(row.state_history);
        for (const e of hist) e.timestamp = oldIso;
        db.prepare(`UPDATE tasks SET state_history = ?, updated_at = ? WHERE id = ?`).run(
          JSON.stringify(hist),
          oldIso,
          id,
        );
      }
      db.close();
    }

    const reposRoot = dirname(env.configPath);
    const repoSpecs: Array<{ name: string; count: number }> = [
      { name: 'alpha', count: 3 },
      { name: 'beta', count: 1 },
      { name: 'gamma', count: 2 },
      { name: 'delta', count: 0 },
    ];
    for (const spec of repoSpecs) {
      const path = join(reposRoot, spec.name);
      mkdirSync(path);
      git(path, 'init -q -b main');
      // delta repo has no commits → omitted from activity table
      for (let i = 0; i < spec.count; i += 1) {
        makeCommit(path, `f${i}.txt`, String(i), `${spec.name} [${shippedIds[0]}] commit ${i}`);
      }
    }

    const result = sabConfig('briefing --weekly', env);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Weekly Briefing');
    expect(result.stdout).toContain('Shipped');
    for (let i = 0; i < 3; i += 1) {
      expect(result.stdout).toContain(`Shipped ${i}`);
    }
    expect(result.stdout).toContain('Stalled');
    expect(result.stdout).toContain('Stalled 0');
    expect(result.stdout).toContain('Stalled 1');
    expect(result.stdout).toContain('Repo Activity');
    expect(result.stdout).toContain('alpha');
    expect(result.stdout).toContain('beta');
    expect(result.stdout).toContain('gamma');
    expect(result.stdout).not.toContain('delta'); // no commits → omitted from activity
    // alpha (3 commits) must rank before beta (1 commit) in the table
    expect(result.stdout.indexOf('alpha')).toBeLessThan(result.stdout.indexOf('beta'));
  });

  it('--weekly does not render the daily-briefing sections', () => {
    const id = extractId(sabConfig('task add "Some task"', env).stdout);
    sabConfig(`task move ${id} active`, env);
    const result = sabConfig('briefing --weekly', env);
    expect(result.stdout).not.toContain('── Active Tasks');
    expect(result.stdout).not.toContain('── Inbox');
    expect(result.stdout).toContain('Weekly Briefing');
  });

  it('briefing is read-only — does not modify data', () => {
    const id = extractId(sabConfig('task add "Read only test"', env).stdout);
    sabConfig(`task move ${id} active`, env);

    const before = sabConfig(`task view ${id}`, env).stdout;
    sabConfig('briefing', env);
    const after = sabConfig(`task view ${id}`, env).stdout;
    expect(before).toBe(after);
  });

  describe('Landed section (briefing-merged-section)', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const iso = (d: Date) => d.toISOString();
    const ymd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    function datedCommit(cwd: string, file: string, message: string, when: Date): void {
      writeFileSync(join(cwd, file), message);
      git(cwd, `add ${file}`);
      execSync(`git ${GIT_ENV} commit -q -m "${message.replace(/"/g, '\\"')}"`, {
        cwd,
        env: { ...process.env, GIT_AUTHOR_DATE: iso(when), GIT_COMMITTER_DATE: iso(when) },
      });
    }

    function makeRepo(name: string): string {
      const p = join(dirname(env.configPath), name);
      mkdirSync(p);
      git(p, 'init -q -b main');
      return p;
    }

    function setConfig(mutate: (c: Record<string, any>) => void): void {
      const config = JSON.parse(readFileSync(env.configPath, 'utf-8'));
      mutate(config);
      writeFileSync(env.configPath, JSON.stringify(config, null, 2));
    }

    it('lists what landed in the default week for linked repos only (FR-1, FR-6, FR-9)', () => {
      const inWindow = new Date(defaultWeekWindow(new Date(), 'monday').start.getTime() + 60 * 60 * 1000);
      const alpha = makeRepo('alpha');
      datedCommit(alpha, 'a.txt', 'alpha landed change', inWindow);
      const quiet = makeRepo('quiet');
      datedCommit(quiet, 'q.txt', 'ancient history', new Date(Date.now() - 60 * DAY));
      const unlinked = makeRepo('unlinked');
      datedCommit(unlinked, 'u.txt', 'unlinked change', inWindow);
      sabConfig('context repos add inbox alpha quiet', env);

      const out = sabConfig('briefing', env).stdout;
      expect(out).toContain('── Landed');
      const landed = out.split('── Landed')[1];
      expect(landed).toContain('alpha');
      expect(landed).toContain('alpha landed change');
      expect(landed).not.toContain('quiet');
      expect(landed).not.toContain('unlinked');
    });

    it('is omitted when nothing landed in the window (FR-9)', () => {
      const alpha = makeRepo('alpha');
      datedCommit(alpha, 'a.txt', 'old change', new Date(Date.now() - 60 * DAY));
      sabConfig('context repos add inbox alpha', env);
      expect(sabConfig('briefing', env).stdout).not.toContain('── Landed');
    });

    it('shows merge PR numbers and the task titles of merged-in commits (FR-8)', () => {
      const id = extractId(sabConfig('task add "Trash UI"', env).stdout);
      const repo = makeRepo('alpha');
      const now = new Date();
      datedCommit(repo, 'a.txt', 'base', now);
      git(repo, 'checkout -q -b feat/trash');
      datedCommit(repo, 'b.txt', `trash view [${id}]`, now);
      git(repo, 'checkout -q main');
      git(repo, 'merge -q --no-ff feat/trash -m "Merge pull request #200 from org/feat/trash"');
      sabConfig('context repos add inbox alpha', env);

      const out = sabConfig(`briefing --since ${ymd(now)}`, env).stdout;
      const landed = out.split('── Landed')[1];
      expect(landed).toMatch(/#200\s+Merge pull request #200 from org\/feat\/trash/);
      expect(landed).toContain('Trash UI');
    });

    it('--since/--until select any range, including past the 60-day index horizon (FR-2, FR-3)', () => {
      const repo = makeRepo('alpha');
      const old = new Date(Date.now() - 90 * DAY);
      datedCommit(repo, 'a.txt', 'ninety days ago', old);
      datedCommit(repo, 'b.txt', 'today', new Date());
      sabConfig('context repos add inbox alpha', env);

      const out = sabConfig(
        `briefing --since ${ymd(new Date(old.getTime() - DAY))} --until ${ymd(new Date(old.getTime() + DAY))}`,
        env,
      ).stdout;
      const landed = out.split('── Landed')[1];
      expect(landed).toContain('ninety days ago');
      expect(landed).not.toContain('today');
    });

    it('rejects invalid window flags with a non-zero exit (FR-2)', () => {
      const untilOnly = sabConfig('briefing --until 2026-09-10', env);
      expect(untilOnly.code).not.toBe(0);
      expect(untilOnly.stderr).toContain('--until requires --since');
      const reversed = sabConfig('briefing --since 2026-09-10 --until 2026-09-01', env);
      expect(reversed.code).not.toBe(0);
      expect(reversed.stderr).toContain('is after --until');
    });

    it('rejects an unrecognised week_start (FR-1)', () => {
      setConfig((c) => { c.briefing.week_start = 'someday'; });
      const r = sabConfig('briefing', env);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('briefing.week_start');
    });

    it('caps rows per repo and reports the remainder (FR-9)', () => {
      setConfig((c) => { c.briefing.landed_max_rows = 2; });
      const repo = makeRepo('alpha');
      for (let i = 0; i < 4; i += 1) datedCommit(repo, `f${i}.txt`, `change ${i}`, new Date());
      sabConfig('context repos add inbox alpha', env);
      const landed = sabConfig(`briefing --since ${ymd(new Date())}`, env).stdout.split('── Landed')[1];
      expect(landed).toContain('change 3');
      expect(landed).toContain('change 2');
      expect(landed).not.toContain('change 1');
      expect(landed).toContain('+2 more');
    });

    it('uses the configured default branch and warns when it is missing (FR-4)', () => {
      const repo = makeRepo('alpha');
      datedCommit(repo, 'a.txt', 'on main', new Date());
      git(repo, 'checkout -q -b trunk');
      datedCommit(repo, 'b.txt', 'only on trunk', new Date());
      git(repo, 'checkout -q main');
      sabConfig('context repos add inbox alpha', env);

      setConfig((c) => { c.repos = { alpha: { default_branch: 'trunk' } }; });
      const onTrunk = sabConfig(`briefing --since ${ymd(new Date())}`, env);
      expect(onTrunk.stdout.split('── Landed')[1]).toContain('only on trunk');

      setConfig((c) => { c.repos = { alpha: { default_branch: 'nope' } }; });
      const fallback = sabConfig(`briefing --since ${ymd(new Date())}`, env);
      expect(fallback.stderr).toContain('"nope" does not exist locally');
      expect(fallback.stdout.split('── Landed')[1]).not.toContain('only on trunk');
    });

    it('reports a repo with no resolvable default branch as skipped (FR-4)', () => {
      const repo = makeRepo('alpha');
      git(repo, 'checkout -q -b feat/only');
      datedCommit(repo, 'a.txt', 'feature work', new Date());
      sabConfig('context repos add inbox alpha', env);
      const out = sabConfig(`briefing --since ${ymd(new Date())}`, env).stdout;
      expect(out.split('── Landed')[1]).toContain('alpha (no-default-branch)');
    });

    it('--all lists every discovered repo regardless of links (FR-6)', () => {
      const repo = makeRepo('unlinked');
      datedCommit(repo, 'a.txt', 'unlinked change', new Date());
      const out = sabConfig(`briefing --all --since ${ymd(new Date())}`, env).stdout;
      expect(out.split('── Landed')[1]).toContain('unlinked change');
    });

    it('--weekly includes Landed over its rolling window; --since/--until move only Landed (FR-7)', () => {
      const repo = makeRepo('alpha');
      datedCommit(repo, 'a.txt', 'three days ago', new Date(Date.now() - 3 * DAY));
      datedCommit(repo, 'b.txt', 'twenty days ago', new Date(Date.now() - 20 * DAY));
      sabConfig('context repos add inbox alpha', env);

      const weekly = sabConfig('briefing --weekly', env).stdout;
      expect(weekly).toContain('Landed');
      expect(weekly).toContain('three days ago');
      expect(weekly).not.toContain('twenty days ago');

      const d = new Date(Date.now() - 20 * DAY);
      const moved = sabConfig(`briefing --weekly --since ${ymd(d)} --until ${ymd(d)}`, env).stdout;
      expect(moved).toContain('twenty days ago');
      expect(moved).not.toContain('three days ago');
      expect(moved).toContain('(last 7 days)');
    });
  });

  describe('Repo State cap and worktree branches', () => {
    it('reads the commit cap from briefing.repo_state_max_commits (FR-13)', () => {
      const id = extractId(sabConfig('task add "Capped"', env).stdout);
      const repoPath = join(dirname(env.configPath), 'demo');
      mkdirSync(repoPath);
      git(repoPath, 'init -q -b main');
      for (let i = 0; i < 4; i += 1) makeCommit(repoPath, `f${i}.txt`, String(i), `cap commit ${i} [${id}]`);
      sabConfig('context repos add inbox demo', env);

      const config = JSON.parse(readFileSync(env.configPath, 'utf-8'));
      config.briefing.repo_state_max_commits = 2;
      writeFileSync(env.configPath, JSON.stringify(config, null, 2));

      const repoState = sabConfig('briefing', env).stdout.split('── Repo State')[1].split('── Landed')[0];
      expect(repoState.match(/cap commit \d/g)).toHaveLength(2);
    });

    it('hides worktree-agent branches from Repo State unless --include-worktrees (FR-14, FR-15)', () => {
      const id = extractId(sabConfig('task add "Agent work"', env).stdout);
      const repoPath = join(dirname(env.configPath), 'demo');
      mkdirSync(repoPath);
      git(repoPath, 'init -q -b main');
      makeCommit(repoPath, 'a.txt', '1', 'fresh on main');
      git(repoPath, 'checkout -q -b worktree-agent-a2cf0deef802e26a3');
      const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
      writeFileSync(join(repoPath, 'b.txt'), 'agent');
      git(repoPath, 'add b.txt');
      execSync(
        `GIT_AUTHOR_DATE="${oldDate}" GIT_COMMITTER_DATE="${oldDate}" git ${GIT_ENV} commit -q -m "agent-only commit [${id}]"`,
        { cwd: repoPath },
      );
      git(repoPath, 'checkout -q main');
      sabConfig('context repos add inbox demo', env);

      const hidden = sabConfig('briefing', env).stdout;
      expect(hidden).not.toContain('worktree-agent-a2cf0deef802e26a3');
      expect(hidden).not.toContain('agent-only commit');

      const shown = sabConfig('briefing --include-worktrees', env).stdout;
      expect(shown).toContain('demo/worktree-agent-a2cf0deef802e26a3');
      expect(shown).toContain('agent-only commit');

      // FR-15: hidden from display only — still indexed and visible on the task.
      expect(sabConfig(`task view ${id}`, env).stdout).toContain('agent-only commit');
    });
  });
});
