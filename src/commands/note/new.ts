import { execSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../../config.js';
import { getDb } from '../../db/index.js';
import { upsertKnowledgeEntry } from '../../db/knowledge.js';
import { generateId } from '../../ids.js';
import { slugify } from '../../utils.js';

interface NoteNewOptions {
  context?: string;
  task?: string;
  tag?: string[];
  config?: string;
}

export function runNoteNew(title: string, options: NoteNewOptions): void {
  const editor = process.env.EDITOR;
  if (!editor) {
    process.stderr.write('No $EDITOR set. Export EDITOR=<your editor> and try again.\n');
    process.exit(1);
  }

  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  const contextId = options.context ?? config.active_context;

  // Validate context
  const ctx = db.prepare(`SELECT id FROM contexts WHERE id = ?`).get(contextId);
  if (!ctx) {
    process.stderr.write(`Context '${contextId}' does not exist.\n`);
    db.close();
    process.exit(1);
  }

  // Validate task if provided
  if (options.task) {
    const t = db.prepare(`SELECT id FROM tasks WHERE id = ?`).get(options.task);
    if (!t) {
      process.stderr.write(`Task '${options.task}' not found.\n`);
      db.close();
      process.exit(1);
    }
  }

  const notesPath = resolvePath(config.sources[0]?.path ?? '~/saboteur/notes');
  mkdirSync(notesPath, { recursive: true });

  const id = generateId('note');
  const now = new Date().toISOString().slice(0, 10);
  const filename = slugify(title) + '.md';
  const filePath = join(notesPath, filename);

  const frontmatter = {
    id,
    title,
    tags: options.tag ?? [],
    ...(options.task ? { task_id: options.task } : {}),
    context: contextId,
    created_at: now,
    updated_at: now,
  };

  const fileContent = matter.stringify('\n', frontmatter);
  writeFileSync(filePath, fileContent, 'utf-8');

  try {
    execSync(`${editor} ${filePath}`, { stdio: 'inherit' });
  } catch {
    process.stderr.write('Editor exited with an error.\n');
    db.close();
    process.exit(1);
  }

  // Re-read and index after editor closes
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = matter(raw);
  const fm = parsed.data as Record<string, unknown>;

  // Update updated_at on save
  const updatedAt = new Date().toISOString().slice(0, 10);
  const updatedFm: Record<string, unknown> = { ...fm, updated_at: updatedAt };
  writeFileSync(filePath, matter.stringify(parsed.content, updatedFm), 'utf-8');

  db.transaction(() => {
    upsertKnowledgeEntry(db, {
      id,
      source_id: 'personal-notes',
      type: 'note',
      title: (updatedFm.title as string) ?? title,
      tags: Array.isArray(updatedFm.tags) ? (updatedFm.tags as string[]) : [],
      task_id: (updatedFm.task_id as string) ?? null,
      context_id: (updatedFm.context as string) ?? contextId,
      path: filePath,
      created_at: (updatedFm.created_at as string) ?? now,
      updated_at: updatedAt,
    });
  })();

  db.close();
  process.stdout.write(`Created ${id}: "${title}" → ${filePath}\n`);
}
