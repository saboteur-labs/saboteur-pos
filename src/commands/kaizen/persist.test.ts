import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import matter from 'gray-matter';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../../config.js';
import { CREATE_TABLES } from '../../db/schema.js';
import type { KaizenTemplate } from '../../kaizen/loader.js';
import { previousIntentions } from './intentions.js';
import { persistKaizen } from './persist.js';

const template = {
  path: '/home/j/saboteur/templates/kaizen.md',
  raw: '',
  body: '',
  bodyOffset: 0,
  frontmatter: { template: 'kaizen', template_version: 3, schema: 1 },
  hash: 'a'.repeat(64),
} as KaizenTemplate;

describe('persistKaizen', () => {
  let db: Database.Database;
  let notesDir: string;
  let config: Config;

  beforeEach(() => {
    notesDir = mkdtempSync(join(tmpdir(), 'sab-kaizen-notes-'));
    db = new Database(':memory:');
    db.exec(CREATE_TABLES);
    db.prepare(
      `INSERT INTO sources (id, type, path, owner, enabled)
       VALUES ('personal-notes', 'note', ?, 'core', 1)`,
    ).run(notesDir);
    config = { sources: [{ id: 'personal-notes', path: notesDir }] } as unknown as Config;
  });

  afterEach(() => {
    db.close();
    rmSync(notesDir, { recursive: true, force: true });
  });

  const persist = (overrides: Partial<Parameters<typeof persistKaizen>[2]> = {}) =>
    persistKaizen(db, config, {
      contextId: 'saboteur-pos',
      weekOf: '2026-08-03',
      template,
      intentions: ['Ship kaizen', 'Rest properly'],
      body: '# Kaizen Weekly Review\n\nfilled in\n',
      ...overrides,
    });

  it('writes a note file and returns its id and path', () => {
    const result = persist();
    expect(result.id).toBeTruthy();
    expect(readFileSync(result.path, 'utf-8')).toContain('filled in');
  });

  it('records the kaizen frontmatter a later run depends on', () => {
    const { path } = persist();
    const fm = matter(readFileSync(path, 'utf-8')).data;

    expect(fm.tags).toEqual(['kaizen']);
    expect(fm.week_of).toBe('2026-08-03');
    expect(fm.template_path).toBe(template.path);
    expect(fm.template_hash).toBe(template.hash);
    expect(fm.template_version).toBe(3);
    expect(fm.intentions).toEqual(['Ship kaizen', 'Rest properly']);
  });

  it('preserves the rendered body verbatim', () => {
    const body = '# Kaizen Weekly Review\n\n- **Energy level this week (1–5):** 4\n';
    const { path } = persist({ body });
    expect(matter(readFileSync(path, 'utf-8')).content.trim()).toBe(body.trim());
  });

  it('indexes the note as an ordinary note, reachable by tag', () => {
    const { id } = persist();
    const row = db
      .prepare(`SELECT type, tags, context_id FROM knowledge_index WHERE id = ?`)
      .get(id) as { type: string; tags: string; context_id: string };

    // type = 'note' matters: listKnowledgeEntries hardcodes it, so any other
    // value would make `sab note find --tag kaizen` unable to see this.
    expect(row.type).toBe('note');
    expect(JSON.parse(row.tags)).toEqual(['kaizen']);
    expect(row.context_id).toBe('saboteur-pos');
  });

  it('names the file after the week under review, not the day it was written', () => {
    persist({ weekOf: '2026-07-20' });
    expect(readdirSync(notesDir)[0]).toMatch(/^2026-07-20-kaizen-[0-9a-f]{8}\.md$/);
  });

  it('writes two distinct files for two reviews of the same week', () => {
    const first = persist();
    const second = persist();
    expect(second.path).not.toBe(first.path);
    expect(readdirSync(notesDir)).toHaveLength(2);
    expect(readFileSync(first.path, 'utf-8')).toContain('filled in');
  });

  it('orders same-week reviews so the newest intentions carry forward', () => {
    // Reviews may be repeated in a week; created_at must be finer than day
    // granularity or the two tie and the wrong one wins.
    persist({ intentions: ['Older intention'] });
    persist({ intentions: ['Newer intention'] });
    expect(previousIntentions(db, 'saboteur-pos')).toEqual(['Newer intention']);
  });

  it('records created_at at full timestamp precision', () => {
    const { path } = persist();
    const fm = matter(readFileSync(path, 'utf-8')).data;
    expect(String(fm.created_at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('leaves no note behind when the index write fails', () => {
    db.exec('DROP TABLE knowledge_index');

    expect(() => persist()).toThrow();
    // The file must be written before indexing, since the row records its path.
    // A failed index therefore has to clean the file up, or the pair is no
    // longer all-or-nothing.
    expect(readdirSync(notesDir)).toEqual([]);
  });

  it('does not touch task state', () => {
    persist();
    expect(db.prepare(`SELECT count(*) AS n FROM tasks`).get()).toEqual({ n: 0 });
  });
});
