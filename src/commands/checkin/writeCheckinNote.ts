import { randomBytes } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
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
  const now = new Date().toISOString().slice(0, 10);
  const shortId = randomBytes(4).toString('hex');
  const primaryTag = opts.tags[0] ?? 'note';
  const filename = `${now}-${primaryTag}-${shortId}.md`;
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

  return { id, path: filePath };
}
