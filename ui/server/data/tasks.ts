import type Database from 'better-sqlite3';
import { listTasks, getTask } from '../../../src/db/tasks.js';

export type { Task } from '../../../src/db/tasks.js';

export interface GetTasksOptions {
  contextId?: string;
  view?: string;
  staleDays?: number;
}

export function getTasks(db: Database.Database, opts: GetTasksOptions = {}) {
  return listTasks(db, {
    context_id: opts.contextId,
    view: opts.view,
    stale_task_days: opts.staleDays,
  });
}

export function getTaskById(db: Database.Database, id: string) {
  return getTask(db, id);
}
