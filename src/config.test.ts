import { homedir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { getReposDirs, type Config } from './config.js';

function cfg(over: Partial<Config>): Config {
  return {
    version: '1',
    db_path: '',
    secrets_path: '',
    repos_dir: '',
    active_context: 'inbox',
    briefing: { stale_task_days: 3, stale_branch_days: 14, provider_timeout_ms: 2000 },
    sources: [],
    ...over,
  };
}

describe('getReposDirs', () => {
  it('returns the single repos_dir when only it is set (FR-3)', () => {
    expect(getReposDirs(cfg({ repos_dir: '/code' }))).toEqual(['/code']);
  });

  it('returns repos_dirs when only it is set (FR-2)', () => {
    expect(getReposDirs(cfg({ repos_dir: '', repos_dirs: ['/a', '/b'] }))).toEqual(['/a', '/b']);
  });

  it('unions repos_dir with repos_dirs, repos_dir first (FR-4)', () => {
    expect(getReposDirs(cfg({ repos_dir: '/a', repos_dirs: ['/b', '/c'] }))).toEqual([
      '/a',
      '/b',
      '/c',
    ]);
  });

  it('de-duplicates identical entries after resolution (FR-6)', () => {
    expect(getReposDirs(cfg({ repos_dir: '/a', repos_dirs: ['/a', '/b'] }))).toEqual(['/a', '/b']);
  });

  it('expands ~/ to the home directory (FR-1)', () => {
    expect(getReposDirs(cfg({ repos_dir: '~/code' }))).toEqual([join(homedir(), 'code')]);
  });

  it('de-duplicates entries that resolve to the same absolute path', () => {
    expect(getReposDirs(cfg({ repos_dirs: ['~/x', '~/x'] }))).toEqual([join(homedir(), 'x')]);
  });

  it('returns an empty list when neither is set', () => {
    expect(getReposDirs(cfg({}))).toEqual([]);
  });
});
