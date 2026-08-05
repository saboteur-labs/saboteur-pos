import { existsSync, readFileSync } from 'fs';
import type Database from 'better-sqlite3';
import matter from 'gray-matter';

/**
 * Carry-forward lookup: the intentions recorded by the previous Kaizen note,
 * which prefill this week's "did they hold?" table.
 */

export interface PriorKaizen {
  id: string;
  path: string;
  createdAt: string;
  intentions: string[];
}

interface KaizenRow {
  id: string;
  path: string;
  created_at: string;
}

/**
 * Most recently created `kaizen`-tagged note in `contextId`, or null.
 *
 * Ordered by `created_at` with `rowid` as the tie-break. Two reviews of the same
 * week are allowed, and timestamps alone can tie — at date granularity always,
 * and even at millisecond granularity for back-to-back writes. Falling back to
 * insertion order means the newest review always wins rather than the answer
 * depending on clock resolution.
 *
 * Keyed off `tags`, never off `type` — Kaizen notes are ordinary
 * `type = 'note'` rows, exactly like standup and retro, because
 * `listKnowledgeEntries` hardcodes that type and any other value would make
 * them unreachable via `sab note find`.
 *
 * Never throws on bad data: a note whose file has been deleted, hand-edited
 * into invalid YAML, or given a non-array `intentions` yields no intentions
 * rather than blocking the review. A broken prior week should cost the prefill,
 * not this week's Kaizen.
 */
export function mostRecentKaizen(db: Database.Database, contextId: string): PriorKaizen | null {
  const row = db
    .prepare(
      `SELECT ki.id, ki.path, ki.created_at FROM knowledge_index ki, json_each(ki.tags)
       WHERE ki.type = 'note' AND json_each.value = 'kaizen' AND ki.context_id = ?
       ORDER BY ki.created_at DESC, ki.rowid DESC LIMIT 1`,
    )
    .get(contextId) as KaizenRow | undefined;

  if (!row) return null;

  return {
    id: row.id,
    path: row.path,
    createdAt: row.created_at,
    intentions: readIntentions(row.path),
  };
}

/** The `intentions` frontmatter array of a Kaizen note, or [] if unreadable. */
export function readIntentions(path: string): string[] {
  if (!existsSync(path)) return [];

  let data: Record<string, unknown>;
  try {
    data = matter(readFileSync(path, 'utf-8')).data as Record<string, unknown>;
  } catch {
    return [];
  }

  const raw = data.intentions;
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((entry): entry is string | number => typeof entry === 'string' || typeof entry === 'number')
    .map((entry) => String(entry).trim())
    .filter((entry) => entry !== '');
}

/** Intentions to carry forward, or [] when there is no usable prior note. */
export function previousIntentions(db: Database.Database, contextId: string): string[] {
  return mostRecentKaizen(db, contextId)?.intentions ?? [];
}
