import { readFileSync } from 'fs';
import type Database from 'better-sqlite3';
import matter from 'gray-matter';
import { listKnowledgeEntries, getKnowledgeEntry } from '../../../src/db/knowledge.js';

export type { KnowledgeEntry } from '../../../src/db/knowledge.js';

export interface NoteDetail {
  id: string;
  title: string | null;
  tags: string[];
  task_id: string | null;
  context_id: string | null;
  path: string;
  created_at: string | null;
  updated_at: string | null;
  body: string;
}

export interface GetNotesOptions {
  contextId?: string;
  view?: string;
  tag?: string;
  taskId?: string;
}

export function getNotes(db: Database.Database, opts: GetNotesOptions = {}) {
  return listKnowledgeEntries(db, {
    context_id: opts.contextId,
    view: opts.view,
    tag: opts.tag,
    task_id: opts.taskId,
  });
}

export function getNoteById(db: Database.Database, id: string): NoteDetail | null {
  const entry = getKnowledgeEntry(db, id);
  if (!entry) return null;

  let body = '';
  try {
    const raw = readFileSync(entry.path, 'utf-8');
    body = matter(raw).content.trimStart();
  } catch {
    // File missing from disk — return index data with empty body
  }

  return { ...entry, body };
}
