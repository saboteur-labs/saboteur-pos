import { readFileSync } from 'fs';
import type Database from 'better-sqlite3';
import matter from 'gray-matter';
import type { Config } from '../../config.js';
import { getTask, listTasks, type Task } from '../../db/tasks.js';
import { listCommitsForTask, type CommitRow } from '../../db/commits.js';
import { indexCommits } from '../../git/index-job.js';

/**
 * Tasks in `contextId` that moved to `done` at or after `cutoffIso`, per their
 * append-only `state_history`. Mirrors the "shipped since cutoff" logic used
 * by the weekly briefing (see `commands/briefing.ts` `runWeeklyBriefing`).
 */
export function doneSince(db: Database.Database, contextId: string, cutoffIso: string): Task[] {
  const candidates = listTasks(db, { context_id: contextId, state: 'done' });
  return candidates.filter((task) =>
    task.state_history.some((entry) => entry.state === 'done' && entry.timestamp >= cutoffIso),
  );
}

/**
 * Blocked tasks in `contextId`, each paired with the resolved titles of the
 * tasks blocking it (mirrors briefing.ts's Section 5 blocker-title lookup).
 */
export function blockedInScope(
  db: Database.Database,
  contextId: string,
): Array<{ task: Task; blockerTitles: string[] }> {
  const blockedTasks = listTasks(db, { context_id: contextId, state: 'blocked' });
  return blockedTasks.map((task) => ({
    task,
    blockerTitles: task.blocked_by.map((id) => getTask(db, id)?.title ?? id),
  }));
}

/**
 * Refresh git → task commit links (mirroring briefing's usage of
 * `indexCommits`), then return the flattened, sha-deduped set of commits
 * linked to any of `taskIds`.
 */
export function commitsForTasks(
  db: Database.Database,
  config: Config,
  taskIds: string[],
): CommitRow[] {
  indexCommits(db, config);

  const bySha = new Map<string, CommitRow>();
  for (const taskId of taskIds) {
    for (const commit of listCommitsForTask(db, taskId)) {
      bySha.set(commit.sha, commit);
    }
  }
  return [...bySha.values()];
}

export interface RecentStandup {
  id: string;
  path: string;
  slot: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

interface StandupRow {
  id: string;
  path: string;
}

/**
 * Most recently created `standup`-tagged note scoped to `contextId`, parsed
 * from disk via gray-matter. Returns `null` when none exists.
 */
export function mostRecentStandup(db: Database.Database, contextId: string): RecentStandup | null {
  const row = db
    .prepare(
      `SELECT ki.id, ki.path FROM knowledge_index ki, json_each(ki.tags)
       WHERE ki.type = 'note' AND json_each.value = 'standup' AND ki.context_id = ?
       ORDER BY ki.created_at DESC LIMIT 1`,
    )
    .get(contextId) as StandupRow | undefined;

  if (!row) return null;

  const raw = readFileSync(row.path, 'utf-8');
  const parsed = matter(raw);
  const frontmatter = parsed.data as Record<string, unknown>;

  return {
    id: row.id,
    path: row.path,
    slot: (frontmatter.slot as string) ?? 'unknown',
    frontmatter,
    body: parsed.content,
  };
}
