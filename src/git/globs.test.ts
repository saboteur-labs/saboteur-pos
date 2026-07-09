import { describe, expect, it } from 'vitest';
import { attributeSubContext, pathMatches, type SubContextRule } from './globs.js';

describe('pathMatches', () => {
  it('* stays within a path segment', () => {
    expect(pathMatches('apps/*', 'apps/web')).toBe(true);
    expect(pathMatches('apps/*', 'apps/web/src')).toBe(false);
  });

  it('** spans segments and matches the dir itself', () => {
    expect(pathMatches('apps/web/**', 'apps/web/src/index.ts')).toBe(true);
    expect(pathMatches('apps/web/**', 'apps/web')).toBe(true);
    expect(pathMatches('apps/web/**', 'apps/api')).toBe(false);
  });

  it('**/ matches zero or more leading directories', () => {
    expect(pathMatches('**/node_modules/**', 'node_modules/x')).toBe(true);
    expect(pathMatches('**/node_modules/**', 'a/b/node_modules/x')).toBe(true);
  });

  it('? matches one non-separator char', () => {
    expect(pathMatches('v?', 'v1')).toBe(true);
    expect(pathMatches('v?', 'v1/x')).toBe(false);
  });
});

describe('attributeSubContext', () => {
  const rules: SubContextRule[] = [
    { glob: 'apps/web/**', context: 'platform-web' },
    { glob: 'apps/api/**', context: 'platform-api' },
    { glob: '**', context: 'platform-misc' },
  ];

  it('attributes a single-area commit', () => {
    expect(attributeSubContext(['apps/web/src/table.ts'], rules)).toBe('platform-web');
    expect(attributeSubContext(['apps/api/src/route.ts'], rules)).toBe('platform-api');
  });

  it('most-specific rule wins per file over the catch-all', () => {
    // apps/web/** (prefix len 9) beats ** (prefix len 0) for the same file.
    expect(attributeSubContext(['apps/web/x.ts'], rules)).toBe('platform-web');
  });

  it('dominant area wins for a multi-area commit', () => {
    const files = ['apps/web/a.ts', 'apps/web/b.ts', 'apps/api/c.ts'];
    expect(attributeSubContext(files, rules)).toBe('platform-web');
  });

  it('unmatched files fall to the catch-all when one is declared', () => {
    expect(attributeSubContext(['README.md'], rules)).toBe('platform-misc');
  });

  it('returns null when nothing matches and there is no catch-all', () => {
    const noCatchAll = rules.slice(0, 2);
    expect(attributeSubContext(['README.md'], noCatchAll)).toBeNull();
  });

  it('returns null for an empty file set (e.g. a merge commit)', () => {
    expect(attributeSubContext([], rules)).toBeNull();
  });
});
