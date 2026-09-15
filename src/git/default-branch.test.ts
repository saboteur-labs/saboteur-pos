import { describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { resolveDefaultBranch } from './default-branch.js';

function cfg(repos?: Config['repos']): Config {
  return {
    version: '1',
    db_path: '',
    secrets_path: '',
    repos_dir: '',
    active_context: 'inbox',
    briefing: { stale_task_days: 3, stale_branch_days: 14, provider_timeout_ms: 2000 },
    sources: [],
    repos,
  };
}

describe('resolveDefaultBranch (FR-4)', () => {
  it('prefers the configured branch when it exists locally', () => {
    const r = resolveDefaultBranch('app', cfg({ app: { default_branch: 'trunk' } }), {
      originHeadTarget: 'main',
      localBranches: ['main', 'trunk'],
    });
    expect(r).toEqual({ kind: 'resolved', branch: 'trunk', warning: null });
  });

  it('warns and falls through to origin/HEAD when the configured branch is missing', () => {
    const r = resolveDefaultBranch('app', cfg({ app: { default_branch: 'trunk' } }), {
      originHeadTarget: 'development',
      localBranches: ['main', 'development'],
    });
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') {
      expect(r.branch).toBe('development');
      expect(r.warning).toMatch(/app.*trunk.*does not exist/);
    }
  });

  it('uses origin/HEAD before conventional names', () => {
    const r = resolveDefaultBranch('app', cfg(), {
      originHeadTarget: 'development',
      localBranches: ['main', 'development'],
    });
    expect(r).toEqual({ kind: 'resolved', branch: 'development', warning: null });
  });

  it('ignores an origin/HEAD target that has no local branch', () => {
    const r = resolveDefaultBranch('app', cfg(), {
      originHeadTarget: 'release',
      localBranches: ['master'],
    });
    expect(r).toEqual({ kind: 'resolved', branch: 'master', warning: null });
  });

  it('falls back to conventional names in order', () => {
    const r = resolveDefaultBranch('app', cfg(), {
      originHeadTarget: null,
      localBranches: ['develop', 'development', 'feat/x'],
    });
    expect(r).toEqual({ kind: 'resolved', branch: 'development', warning: null });
  });

  it('reports no-default-branch when nothing resolves', () => {
    const r = resolveDefaultBranch('app', cfg(), { originHeadTarget: null, localBranches: ['feat/x'] });
    expect(r).toEqual({ kind: 'unresolved', reason: 'no-default-branch', warning: null });
  });

  it('keeps the missing-config warning even when nothing resolves', () => {
    const r = resolveDefaultBranch('app', cfg({ app: { default_branch: 'trunk' } }), {
      originHeadTarget: null,
      localBranches: [],
    });
    expect(r.kind).toBe('unresolved');
    expect(r.warning).toMatch(/trunk/);
  });
});
