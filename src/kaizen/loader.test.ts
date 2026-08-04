import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KaizenTemplateError, loadKaizenTemplate, SUPPORTED_SCHEMA } from './loader.js';
import { findShippedTemplate } from './paths.js';

const SHIPPED = readFileSync(findShippedTemplate(), 'utf-8');

describe('loadKaizenTemplate', () => {
  let root: string;
  let configPath: string;
  let templatePath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sab-kaizen-'));
    configPath = join(root, 'saboteur.config.json');
    templatePath = join(root, 'templates', 'kaizen.md');
    mkdirSync(join(root, 'templates'), { recursive: true });
    writeFileSync(templatePath, SHIPPED, 'utf-8');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const write = (contents: string) => writeFileSync(templatePath, contents, 'utf-8');
  const load = () => loadKaizenTemplate({ configPath });

  describe('resolution', () => {
    it('resolves the template alongside the config file', () => {
      expect(load().path).toBe(templatePath);
    });

    it('an explicit templatePath takes precedence over the workspace default', () => {
      const alt = join(root, 'alternate.md');
      writeFileSync(alt, SHIPPED, 'utf-8');
      expect(loadKaizenTemplate({ configPath, templatePath: alt }).path).toBe(alt);
    });

    it('points the user at sab init when no template exists', () => {
      rmSync(templatePath);
      expect(() => load()).toThrow(KaizenTemplateError);
      expect(() => load()).toThrow(/sab init/);
    });
  });

  describe('content', () => {
    it('returns the file verbatim as raw', () => {
      expect(load().raw).toBe(SHIPPED);
    });

    it('body is an exact slice of raw, starting after the frontmatter', () => {
      const t = load();
      expect(t.raw.slice(t.bodyOffset)).toBe(t.body);
      expect(t.body.startsWith('\n# Kaizen Weekly Review')).toBe(true);
      expect(t.body).not.toContain('template: kaizen');
    });

    it('preserves a body whose leading blank lines gray-matter would strip', () => {
      write('---\ntemplate: kaizen\ntemplate_version: 1\nschema: 1\n---\n\n\n# Heading\n');
      expect(load().body).toBe('\n\n# Heading\n');
    });

    it('handles CRLF frontmatter delimiters', () => {
      write('---\r\ntemplate: kaizen\r\ntemplate_version: 1\r\nschema: 1\r\n---\r\n# H\r\n');
      expect(load().body).toBe('# H\r\n');
    });
  });

  describe('hash', () => {
    it('is stable across reads of identical content', () => {
      expect(load().hash).toBe(load().hash);
    });

    it('changes when the template changes', () => {
      const before = load().hash;
      write(SHIPPED.replace('Three maximum.', 'Two maximum.'));
      expect(load().hash).not.toBe(before);
    });
  });

  describe('frontmatter validation', () => {
    it('accepts the shipped template', () => {
      const { frontmatter } = load();
      expect(frontmatter.template).toBe('kaizen');
      expect(frontmatter.schema).toBe(SUPPORTED_SCHEMA);
      expect(frontmatter.template_version).toBe(1);
    });

    it('rejects a file with no frontmatter block', () => {
      write('# Kaizen Weekly Review\n');
      expect(() => load()).toThrow(/no frontmatter block/);
    });

    it('rejects an unterminated frontmatter block', () => {
      write('---\ntemplate: kaizen\nschema: 1\n');
      expect(() => load()).toThrow(/unterminated frontmatter/);
    });

    it('rejects a template that is not a kaizen template', () => {
      write('---\ntemplate: standup\ntemplate_version: 1\nschema: 1\n---\n# H\n');
      expect(() => load()).toThrow(/not a Kaizen template/);
    });

    it('names the supported schema when the declared one is unsupported', () => {
      write('---\ntemplate: kaizen\ntemplate_version: 1\nschema: 99\n---\n# H\n');
      expect(() => load()).toThrow(new RegExp(`supports schema ${SUPPORTED_SCHEMA}`));
      expect(() => load()).toThrow(/Upgrade sab/);
    });

    it('tells the user to update the template when its schema is behind', () => {
      write('---\ntemplate: kaizen\ntemplate_version: 1\nschema: 0\n---\n# H\n');
      expect(() => load()).toThrow(/Update the template/);
    });

    it('rejects a missing or non-integer schema', () => {
      write('---\ntemplate: kaizen\ntemplate_version: 1\n---\n# H\n');
      expect(() => load()).toThrow(/integer 'schema' field/);
    });

    it('rejects a missing template_version', () => {
      write('---\ntemplate: kaizen\nschema: 1\n---\n# H\n');
      expect(() => load()).toThrow(/integer 'template_version' field/);
    });
  });
});
