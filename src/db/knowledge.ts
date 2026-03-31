import type Database from 'better-sqlite3';

export interface KnowledgeEntry {
  id: string;
  source_id: string;
  type: string;
  title: string | null;
  tags: string[];
  task_id: string | null;
  context_id: string | null;
  path: string;
  created_at: string | null;
  updated_at: string | null;
}

interface KnowledgeRow {
  id: string;
  source_id: string;
  type: string;
  title: string | null;
  tags: string;
  task_id: string | null;
  context_id: string | null;
  path: string;
  created_at: string | null;
  updated_at: string | null;
}

function parseEntry(row: KnowledgeRow): KnowledgeEntry {
  return {
    ...row,
    tags: JSON.parse(row.tags ?? '[]'),
  };
}

export function getKnowledgeEntry(db: Database.Database, id: string): KnowledgeEntry | null {
  const row = db
    .prepare(`SELECT * FROM knowledge_index WHERE id = ?`)
    .get(id) as KnowledgeRow | undefined;
  return row ? parseEntry(row) : null;
}

export function findKnowledgeBySlug(db: Database.Database, slug: string): KnowledgeEntry | null {
  const rows = db
    .prepare(`SELECT * FROM knowledge_index`)
    .all() as KnowledgeRow[];
  for (const row of rows) {
    const entry = parseEntry(row);
    if (entry.title && slugify(entry.title) === slug) return entry;
  }
  return null;
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface ListNotesFilter {
  context_id?: string;
  view?: string;
  tag?: string;
  task_id?: string;
}

export function listKnowledgeEntries(
  db: Database.Database,
  filter: ListNotesFilter,
): KnowledgeEntry[] {
  const conditions: string[] = [`type = 'note'`];
  const params: string[] = [];

  if (filter.context_id) {
    conditions.push(`context_id = ?`);
    params.push(filter.context_id);
  }

  if (filter.tag) {
    conditions.push(`json_each.value = ?`);
    // Use json_each to search inside tags array
  }

  if (filter.task_id) {
    conditions.push(`task_id = ?`);
    params.push(filter.task_id);
  }

  if (filter.view === 'recent') {
    conditions.push(`updated_at >= datetime('now', '-7 days')`);
  }

  // Handle tag search with json_each
  if (filter.tag) {
    const tagRows = db
      .prepare(
        `SELECT ki.* FROM knowledge_index ki, json_each(ki.tags)
         WHERE json_each.value = ? AND ki.type = 'note'
         ${filter.context_id ? `AND ki.context_id = ?` : ''}
         ORDER BY ki.updated_at DESC`,
      )
      .all(...(filter.context_id ? [filter.tag, filter.context_id] : [filter.tag])) as KnowledgeRow[];
    return tagRows.map(parseEntry);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const rows = db
    .prepare(`SELECT * FROM knowledge_index ${where} ORDER BY updated_at DESC`)
    .all(...params) as KnowledgeRow[];
  return rows.map(parseEntry);
}

export function upsertKnowledgeEntry(
  db: Database.Database,
  entry: KnowledgeEntry,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO knowledge_index
     (id, source_id, type, title, tags, task_id, context_id, path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.id,
    entry.source_id,
    entry.type,
    entry.title,
    JSON.stringify(entry.tags),
    entry.task_id,
    entry.context_id,
    entry.path,
    entry.created_at,
    entry.updated_at,
  );
}

export function deleteKnowledgeEntry(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM knowledge_index WHERE id = ?`).run(id);
}

export function deleteKnowledgeBySource(db: Database.Database, sourceId: string): void {
  db.prepare(`DELETE FROM knowledge_index WHERE source_id = ?`).run(sourceId);
}
