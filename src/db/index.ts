import Database from 'better-sqlite3';
import { CREATE_TABLES } from './schema.js';

export function getDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(CREATE_TABLES);
  return db;
}
