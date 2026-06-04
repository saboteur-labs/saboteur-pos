import { execSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collisionWarning, discoverAllRepos, discoverRepos } from './discover.js';

function git(cwd: string, args: string): void {
  execSync(`git ${args}`, { cwd, stdio: 'ignore' });
}

describe('discoverRepos', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sab-discover-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns working/bare/broken classifications and skips non-repos', () => {
    const working = join(root, 'working-repo');
    mkdirSync(working);
    git(working, 'init -q');

    const bare = join(root, 'bare-repo.git');
    mkdirSync(bare);
    git(bare, 'init -q --bare');

    const broken = join(root, 'broken-repo');
    mkdirSync(broken);
    writeFileSync(join(broken, '.git'), 'gitdir: /nowhere'); // .git as file, no real repo

    const notARepo = join(root, 'not-a-repo');
    mkdirSync(notARepo);
    writeFileSync(join(notARepo, 'README.md'), '');

    const repos = discoverRepos(root);
    const byName = Object.fromEntries(repos.map((r) => [r.name, r.kind]));
    expect(repos).toHaveLength(3);
    expect(byName['working-repo']).toBe('working');
    expect(byName['bare-repo.git']).toBe('bare');
    expect(byName['broken-repo']).toBe('broken');
    expect(byName['not-a-repo']).toBeUndefined();
  });

  it('returns empty list when repos_dir does not exist', () => {
    expect(discoverRepos(join(root, 'missing'))).toEqual([]);
  });

  it('returns empty list when repos_dir is empty', () => {
    expect(discoverRepos(root)).toEqual([]);
  });
});

describe('discoverAllRepos', () => {
  let root: string;
  const mkWorking = (dir: string) => {
    mkdirSync(dir, { recursive: true });
    git(dir, 'init -q');
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sab-discover-all-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('unions immediate-child discovery across roots (FR-2)', () => {
    mkWorking(join(root, 'A', 'alpha'));
    mkWorking(join(root, 'B', 'beta'));

    const { repos, collisions } = discoverAllRepos([join(root, 'A'), join(root, 'B')]);
    expect(repos.map((r) => r.name).sort()).toEqual(['alpha', 'beta']);
    expect(collisions).toEqual([]);
  });

  it('skips a missing root without throwing (FR-5)', () => {
    mkWorking(join(root, 'A', 'alpha'));
    const { repos } = discoverAllRepos([join(root, 'A'), join(root, 'does-not-exist')]);
    expect(repos.map((r) => r.name)).toEqual(['alpha']);
  });

  it('excludes same-basename working repos across roots and reports the collision (FR-9)', () => {
    const aFoo = join(root, 'A', 'foo');
    const bFoo = join(root, 'B', 'foo');
    mkWorking(aFoo);
    mkWorking(bFoo);
    mkWorking(join(root, 'A', 'solo'));

    const { repos, collisions } = discoverAllRepos([join(root, 'A'), join(root, 'B')]);

    // Neither 'foo' is a working repo any more.
    expect(repos.filter((r) => r.kind === 'working').map((r) => r.name)).toEqual(['solo']);
    // Both 'foo' entries are surfaced as collisions.
    expect(repos.filter((r) => r.kind === 'collision').map((r) => r.name)).toEqual(['foo', 'foo']);
    // Reported once, naming both directories.
    expect(collisions).toHaveLength(1);
    expect(collisions[0].name).toBe('foo');
    expect(collisions[0].dirs.sort()).toEqual([join(root, 'A'), join(root, 'B')]);
  });

  it('matches single-root discoverRepos for one root (regression)', () => {
    mkWorking(join(root, 'A', 'alpha'));
    const single = discoverRepos(join(root, 'A'));
    const { repos } = discoverAllRepos([join(root, 'A')]);
    expect(repos).toEqual(single);
  });

  it('collisionWarning names the basename and its directories', () => {
    const msg = collisionWarning([{ name: 'foo', dirs: ['/a', '/b'] }]);
    expect(msg).toContain('foo');
    expect(msg).toContain('/a');
    expect(msg).toContain('/b');
  });
});
