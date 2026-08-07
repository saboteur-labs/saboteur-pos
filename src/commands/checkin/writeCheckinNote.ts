import { randomBytes } from 'crypto';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import type Database from 'better-sqlite3';
import matter from 'gray-matter';
import { resolvePath, type Config } from '../../config.js';
import { upsertKnowledgeEntry } from '../../db/knowledge.js';
import { generateId } from '../../ids.js';

export interface CreateCheckinNoteOptions {
  title: string;
  tags: string[];
  extraFrontmatter: Record<string, unknown>;
  body: string;
  contextId: string;
  /**
   * Timestamp for `created_at`/`updated_at`. Defaults to today's date. Pass a
   * full ISO timestamp where "most recent note wins" lookups must not tie —
   * date-only values make two same-day notes indistinguishable to an
   * `ORDER BY created_at DESC LIMIT 1`.
   */
  createdAt?: string;
  /** Filename date prefix. Defaults to today; pass the period the note covers. */
  filenameDate?: string;
}

export interface CreateCheckinNoteResult {
  id: string;
  path: string;
}

/**
 * Write a standup/retro note to disk and index it, mirroring the pattern in
 * `commands/note/new.ts`. Unlike `note new`, the filename always includes a
 * random short suffix so repeated same-day check-ins never collide/overwrite.
 */
export function createCheckinNote(
  db: Database.Database,
  config: Config,
  opts: CreateCheckinNoteOptions,
): CreateCheckinNoteResult {
  const notesPath = resolvePath(config.sources[0]?.path ?? '~/saboteur/notes');
  mkdirSync(notesPath, { recursive: true });

  const id = generateId('note');
  const today = new Date().toISOString().slice(0, 10);
  const now = opts.createdAt ?? today;
  const shortId = randomBytes(4).toString('hex');
  const primaryTag = opts.tags[0] ?? 'note';
  const filename = `${opts.filenameDate ?? today}-${primaryTag}-${shortId}.md`;
  const filePath = join(notesPath, filename);

  const frontmatter = {
    id,
    title: opts.title,
    tags: opts.tags,
    context: opts.contextId,
    created_at: now,
    updated_at: now,
    ...opts.extraFrontmatter,
  };

  writeFileSync(filePath, matter.stringify(opts.body, frontmatter), 'utf-8');

  try {
    db.transaction(() => {
      upsertKnowledgeEntry(db, {
        id,
        source_id: 'personal-notes',
        type: 'note',
        title: opts.title,
        tags: opts.tags,
        task_id: null,
        context_id: opts.contextId,
        path: filePath,
        created_at: now,
        updated_at: now,
      });
    })();
  } catch (err) {
    // The file has to be written before indexing (the row records its path), so
    // a failed index would otherwise strand an unreferenced note on disk.
    // Removing it keeps the pair all-or-nothing, per the no-partial-state rule.
    try {
      rmSync(filePath, { force: true });
    } catch {
      /* the original failure is the one worth reporting */
    }
    throw err;
  }

  return { id, path: filePath };
}
