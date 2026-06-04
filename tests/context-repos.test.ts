import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, sabConfig, type TestEnv } from './helpers.js';

// Fabricate the minimal markers discover.ts classifies as a `working` repo:
// a .git/ directory containing HEAD, objects/, and refs/.
function makeRepoIn(base: string, name: string): void {
  const gitDir = join(base, name, '.git');
  mkdirSync(join(gitDir, 'objects'), { recursive: true });
  mkdirSync(join(gitDir, 'refs'), { recursive: true });
  writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
}

function makeRepo(env: TestEnv, name: string): void {
  makeRepoIn(dirname(env.dbPath), name);
}

function setReposDirs(env: TestEnv, dirs: string[]): void {
  const config = JSON.parse(readFileSync(env.configPath, 'utf-8'));
  config.repos_dirs = dirs;
  writeFileSync(env.configPath, JSON.stringify(config, null, 2));
}

describe('sab context repos', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
    sabConfig('context new work', env);
  });
  afterEach(() => env.cleanup());

  it('add links a discovered repo and list shows it', () => {
    makeRepo(env, 'varsentry');
    const add = sabConfig('context repos add work varsentry', env);
    expect(add.code).toBe(0);

    const list = sabConfig('context repos work', env);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain('varsentry');
  });

  it('list shows "(no repos linked)" when empty', () => {
    const list = sabConfig('context repos work', env);
    expect(list.stdout).toContain('(no repos linked)');
  });

  it('explicit `repos list <slug>` matches the default bare form', () => {
    makeRepo(env, 'varsentry');
    sabConfig('context repos add work varsentry', env);
    const explicit = sabConfig('context repos list work', env);
    expect(explicit.code).toBe(0);
    expect(explicit.stdout).toContain('varsentry');
  });

  it('add rejects an unknown repo and writes nothing', () => {
    const add = sabConfig('context repos add work ghostrepo', env);
    expect(add.code).toBe(1);
    expect(add.stderr).toContain(
      "'ghostrepo' not found under repos_dir. Run 'sab git list' to see available repos.",
    );
    // Nothing was written.
    const list = sabConfig('context repos work', env);
    expect(list.stdout).toContain('(no repos linked)');
  });

  it('add matches on basename only — an absolute path is rejected (FR-5)', () => {
    makeRepo(env, 'varsentry');
    const root = dirname(env.dbPath);
    const absPath = join(root, 'varsentry');
    const add = sabConfig(`context repos add work ${absPath}`, env);
    expect(add.code).toBe(1);
    expect(add.stderr).toContain(`'${absPath}' not found under repos_dir`);

    const list = sabConfig('context repos work', env);
    expect(list.stdout).toContain('(no repos linked)');
  });

  it('add de-duplicates against existing and within input', () => {
    makeRepo(env, 'varsentry');
    makeRepo(env, 'landing');
    sabConfig('context repos add work varsentry', env);
    sabConfig('context repos add work varsentry landing', env);

    const list = sabConfig('context repos work', env);
    expect((list.stdout.match(/varsentry/g) ?? []).length).toBe(1);
    expect(list.stdout).toContain('landing');
  });

  it('remove unlinks a repo', () => {
    makeRepo(env, 'varsentry');
    makeRepo(env, 'landing');
    sabConfig('context repos add work varsentry landing', env);
    const rm = sabConfig('context repos remove work landing', env);
    expect(rm.code).toBe(0);

    const list = sabConfig('context repos work', env);
    expect(list.stdout).toContain('varsentry');
    expect(list.stdout).not.toContain('landing');
  });

  it('remove is a no-op for an absent name', () => {
    makeRepo(env, 'varsentry');
    sabConfig('context repos add work varsentry', env);
    const rm = sabConfig('context repos remove work nope', env);
    expect(rm.code).toBe(0);

    const list = sabConfig('context repos work', env);
    expect(list.stdout).toContain('varsentry');
  });

  it('links a repo discovered under a secondary repos_dir', () => {
    const b = join(dirname(env.dbPath), 'roots-b');
    makeRepoIn(b, 'landing');
    setReposDirs(env, [b]);

    const add = sabConfig('context repos add work landing', env);
    expect(add.code).toBe(0);
    expect(sabConfig('context repos work', env).stdout).toContain('landing');
  });

  it('refuses to link a basename that collides across roots', () => {
    const root = dirname(env.dbPath);
    const a = join(root, 'roots-a');
    const b = join(root, 'roots-b');
    makeRepoIn(a, 'demo');
    makeRepoIn(b, 'demo');
    setReposDirs(env, [a, b]);

    const add = sabConfig('context repos add work demo', env);
    expect(add.code).toBe(1);
    expect(add.stderr).toContain("'demo' not found under repos_dir");
    expect(sabConfig('context repos work', env).stdout).toContain('(no repos linked)');
  });

  it('all subcommands error on a nonexistent context', () => {
    const msg = "Context 'ghost' does not exist.";

    const list = sabConfig('context repos ghost', env);
    expect(list.code).toBe(1);
    expect(list.stderr).toContain(msg);

    const add = sabConfig('context repos add ghost varsentry', env);
    expect(add.code).toBe(1);
    expect(add.stderr).toContain(msg);

    const rm = sabConfig('context repos remove ghost varsentry', env);
    expect(rm.code).toBe(1);
    expect(rm.stderr).toContain(msg);
  });
});
