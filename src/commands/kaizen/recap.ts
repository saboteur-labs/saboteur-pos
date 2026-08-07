import type Database from 'better-sqlite3';
import type { Config } from '../../config.js';
import type { Task } from '../../db/tasks.js';
import type { CommitRow } from '../../db/commits.js';
import { blockedInScope, commitsForTasks, doneSince } from '../checkin/recap.js';
import { c } from '../../colors.js';

/**
 * Per-context recap shown before each project snapshot, so "what moved" is
 * answered against the record rather than from memory a week later.
 *
 * Read-only: every query here is a select, and nothing on this path writes.
 */

export interface ContextRecap {
  shipped: Task[];
  commitsByTask: Map<string, CommitRow[]>;
  blocked: Array<{ task: Task; blockerTitles: string[] }>;
}

/** Which parts of the recap a `sab:repeat`'s `recap` attribute asked for. */
export interface RecapRequest {
  doneTasks: boolean;
  linkedCommits: boolean;
  blockedTasks: boolean;
}

export function parseRecapRequest(recap: string[]): RecapRequest {
  return {
    doneTasks: recap.includes('done_tasks'),
    linkedCommits: recap.includes('linked_commits'),
    blockedTasks: recap.includes('blocked_tasks'),
  };
}

export function collectContextRecap(
  db: Database.Database,
  config: Config,
  contextId: string,
  cutoffIso: string,
  request: RecapRequest,
): ContextRecap {
  const shipped = request.doneTasks ? doneSince(db, contextId, cutoffIso) : [];

  const commitsByTask = new Map<string, CommitRow[]>();
  if (request.linkedCommits && shipped.length > 0) {
    for (const commit of commitsForTasks(db, config, shipped.map((t) => t.id))) {
      if (!commit.task_id) continue;
      const list = commitsByTask.get(commit.task_id) ?? [];
      list.push(commit);
      commitsByTask.set(commit.task_id, list);
    }
  }

  const blocked = request.blockedTasks ? blockedInScope(db, contextId) : [];

  return { shipped, commitsByTask, blocked };
}

/**
 * Render a recap for display.
 *
 * A context with nothing to show still prints a line. Blank space reads as "the
 * tool has nothing for you"; an explicit "no movement recorded" is itself an
 * answer, and the template's own instruction says a skip should be stated
 * rather than left empty.
 */
export function formatContextRecap(label: string, recap: ContextRecap): string {
  const lines: string[] = [];
  lines.push(c.label(`── ${label} ─────────────────────────────`));

  if (recap.shipped.length === 0 && recap.blocked.length === 0) {
    lines.push(c.muted('  (no movement recorded this week)'));
    return lines.join('\n') + '\n';
  }

  if (recap.shipped.length > 0) {
    lines.push(c.label('  Shipped:'));
    for (const task of recap.shipped) {
      lines.push(`    ${c.muted(task.id)}  ${task.title}`);
      for (const commit of recap.commitsByTask.get(task.id) ?? []) {
        lines.push(`      ${c.muted(commit.sha.slice(0, 7))}  ${commit.message.split('\n')[0]}`);
      }
    }
  }

  if (recap.blocked.length > 0) {
    lines.push(c.label('  Blocked:'));
    for (const { task, blockerTitles } of recap.blocked) {
      lines.push(`    ${c.muted(task.id)}  ${c.amber(task.title)}`);
      if (blockerTitles.length > 0) {
        lines.push(`      ${c.muted('Blocked by:')} ${c.muted(blockerTitles.join(', '))}`);
      }
    }
  }

  return lines.join('\n') + '\n';
}
