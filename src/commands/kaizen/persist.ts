import type Database from 'better-sqlite3';
import type { Config } from '../../config.js';
import type { KaizenTemplate } from '../../kaizen/loader.js';
import { createCheckinNote, type CreateCheckinNoteResult } from '../checkin/writeCheckinNote.js';

/**
 * Persist a completed Kaizen review as a note.
 *
 * Reuses the standup/retro note writer rather than forking it: same
 * frontmatter-plus-markdown shape, same transactional file-and-index write, same
 * `type = 'note'` so `sab note find --tag kaizen` reaches it.
 */

export interface PersistKaizenOptions {
  contextId: string;
  /** Monday of the week under review, `YYYY-MM-DD`. */
  weekOf: string;
  template: KaizenTemplate;
  /** Section 6's answers, stored structurally so next week reads a field, not prose. */
  intentions: string[];
  /** The rendered review. */
  body: string;
}

export function persistKaizen(
  db: Database.Database,
  config: Config,
  opts: PersistKaizenOptions,
): CreateCheckinNoteResult {
  return createCheckinNote(db, config, {
    title: `Kaizen — week of ${opts.weekOf}`,
    tags: ['kaizen'],
    contextId: opts.contextId,
    body: opts.body,
    // Full ISO, not date-only: multiple reviews in one week are allowed, and the
    // carry-forward lookup picks the most recent by `created_at`. At day
    // granularity two same-day reviews tie and the wrong week's intentions can
    // surface next time.
    createdAt: new Date().toISOString(),
    // The note is filed under the week it covers, not the day it was written, so
    // a Monday review of last week sorts where it belongs.
    filenameDate: opts.weekOf,
    extraFrontmatter: {
      week_of: opts.weekOf,
      template_path: opts.template.path,
      template_hash: opts.template.hash,
      template_version: opts.template.frontmatter.template_version,
      intentions: opts.intentions,
    },
  });
}
