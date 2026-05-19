import { execSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverRepos } from './discover.js';

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
