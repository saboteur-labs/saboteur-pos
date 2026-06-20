import { existsSync, readFileSync } from 'fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, sabConfig, type TestEnv } from './helpers.js';

describe('Layer 1 — Init + Status', () => {
  let env: TestEnv;

  beforeEach(() => { env = createTestEnv(); });
  afterEach(() => env.cleanup());

  it('sab init creates db, notes dir, config, and secrets', () => {
    expect(existsSync(env.dbPath)).toBe(true);
    expect(existsSync(env.notesPath)).toBe(true);
    expect(existsSync(env.configPath)).toBe(true);
    expect(existsSync(env.configPath.replace('saboteur.config.json', 'saboteur.secrets.json'))).toBe(true);
  });

  it('sab init is idempotent — running twice does not error', () => {
    const result = sabConfig('init', env);
    expect(result.code).toBe(0);
  });

  it('sab status prints config path, db path, context, and task counts', () => {
    const result = sabConfig('status', env);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Config:');
    expect(result.stdout).toContain('DB:');
    expect(result.stdout).toContain('inbox');
    expect(result.stdout).toContain('Tasks (0 total)');
    expect(result.stdout).toContain('Knowledge index: 0 entries');
    expect(result.stdout).toContain('Sources:         1 registered');
  });

  it('config has correct default structure', () => {
    const config = JSON.parse(readFileSync(env.configPath, 'utf-8'));
    expect(config.version).toBe('1');
    expect(config.active_context).toBe('inbox');
    expect(config.briefing.stale_task_days).toBe(3);
    expect(config.briefing.provider_timeout_ms).toBe(2000); // Phase 2c stub present
    expect(config.repos_dir).toBeDefined(); // Phase 2a stub present
  });

  it('commits table exists with expected columns and indexes', async () => {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(env.dbPath, { readonly: true });
    const cols = db
      .prepare(`PRAGMA table_info(commits)`)
      .all() as Array<{ name: string; type: string; notnull: number }>;
    const colNames = cols.map((c) => c.name).sort();
    expect(colNames).toEqual(
      ['author_ts', 'branch', 'message', 'repo', 'sha', 'sub_context', 'task_id'].sort(),
    );
    const shaCol = cols.find((c) => c.name === 'sha')!;
    expect(shaCol.type.toUpperCase()).toBe('TEXT');
    const idx = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='commits'`)
      .all() as Array<{ name: string }>;
    const idxNames = idx.map((i) => i.name);
    expect(idxNames).toContain('idx_commits_task');
    expect(idxNames).toContain('idx_commits_repo');
    expect(idxNames).toContain('idx_commits_author_ts');
    db.close();
  });
});

describe('Config — stale_branch_days', () => {
  it('makeDefaultConfig writes stale_branch_days: 14', async () => {
    const { makeDefaultConfig } = await import('../src/config.js');
    const config = makeDefaultConfig('/tmp/notes', '/tmp/db', '/tmp/secrets');
    expect(config.briefing.stale_branch_days).toBe(14);
  });

  it('loadConfig backfills missing stale_branch_days to 14', async () => {
    const { loadConfig } = await import('../src/config.js');
    const { writeFileSync, mkdtempSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const dir = mkdtempSync(join(tmpdir(), 'sab-cfg-'));
    const configPath = join(dir, 'saboteur.config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        version: '1',
        db_path: '/tmp/db',
        secrets_path: '/tmp/secrets',
        repos_dir: '/tmp/repos',
        active_context: 'inbox',
        briefing: { stale_task_days: 3, provider_timeout_ms: 2000 }, // no stale_branch_days
        sources: [],
      }),
    );
    const loaded = loadConfig(configPath);
    expect(loaded.briefing.stale_branch_days).toBe(14);
  });
});
