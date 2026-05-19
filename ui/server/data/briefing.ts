import type Database from 'better-sqlite3';
import type { Config } from '../../../src/config.js';
import { listTasks } from '../../../src/db/tasks.js';
import type { Task } from '../../../src/db/tasks.js';

export type { Task };

export interface YesterdayNote {
  id: string;
  title: string | null;
  type: string;
  task_id: string | null;
  task_title: string | null;
}

export interface BriefingData {
  inboxTaskCount: number;
  inboxNoteCount: number;
  activeContext: string;
  contextName: string;
  activeTasks: Task[];
  staleTasks: Task[];
  blockedTasks: Task[];
  reviewTasks: Task[];
  yesterdayNotes: YesterdayNote[];
}

const PRIORITY_ORDER = ['critical', 'high', 'normal', 'low'];
const ENERGY_ORDER = ['deep', 'shallow', 'admin'];

export function getBriefingData(
  db: Database.Database,
  config: Config,
  contextId?: string,
): BriefingData {
  const activeContext = contextId ?? config.active_context;
  const staleDays = config.briefing.stale_task_days;

  const inboxTaskCount = (
    db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE context_id = 'inbox'`).get() as { c: number }
  ).c;
  const inboxNoteCount = (
    db
      .prepare(`SELECT COUNT(*) as c FROM knowledge_index WHERE context_id = 'inbox'`)
      .get() as { c: number }
  ).c;

  const allActiveTasks = listTasks(db, {
    context_id: activeContext,
    view: 'active',
    stale_task_days: staleDays,
  });

  const staleThreshold = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString();
  const staleTasks = allActiveTasks.filter((t) => t.updated_at < staleThreshold);
  const staleIds = new Set(staleTasks.map((t) => t.id));
  const activeTasks = allActiveTasks.filter((t) => !staleIds.has(t.id));

  activeTasks.sort((a, b) => {
    const pa = PRIORITY_ORDER.indexOf(a.priority);
    const pb = PRIORITY_ORDER.indexOf(b.priority);
    if (pa !== pb) return pa - pb;
    const ea = a.energy ? ENERGY_ORDER.indexOf(a.energy) : ENERGY_ORDER.length;
    const eb = b.energy ? ENERGY_ORDER.indexOf(b.energy) : ENERGY_ORDER.length;
    return ea - eb;
  });

  const blockedTasks = listTasks(db, { context_id: activeContext, state: 'blocked' });
  const reviewTasks = listTasks(db, { context_id: activeContext, state: 'review' });

  const yesterdayNotes = db
    .prepare(
      `SELECT ki.id, ki.title, ki.type, ki.task_id, t.title as task_title
       FROM knowledge_index ki
       LEFT JOIN tasks t ON ki.task_id = t.id
       WHERE ki.updated_at >= datetime('now', '-1 day')
         AND ki.context_id = ?`,
    )
    .all(activeContext) as YesterdayNote[];

  const ctxRow = db
    .prepare(`SELECT name FROM contexts WHERE id = ?`)
    .get(activeContext) as { name: string } | undefined;
  const contextName = ctxRow?.name ?? activeContext;

  return {
    inboxTaskCount,
    inboxNoteCount,
    activeContext,
    contextName,
    activeTasks,
    staleTasks,
    blockedTasks,
    reviewTasks,
    yesterdayNotes,
  };
}
