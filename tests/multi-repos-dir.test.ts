import { execSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, sabConfig, type TestEnv } from './helpers.js';

const GIT = '-c user.email=test@test -c user.name=Test';
function git(cwd: string, args: string): string {
  return execSync(`git ${GIT} ${args}`, { cwd, encoding: 'utf-8' });
}

function makeRepo(base: string, name: string, message = 'first'): string {
  const p = join(base, name);
  mkdirSync(p, { recursive: true });
  git(p, 'init -q -b main');
  commit(p, 'f.txt', message);
  return p;
}

function commit(repo: string, file: string, message: string): void {
  writeFileSync(join(repo, file), message);
  git(repo, `add ${file}`);
  git(repo, `commit -q -m "${message.replace(/"/g, '\\"')}"`);
}

function setReposDirs(env: TestEnv, dirs: string[]): void {
  const config = JSON.parse(readFileSync(env.configPath, 'utf-8'));
  config.repos_dirs = dirs;
  writeFileSync(env.configPath, JSON.stringify(config, null, 2));
}

describe('multi-directory repo support', () => {
  let env: TestEnv;
  let root: string;

  beforeEach(() => {
    env = createTestEnv();
    root = dirname(env.configPath);
  });
  afterEach(() => env.cleanup());

  it('shows repos from multiple roots in git list and briefing (FR-2)', () => {
    makeRepo(join(root, 'A'), 'alpha');
    makeRepo(join(root, 'B'), 'beta');
    setReposDirs(env, [join(root, 'A'), join(root, 'B')]);

    const list = sabConfig('git list', env);
    expect(list.stdout).toContain('alpha');
    expect(list.stdout).toContain('beta');

    const brief = sabConfig('briefing --all', env);
    expect(brief.stdout).toContain('alpha');
    expect(brief.stdout).toContain('beta');
  });

  it('with only the legacy repos_dir, behaves as before (FR-3)', () => {
    makeRepo(root, 'solo'); // directly under repos_dir; no repos_dirs set

    const list = sabConfig('git list', env);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain('solo');
    expect(sabConfig('briefing --all', env).stdout).toContain('solo');
  });

  it('a cross-root collision removes a previously-visible repo and reports it (FR-9)', () => {
    makeRepo(join(root, 'A'), 'demo');
    setReposDirs(env, [join(root, 'A'), join(root, 'B')]);

    // Initially visible.
    const before = sabConfig('briefing --all', env);
    expect(before.stdout).toMatch(/demo\s+\(main\)/);
    expect(before.stdout).not.toContain('name-collision');

    // Introduce a colliding basename under the second root.
    makeRepo(join(root, 'B'), 'demo');
    const after = sabConfig('briefing --all', env);
    expect(after.stdout).not.toMatch(/demo\s+\(main\)/); // no longer a working header
    expect(after.stdout).toContain('name-collision');
    expect(after.stderr).toMatch(/rename/i);
  });

  it('skips a nonexistent repos_dirs entry and still renders the rest (FR-5)', () => {
    makeRepo(join(root, 'A'), 'alpha');
    setReposDirs(env, [join(root, 'A'), join(root, 'does-not-exist')]);

    const list = sabConfig('git list', env);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain('alpha');
  });

  it('links a commit in a repo under a second root to its task (FR-2, indexing)', () => {
    const id = sabConfig('task add "Beta work"', env).stdout.match(/(task_[a-f0-9]+)/)![1];
    const repo = makeRepo(join(root, 'B'), 'beta');
    commit(repo, 'g.txt', `wire it [${id}]`);
    setReposDirs(env, [join(root, 'B')]);

    // Briefing triggers commit indexing across all roots.
    sabConfig('briefing', env);

    const view = sabConfig(`task view ${id}`, env);
    expect(view.stdout).toContain('wire it');
  });
});
