import type Database from 'better-sqlite3';

export interface Context {
  id: string;
  name: string;
  description: string | null;
  repos: string[];
  created_at: string;
}

interface ContextRow {
  id: string;
  name: string;
  description: string | null;
  repos: string;
  created_at: string;
}

function parseContext(row: ContextRow): Context {
  return { ...row, repos: JSON.parse(row.repos) };
}

export function getContext(db: Database.Database, id: string): Context | null {
  const row = db.prepare(`SELECT * FROM contexts WHERE id = ?`).get(id) as ContextRow | undefined;
  return row ? parseContext(row) : null;
}

export interface ContextWithCounts extends Context {
  task_count: number;
  note_count: number;
}

export function listContexts(db: Database.Database): ContextWithCounts[] {
  const rows = db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM tasks t WHERE t.context_id = c.id) AS task_count,
        (SELECT COUNT(*) FROM knowledge_index k WHERE k.context_id = c.id) AS note_count
       FROM contexts c
       ORDER BY c.id`,
    )
    .all() as Array<ContextRow & { task_count: number; note_count: number }>;

  return rows.map((r) => ({ ...parseContext(r), task_count: r.task_count, note_count: r.note_count }));
}

export interface CreateContextOptions {
  slug: string;
  name?: string;
  description?: string;
}

export function createContext(db: Database.Database, opts: CreateContextOptions): Context {
  const now = new Date().toISOString();
  const name = opts.name ?? opts.slug;

  db.transaction(() => {
    db.prepare(
      `INSERT INTO contexts (id, name, description, repos, created_at) VALUES (?, ?, ?, '[]', ?)`,
    ).run(opts.slug, name, opts.description ?? null, now);
  })();

  return getContext(db, opts.slug)!;
}

export interface DeleteContextOptions {
  reassign?: string;
  force?: boolean;
}

export function deleteContext(
  db: Database.Database,
  slug: string,
  opts: DeleteContextOptions,
): { taskCount: number; noteCount: number } {
  if (slug === 'inbox') {
    throw new Error('inbox is a reserved context and cannot be deleted.');
  }

  const ctx = getContext(db, slug);
  if (!ctx) throw new Error(`Context '${slug}' does not exist.`);

  const taskCount = (
    db.prepare(`SELECT COUNT(*) as count FROM tasks WHERE context_id = ?`).get(slug) as {
      count: number;
    }
  ).count;

  const noteCount = (
    db
      .prepare(`SELECT COUNT(*) as count FROM knowledge_index WHERE context_id = ?`)
      .get(slug) as { count: number }
  ).count;

  if ((taskCount > 0 || noteCount > 0) && !opts.reassign && !opts.force) {
    throw new Error(
      `${slug} has ${taskCount} task${taskCount === 1 ? '' : 's'} and ${noteCount} note${noteCount === 1 ? '' : 's'}. ` +
        `Use --reassign <context> to migrate them, or --force to orphan them to inbox.`,
    );
  }

  const targetId = opts.reassign ?? 'inbox';

  if (opts.reassign) {
    const target = getContext(db, opts.reassign);
    if (!target) throw new Error(`Context '${opts.reassign}' does not exist.`);
  }

  db.transaction(() => {
    db.prepare(`UPDATE tasks SET context_id = ? WHERE context_id = ?`).run(targetId, slug);
    db.prepare(`UPDATE knowledge_index SET context_id = ? WHERE context_id = ?`).run(targetId, slug);
    db.prepare(`DELETE FROM contexts WHERE id = ?`).run(slug);
  })();

  return { taskCount, noteCount };
}
