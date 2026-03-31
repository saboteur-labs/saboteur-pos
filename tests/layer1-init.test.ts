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
});
