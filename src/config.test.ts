import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { getReposDirs, loadConfig, resolveSlotFromTime, type Config } from './config.js';

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

const DEFAULT_SLOT_WINDOWS = {
  'pre-work': '00:00-09:00',
  'wd-1': '09:00-12:00',
  'wd-2': '12:00-15:00',
  'wd-3': '15:00-18:00',
  'post-work': '18:00-24:00',
};

describe('loadConfig standup/retro backfill', () => {
  it('backfills default standup and retro config when both are omitted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sab-config-test-'));
    const path = join(dir, 'saboteur.config.json');
    const raw = cfg({});
    // Ensure the omitted keys are truly absent from the JSON, not just undefined.
    delete (raw as Partial<Config>).standup;
    delete (raw as Partial<Config>).retro;
    writeFileSync(path, JSON.stringify(raw), 'utf-8');

    try {
      const loaded = loadConfig(path);
      expect(loaded.standup).toEqual({ slot_windows: DEFAULT_SLOT_WINDOWS });
      expect(loaded.retro).toEqual({ project_window_days: 14 });
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('backfills slot_windows when standup exists but is missing it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sab-config-test-'));
    const path = join(dir, 'saboteur.config.json');
    const raw = cfg({}) as unknown as Record<string, unknown>;
    raw.standup = {};
    delete raw.retro;
    writeFileSync(path, JSON.stringify(raw), 'utf-8');

    try {
      const loaded = loadConfig(path);
      expect(loaded.standup).toEqual({ slot_windows: DEFAULT_SLOT_WINDOWS });
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveSlotFromTime', () => {
  const time = (h: number, m: number) => new Date(2026, 0, 1, h, m, 0, 0);

  it('maps representative times to each default slot', () => {
    expect(resolveSlotFromTime(DEFAULT_SLOT_WINDOWS, time(3, 0))).toBe('pre-work');
    expect(resolveSlotFromTime(DEFAULT_SLOT_WINDOWS, time(10, 30))).toBe('wd-1');
    expect(resolveSlotFromTime(DEFAULT_SLOT_WINDOWS, time(13, 0))).toBe('wd-2');
    expect(resolveSlotFromTime(DEFAULT_SLOT_WINDOWS, time(16, 0))).toBe('wd-3');
    expect(resolveSlotFromTime(DEFAULT_SLOT_WINDOWS, time(20, 0))).toBe('post-work');
  });

  it('handles boundary times as start-inclusive', () => {
    expect(resolveSlotFromTime(DEFAULT_SLOT_WINDOWS, time(9, 0))).toBe('wd-1');
    expect(resolveSlotFromTime(DEFAULT_SLOT_WINDOWS, time(12, 0))).toBe('wd-2');
    expect(resolveSlotFromTime(DEFAULT_SLOT_WINDOWS, time(18, 0))).toBe('post-work');
    expect(resolveSlotFromTime(DEFAULT_SLOT_WINDOWS, time(0, 0))).toBe('pre-work');
  });

  it('treats the 24:00 upper bound as inclusive of end-of-day (23:59)', () => {
    expect(resolveSlotFromTime(DEFAULT_SLOT_WINDOWS, time(23, 59))).toBe('post-work');
  });

  it('throws a clear error when no window matches', () => {
    expect(() => resolveSlotFromTime({ 'wd-1': '09:00-12:00' }, time(13, 0))).toThrow(
      /No configured standup.slot_windows window contains the current time \(13:00\)/,
    );
  });
});
