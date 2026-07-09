import Database from 'better-sqlite3';
import { CREATE_TABLES } from './schema.js';

/**
 * Bring an already-created DB up to the current schema. `CREATE TABLE IF NOT
 * EXISTS` never alters an existing table, so a nullable column added after a DB
 * was first initialized must be backfilled here. Idempotent: a no-op once the
 * column exists (and always a no-op for freshly created DBs).
 */
function ensureColumns(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(commits)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'sub_context')) {
    db.exec(`ALTER TABLE commits ADD COLUMN sub_context TEXT DEFAULT NULL`);
  }
  // Index lives here rather than in CREATE_TABLES: the column is added by the
  // ALTER above for pre-existing DBs, so an index on it can only be created
  // after ensureColumns runs. Idempotent for fresh DBs (column already present).
  db.exec(`CREATE INDEX IF NOT EXISTS idx_commits_sub_context ON commits(sub_context)`);
}

export function getDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(CREATE_TABLES);
  ensureColumns(db);
  return db;
}
