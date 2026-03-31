import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import matter from 'gray-matter';
import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../../config.js';
import { getDb } from '../../db/index.js';
import { getKnowledgeEntry, upsertKnowledgeEntry } from '../../db/knowledge.js';
import { incrementalSync } from '../../sync.js';
import { c } from '../../colors.js';

export function runNoteEdit(id: string, options: { config?: string }): void {
  const editor = process.env.EDITOR;
  if (!editor) {
    process.stderr.write(c.red('No $EDITOR set. Export EDITOR=<your editor> and try again.\n'));
    process.exit(1);
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

  try {
    execSync(`${editor} ${entry.path}`, { stdio: 'inherit' });
  } catch {
    process.stderr.write(c.red('Editor exited with an error.\n'));
    db.close();
    process.exit(1);
  }

  // Re-read, update updated_at, re-index
  const raw = readFileSync(entry.path, 'utf-8');
  const parsed = matter(raw);
  const fm = parsed.data as Record<string, unknown>;
  const updatedAt = new Date().toISOString().slice(0, 10);
  const updatedFm: Record<string, unknown> = { ...fm, updated_at: updatedAt };
  writeFileSync(entry.path, matter.stringify(parsed.content, updatedFm), 'utf-8');

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

  db.close();
  process.stdout.write(c.green(`Updated note ${id}.\n`));
}
