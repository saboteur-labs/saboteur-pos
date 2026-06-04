import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { CREATE_TABLES } from './schema.js';
import { addContextRepos, getContext, removeContextRepos } from './contexts.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(CREATE_TABLES);
  db.prepare(
    `INSERT INTO contexts (id, name, repos, created_at)
     VALUES ('work', 'Work', '[]', '2026-01-01T00:00:00Z')`,
  ).run();
  return db;
}

describe('contexts repo mutators', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  it('addContextRepos appends names and returns the updated context', () => {
    const ctx = addContextRepos(db, 'work', ['varsentry', 'landing']);
    expect(ctx.repos).toEqual(['varsentry', 'landing']);
    // Persisted as a JSON array string on the row.
    const raw = (db.prepare(`SELECT repos FROM contexts WHERE id = 'work'`).get() as {
      repos: string;
    }).repos;
    expect(JSON.parse(raw)).toEqual(['varsentry', 'landing']);
  });

  it('addContextRepos de-duplicates against existing and within input', () => {
    addContextRepos(db, 'work', ['varsentry']);
    const ctx = addContextRepos(db, 'work', ['varsentry', 'landing', 'landing']);
    expect(ctx.repos).toEqual(['varsentry', 'landing']);
  });

  it('removeContextRepos removes named repos', () => {
    addContextRepos(db, 'work', ['varsentry', 'landing']);
    const ctx = removeContextRepos(db, 'work', ['landing']);
    expect(ctx.repos).toEqual(['varsentry']);
  });

  it('removeContextRepos is a no-op for absent names', () => {
    addContextRepos(db, 'work', ['varsentry']);
    const ctx = removeContextRepos(db, 'work', ['nope', 'landing']);
    expect(ctx.repos).toEqual(['varsentry']);
  });

  it('throws when the context does not exist', () => {
    expect(() => addContextRepos(db, 'ghost', ['x'])).toThrow("Context 'ghost' does not exist.");
    expect(() => removeContextRepos(db, 'ghost', ['x'])).toThrow(
      "Context 'ghost' does not exist.",
    );
    // Sanity: getContext agrees the context is absent.
    expect(getContext(db, 'ghost')).toBeNull();
  });
});
