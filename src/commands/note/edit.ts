import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import type Database from 'better-sqlite3';
import matter from 'gray-matter';
import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../../config.js';
import { getDb } from '../../db/index.js';
import { type KnowledgeEntry, getKnowledgeEntry, upsertKnowledgeEntry } from '../../db/knowledge.js';
import { incrementalSync } from '../../sync.js';
import { c } from '../../colors.js';

type ResolveResult = { ok: true; content: string } | { ok: false; error: string };

export function resolveBodyContent(raw: string): ResolveResult {
  let content: string;
  if (raw.startsWith('@')) {
    const filePath = raw.slice(1);
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Cannot read file '${filePath}': ${msg}.` };
    }
  } else {
    content = raw;
  }

  if (content.trim() === '') {
    return {
      ok: false,
      error: "Body text is required for --body. Use 'sab note edit <id>' to open the editor.",
    };
  }

  return { ok: true, content };
}

function writeAndReindex(
  db: Database.Database,
  entry: KnowledgeEntry,
  id: string,
  body?: string,
): void {
  const raw = readFileSync(entry.path, 'utf-8');
  const parsed = matter(raw);
  const resolvedBody = body ?? parsed.content;
  const fm = parsed.data as Record<string, unknown>;
  const updatedAt = new Date().toISOString().slice(0, 10);
  const updatedFm: Record<string, unknown> = { ...fm, updated_at: updatedAt };
  writeFileSync(entry.path, matter.stringify(resolvedBody, updatedFm), 'utf-8');

  db.transaction(() => {
    upsertKnowledgeEntry(db, {
      id,
      source_id: entry.source_id,
      type: entry.type,
      title: (updatedFm.title as string) ?? entry.title,
      tags: Array.isArray(updatedFm.tags) ? (updatedFm.tags as string[]) : entry.tags,
      task_id: (updatedFm.task_id as string) ?? entry.task_id,
      context_id: (updatedFm.context as string) ?? entry.context_id,
      path: entry.path,
      created_at: (updatedFm.created_at as string) ?? entry.created_at,
      updated_at: updatedAt,
    });
  })();
}

export function runNoteEdit(id: string, options: { config?: string; body?: string }): void {
  // --body cannot be combined with editor flags (reserved for future flags; no current conflict)
  if (options.body === undefined) {
    const editor = process.env.EDITOR;
    if (!editor) {
      process.stderr.write(c.red('No $EDITOR set. Export EDITOR=<your editor> and try again.\n'));
      process.exit(1);
    }
  }

  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  incrementalSync(db, config);

  const entry = getKnowledgeEntry(db, id);
  if (!entry) {
    process.stderr.write(c.red(`Note '${id}' not found.\n`));
    db.close();
    process.exit(1);
  }

  if (options.body !== undefined) {
    const resolved = resolveBodyContent(options.body);
    if (!resolved.ok) {
      process.stderr.write(c.red(`${resolved.error}\n`));
      db.close();
      process.exit(1);
    }
    writeAndReindex(db, entry, id, resolved.content);
    db.close();
    process.stdout.write(c.green(`Updated note ${id}.\n`));
    return;
  }

  // Editor path (existing behaviour)
  const editor = process.env.EDITOR!;
  try {
    execSync(`${editor} ${entry.path}`, { stdio: 'inherit' });
  } catch {
    process.stderr.write(c.red('Editor exited with an error.\n'));
    db.close();
    process.exit(1);
  }

  writeAndReindex(db, entry, id);
  db.close();
  process.stdout.write(c.green(`Updated note ${id}.\n`));
}
