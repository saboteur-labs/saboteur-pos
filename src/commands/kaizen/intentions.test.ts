import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CREATE_TABLES } from '../../db/schema.js';
import { mostRecentKaizen, previousIntentions, readIntentions } from './intentions.js';

describe('kaizen intentions carry-forward', () => {
  let db: Database.Database;
  let dir: string;
  let seq = 0;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sab-kaizen-int-'));
    db = new Database(':memory:');
    db.exec(CREATE_TABLES);
    db.prepare(
      `INSERT INTO sources (id, type, path, owner, enabled) VALUES ('notes', 'note', ?, 'core', 1)`,
    ).run(dir);
    seq = 0;
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Write a note file and index it, returning its path. */
  function addNote(opts: {
    tags: string[];
    context: string;
    createdAt: string;
    frontmatter?: string;
    raw?: string;
  }): string {
    const id = `note-${seq++}`;
    const path = join(dir, `${id}.md`);
    writeFileSync(
      path,
      opts.raw ??
        `---\nid: ${id}\ntitle: Kaizen\ncontext: ${opts.context}\n${opts.frontmatter ?? ''}---\n\nbody\n`,
      'utf-8',
    );
    db.prepare(
      `INSERT INTO knowledge_index (id, source_id, type, title, tags, context_id, path, created_at, updated_at)
       VALUES (?, 'notes', 'note', 'Kaizen', ?, ?, ?, ?, ?)`,
    ).run(id, JSON.stringify(opts.tags), opts.context, path, opts.createdAt, opts.createdAt);
    return path;
  }

  it('returns the intentions of the newest kaizen note in scope', () => {
    addNote({
      tags: ['kaizen'],
      context: 'saboteur-pos',
      createdAt: '2026-07-20T10:00:00.000Z',
      frontmatter: 'intentions:\n  - Old one\n',
    });
    addNote({
      tags: ['kaizen'],
      context: 'saboteur-pos',
      createdAt: '2026-07-27T10:00:00.000Z',
      frontmatter: 'intentions:\n  - Ship kaizen\n  - Rest properly\n',
    });

    expect(previousIntentions(db, 'saboteur-pos')).toEqual(['Ship kaizen', 'Rest properly']);
  });

  it('is scoped to its context', () => {
    addNote({
      tags: ['kaizen'],
      context: 'offbeat-fm',
      createdAt: '2026-07-27T10:00:00.000Z',
      frontmatter: 'intentions:\n  - Not yours\n',
    });
    expect(previousIntentions(db, 'saboteur-pos')).toEqual([]);
  });

  it('keys off tags, not note type — standup notes are not mistaken for kaizen', () => {
    addNote({
      tags: ['standup'],
      context: 'saboteur-pos',
      createdAt: '2026-07-27T10:00:00.000Z',
      frontmatter: 'intentions:\n  - From a standup\n',
    });
    expect(mostRecentKaizen(db, 'saboteur-pos')).toBeNull();
  });

  it('returns empty when no prior kaizen exists', () => {
    expect(previousIntentions(db, 'saboteur-pos')).toEqual([]);
    expect(mostRecentKaizen(db, 'saboteur-pos')).toBeNull();
  });

  describe('bad data costs the prefill, not the review', () => {
    it('tolerates a note whose file has been deleted', () => {
      const path = addNote({
        tags: ['kaizen'],
        context: 'saboteur-pos',
        createdAt: '2026-07-27T10:00:00.000Z',
        frontmatter: 'intentions:\n  - Gone\n',
      });
      rmSync(path);
      expect(previousIntentions(db, 'saboteur-pos')).toEqual([]);
    });

    it('tolerates malformed frontmatter', () => {
      addNote({
        tags: ['kaizen'],
        context: 'saboteur-pos',
        createdAt: '2026-07-27T10:00:00.000Z',
        raw: '---\nintentions: [unclosed\n  : : :\n---\nbody\n',
      });
      expect(previousIntentions(db, 'saboteur-pos')).toEqual([]);
    });

    it('tolerates intentions that are not a list', () => {
      addNote({
        tags: ['kaizen'],
        context: 'saboteur-pos',
        createdAt: '2026-07-27T10:00:00.000Z',
        frontmatter: 'intentions: just a string\n',
      });
      expect(previousIntentions(db, 'saboteur-pos')).toEqual([]);
    });

    it('tolerates a missing intentions field', () => {
      addNote({
        tags: ['kaizen'],
        context: 'saboteur-pos',
        createdAt: '2026-07-27T10:00:00.000Z',
      });
      expect(previousIntentions(db, 'saboteur-pos')).toEqual([]);
    });
  });

  describe('readIntentions', () => {
    it('drops blank entries and trims the rest', () => {
      const path = join(dir, 'x.md');
      writeFileSync(path, '---\nintentions:\n  - "  Ship it  "\n  - ""\n  - Rest\n---\nbody\n');
      expect(readIntentions(path)).toEqual(['Ship it', 'Rest']);
    });

    it('coerces numeric entries rather than dropping them', () => {
      const path = join(dir, 'y.md');
      writeFileSync(path, '---\nintentions:\n  - 2026\n---\nbody\n');
      expect(readIntentions(path)).toEqual(['2026']);
    });
  });
});
