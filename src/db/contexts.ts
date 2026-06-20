import type Database from 'better-sqlite3';

/** A repo a context owns. A bare string is the whole repo; the object form
 * restricts it to sub-paths (monorepo sub-context). Both forms coexist in the
 * `repos` JSON array. */
export type RepoEntry = { repo: string; paths: string[] };
export type RawRepoEntry = string | RepoEntry;

export interface Context {
  id: string;
  name: string;
  description: string | null;
  repos: RawRepoEntry[];
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

/** Normalize the mixed `repos` array into `{ repo, paths }` entries. The single
 * place the string|object shape is interpreted — every consumer goes through
 * this (or `repoNames`). */
export function repoEntries(ctx: Context): RepoEntry[] {
  return ctx.repos.map((e) =>
    typeof e === 'string' ? { repo: e, paths: [] } : { repo: e.repo, paths: e.paths ?? [] },
  );
}

/** Just the repo basenames a context owns (drops any path restrictions). */
export function repoNames(ctx: Context): string[] {
  return repoEntries(ctx).map((e) => e.repo);
}

function entryName(e: RawRepoEntry): string {
  return typeof e === 'string' ? e : e.repo;
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

function persistRepos(db: Database.Database, slug: string, repos: RawRepoEntry[]): Context {
  db.transaction(() => {
    db.prepare(`UPDATE contexts SET repos = ? WHERE id = ?`).run(JSON.stringify(repos), slug);
  })();
  return getContext(db, slug)!;
}

export function addContextRepos(db: Database.Database, slug: string, repos: string[]): Context {
  const ctx = getContext(db, slug);
  if (!ctx) throw new Error(`Context '${slug}' does not exist.`);

  const merged = [...ctx.repos];
  const have = new Set(merged.map(entryName));
  for (const repo of repos) {
    if (!have.has(repo)) {
      merged.push(repo);
      have.add(repo);
    }
  }
  return persistRepos(db, slug, merged);
}

export function removeContextRepos(db: Database.Database, slug: string, repos: string[]): Context {
  const ctx = getContext(db, slug);
  if (!ctx) throw new Error(`Context '${slug}' does not exist.`);

  const toRemove = new Set(repos);
  const filtered = ctx.repos.filter((e) => !toRemove.has(entryName(e)));
  return persistRepos(db, slug, filtered);
}

/** Attach a sub-path glob to a repo entry, lifting a bare-string entry into the
 * object form. Creates the entry if the repo isn't linked yet. This is what
 * makes a context a monorepo sub-context. */
export function addContextRepoPath(
  db: Database.Database,
  slug: string,
  repo: string,
  glob: string,
): Context {
  const ctx = getContext(db, slug);
  if (!ctx) throw new Error(`Context '${slug}' does not exist.`);

  const entries = [...ctx.repos];
  const idx = entries.findIndex((e) => entryName(e) === repo);
  if (idx === -1) {
    entries.push({ repo, paths: [glob] });
  } else {
    const e = entries[idx];
    const obj: RepoEntry =
      typeof e === 'string' ? { repo: e, paths: [] } : { repo: e.repo, paths: [...(e.paths ?? [])] };
    if (!obj.paths.includes(glob)) obj.paths.push(glob);
    entries[idx] = obj;
  }
  return persistRepos(db, slug, entries);
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
