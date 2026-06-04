import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, sabConfig, type TestEnv } from './helpers.js';

const GIT = '-c user.email=test@test -c user.name=Test';
function git(cwd: string, args: string): string {
  return execSync(`git ${GIT} ${args}`, { cwd, encoding: 'utf-8' });
}
function makeCommit(cwd: string, file: string, content: string, message: string): void {
  writeFileSync(join(cwd, file), content);
  git(cwd, `add ${file}`);
  git(cwd, `commit -q -m "${message}"`);
}

describe('sab git list', () => {
  let env: TestEnv;

  beforeEach(() => { env = createTestEnv(); });
  afterEach(() => env.cleanup());

  it('lists each working repo with its current branch', () => {
    const reposRoot = dirname(env.configPath);
    const alpha = join(reposRoot, 'alpha');
    mkdirSync(alpha);
    git(alpha, 'init -q -b main');
    makeCommit(alpha, 'a.txt', '1', 'initial');

    const beta = join(reposRoot, 'beta');
    mkdirSync(beta);
    git(beta, 'init -q -b main');
    makeCommit(beta, 'b.txt', '1', 'initial');
    git(beta, 'checkout -q -b feat/x');

    const result = sabConfig('git list', env);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('alpha');
    expect(result.stdout).toContain('main');
    expect(result.stdout).toContain('beta');
    expect(result.stdout).toContain('feat/x');
  });

  it('marks repos scoped to the active context with an asterisk', () => {
    const reposRoot = dirname(env.configPath);
    for (const name of ['alpha', 'beta', 'gamma']) {
      const p = join(reposRoot, name);
      mkdirSync(p);
      git(p, 'init -q -b main');
      makeCommit(p, 'f.txt', '1', 'initial');
    }

    // Scope the inbox context to alpha + gamma
    const db = new Database(env.dbPath);
    db.prepare(`UPDATE contexts SET repos = ? WHERE id = 'inbox'`).run(
      JSON.stringify(['alpha', 'gamma']),
    );
    db.close();

    const result = sabConfig('git list', env);
    expect(result.code).toBe(0);
    const lines = result.stdout.split('\n');
    const alphaLine = lines.find((l) => l.includes('alpha'))!;
    const betaLine = lines.find((l) => l.includes('beta'))!;
    const gammaLine = lines.find((l) => l.includes('gamma'))!;
    expect(alphaLine).toMatch(/^\*\s/);
    expect(gammaLine).toMatch(/^\*\s/);
    expect(betaLine).not.toMatch(/^\*\s/);
    expect(result.stdout).toContain('* = in context');
  });

  it('marks repos linked via `sab context repos add` with an asterisk', () => {
    const reposRoot = dirname(env.configPath);
    for (const name of ['alpha', 'beta']) {
      const p = join(reposRoot, name);
      mkdirSync(p);
      git(p, 'init -q -b main');
      makeCommit(p, 'f.txt', '1', 'initial');
    }

    // Link via the real CLI flow, not a raw DB write.
    expect(sabConfig('context repos add inbox alpha', env).code).toBe(0);

    const result = sabConfig('git list', env);
    expect(result.code).toBe(0);
    const lines = result.stdout.split('\n');
    expect(lines.find((l) => l.includes('alpha'))!).toMatch(/^\*\s/);
    expect(lines.find((l) => l.includes('beta'))!).not.toMatch(/^\*\s/);
    expect(result.stdout).toContain('* = in context');
  });

  it('reports an empty state when no repos are found', () => {
    const result = sabConfig('git list', env);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('No repos found');
  });

  it('lists detached HEAD as detached @ <sha>', () => {
    const reposRoot = dirname(env.configPath);
    const repo = join(reposRoot, 'demo');
    mkdirSync(repo);
    git(repo, 'init -q -b main');
    makeCommit(repo, 'a.txt', '1', 'first');
    const sha = git(repo, 'rev-parse HEAD').trim();
    git(repo, `checkout -q ${sha}`);

    const result = sabConfig('git list', env);
    expect(result.stdout).toContain('detached @');
    expect(result.stdout).toContain(sha.slice(0, 7));
  });

  it('lists bare and broken repos in a skipped section', () => {
    const reposRoot = dirname(env.configPath);
    const working = join(reposRoot, 'working');
    mkdirSync(working);
    git(working, 'init -q -b main');
    makeCommit(working, 'a.txt', '1', 'first');

    const bare = join(reposRoot, 'archive.git');
    mkdirSync(bare);
    git(bare, 'init -q --bare');

    const broken = join(reposRoot, 'broken');
    mkdirSync(broken);
    writeFileSync(join(broken, '.git'), 'gitdir: /nowhere');

    const result = sabConfig('git list', env);
    expect(result.stdout).toContain('Skipped');
    expect(result.stdout).toContain('archive.git');
    expect(result.stdout).toContain('bare');
    expect(result.stdout).toContain('broken');
    expect(result.stdout).toContain('read-error');
  });
});
