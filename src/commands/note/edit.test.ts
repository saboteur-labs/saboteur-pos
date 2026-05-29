import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveBodyContent } from './edit.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sab-edit-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('resolveBodyContent', () => {
  describe('inline text', () => {
    it('returns the text unchanged', () => {
      const result = resolveBodyContent('hello world');
      expect(result).toEqual({ ok: true, content: 'hello world' });
    });

    it('preserves internal whitespace and newlines', () => {
      const text = 'line one\n\nline two\n';
      const result = resolveBodyContent(text);
      expect(result).toEqual({ ok: true, content: text });
    });

    it('returns an error for whitespace-only text', () => {
      const result = resolveBodyContent('   ');
      expect(result).toEqual({
        ok: false,
        error: "Body text is required for --body. Use 'sab note edit <id>' to open the editor.",
      });
    });

    it('returns an error for an empty string', () => {
      const result = resolveBodyContent('');
      expect(result).toEqual({
        ok: false,
        error: "Body text is required for --body. Use 'sab note edit <id>' to open the editor.",
      });
    });
  });

  describe('@<path> file input', () => {
    it('reads and returns the file contents', () => {
      const file = join(dir, 'body.txt');
      writeFileSync(file, 'content from file');
      const result = resolveBodyContent(`@${file}`);
      expect(result).toEqual({ ok: true, content: 'content from file' });
    });

    it('preserves newlines and formatting from the file', () => {
      const file = join(dir, 'body.md');
      const body = '# Title\n\nSome paragraph.\n';
      writeFileSync(file, body);
      const result = resolveBodyContent(`@${file}`);
      expect(result).toEqual({ ok: true, content: body });
    });

    it('returns an error for a nonexistent file', () => {
      const path = join(dir, 'nonexistent.txt');
      const result = resolveBodyContent(`@${path}`);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/^Cannot read file '.*nonexistent\.txt': /);
      }
    });

    it('returns an error for an empty file', () => {
      const file = join(dir, 'empty.txt');
      writeFileSync(file, '');
      const result = resolveBodyContent(`@${file}`);
      expect(result).toEqual({
        ok: false,
        error: "Body text is required for --body. Use 'sab note edit <id>' to open the editor.",
      });
    });

    it('returns an error for a whitespace-only file', () => {
      const file = join(dir, 'spaces.txt');
      writeFileSync(file, '   \n   ');
      const result = resolveBodyContent(`@${file}`);
      expect(result).toEqual({
        ok: false,
        error: "Body text is required for --body. Use 'sab note edit <id>' to open the editor.",
      });
    });
  });
});
