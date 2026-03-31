import type Database from 'better-sqlite3';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import matter from 'gray-matter';
import { join } from 'path';
import type { Config } from './config.js';
import { resolvePath } from './config.js';
import {
  deleteKnowledgeBySource,
  deleteKnowledgeEntry,
  getKnowledgeEntry,
  upsertKnowledgeEntry,
} from './db/knowledge.js';
import { generateId } from './ids.js';

interface Source {
  id: string;
  type: string;
  path: string;
  owner: string;
  context_id: string | null;
  enabled: number;
}

function collectMdFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectMdFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory may not exist yet
  }
  return files;
}

function parseFrontmatter(
  filePath: string,
  sourceId: string,
  fallbackContextId: string | null,
  activeContext: string,
): ReturnType<typeof buildEntry> | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = matter(raw);
    const fm = parsed.data as Record<string, unknown>;
    return buildEntry(filePath, fm, sourceId, fallbackContextId, activeContext);
  } catch {
    process.stderr.write(`Warning: malformed frontmatter in ${filePath} — skipped.\n`);
    return null;
  }
}

function fmString(val: unknown): string | null {
  if (val === undefined || val === null) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val);
}

function buildEntry(
  filePath: string,
  fm: Record<string, unknown>,
  sourceId: string,
  fallbackContextId: string | null,
  activeContext: string,
) {
  const id = fmString(fm.id);
  const title = fmString(fm.title);
  const tags = Array.isArray(fm.tags) ? (fm.tags as string[]) : [];
  const taskId = fmString(fm.task_id);
  const context =
    fmString(fm.context) ?? fallbackContextId ?? activeContext;
  const createdAt = fmString(fm.created_at);
  const updatedAt = fmString(fm.updated_at);

  return {
    id,
    title,
    tags,
    task_id: taskId,
    context_id: context,
    created_at: createdAt,
    updated_at: updatedAt,
    filePath,
    sourceId,
  };
}

function ensureId(
  filePath: string,
  fm: Record<string, unknown>,
  rawContent: string,
  parsedContent: string,
): string {
  if (fm.id) return String(fm.id);

  const newId = generateId('note');
  // Write id back to the file's frontmatter
  const newFrontmatter = { ...fm, id: newId };
  const updatedFile = matter.stringify(parsedContent, newFrontmatter);
  writeFileSync(filePath, updatedFile, 'utf-8');
  return newId;
}

export function fullSync(db: Database.Database, config: Config): number {
  const sources = db
    .prepare(`SELECT * FROM sources WHERE enabled = 1`)
    .all() as Source[];

  let total = 0;

  for (const source of sources) {
    const sourcePath = resolvePath(source.path);
    const files = collectMdFiles(sourcePath);

    db.transaction(() => {
      deleteKnowledgeBySource(db, source.id);
    })();

    for (const filePath of files) {
      try {
        const raw = readFileSync(filePath, 'utf-8');
        const parsed = matter(raw);
        const fm = parsed.data as Record<string, unknown>;

        const id = ensureId(filePath, fm, raw, parsed.content);
        const fmWithId = { ...fm, id };

        const entry = buildEntry(
          filePath,
          fmWithId,
          source.id,
          source.context_id,
          config.active_context,
        );

        db.transaction(() => {
          upsertKnowledgeEntry(db, {
            id,
            source_id: source.id,
            type: source.type,
            title: entry.title,
            tags: entry.tags,
            task_id: entry.task_id,
            context_id: entry.context_id,
            path: filePath,
            created_at: entry.created_at,
            updated_at: entry.updated_at,
          });
        })();

        total++;
      } catch {
        process.stderr.write(`Warning: malformed frontmatter in ${filePath} — skipped.\n`);
      }
    }
  }

  return total;
}

export function incrementalSync(db: Database.Database, config: Config): void {
  const sources = db
    .prepare(`SELECT * FROM sources WHERE enabled = 1`)
    .all() as Source[];

  for (const source of sources) {
    const sourcePath = resolvePath(source.path);
    const diskFiles = new Set(collectMdFiles(sourcePath));

    // Remove entries for deleted files
    const indexed = db
      .prepare(`SELECT id, path FROM knowledge_index WHERE source_id = ?`)
      .all(source.id) as Array<{ id: string; path: string }>;

    for (const row of indexed) {
      if (!diskFiles.has(row.path)) {
        db.transaction(() => deleteKnowledgeEntry(db, row.id))();
      }
    }

    // Re-index changed files
    for (const filePath of diskFiles) {
      try {
        const stat = statSync(filePath);
        const fileMtime = new Date(stat.mtimeMs).toISOString();

        const raw = readFileSync(filePath, 'utf-8');
        const parsed = matter(raw);
        const fm = parsed.data as Record<string, unknown>;

        const id = ensureId(filePath, fm, raw, parsed.content);
        const fmWithId = { ...fm, id };

        const existing = getKnowledgeEntry(db, id);
        if (existing && existing.updated_at && existing.updated_at >= fileMtime) continue;

        const entry = buildEntry(
          filePath,
          fmWithId,
          source.id,
          source.context_id,
          config.active_context,
        );

        db.transaction(() => {
          upsertKnowledgeEntry(db, {
            id,
            source_id: source.id,
            type: source.type,
            title: entry.title,
            tags: entry.tags,
            task_id: entry.task_id,
            context_id: entry.context_id,
            path: filePath,
            created_at: entry.created_at,
            updated_at: entry.updated_at,
          });
        })();
      } catch {
        process.stderr.write(`Warning: could not index ${filePath} — skipped.\n`);
      }
    }
  }
}
