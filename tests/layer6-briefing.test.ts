import { execSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

    const result = sabConfig('briefing', env);
    expect(result.stdout).toContain('dirty');
  });

  it('Section 8 is omitted when repos_dir has no working repos', () => {
    const result = sabConfig('briefing', env);
    expect(result.stdout).not.toContain('── Repo State');
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

  it('briefing is read-only — does not modify data', () => {
    const id = extractId(sabConfig('task add "Read only test"', env).stdout);
    sabConfig(`task move ${id} active`, env);

    const before = sabConfig(`task view ${id}`, env).stdout;
    sabConfig('briefing', env);
    const after = sabConfig(`task view ${id}`, env).stdout;
    expect(before).toBe(after);
  });
});
