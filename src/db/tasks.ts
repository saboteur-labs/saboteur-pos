import type Database from 'better-sqlite3';
import { generateId } from '../ids.js';
import { validateTransition, type TaskState } from '../state-machine.js';

export interface Task {
  id: string;
  title: string;
  state: TaskState;
  context_id: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  energy: 'deep' | 'shallow' | 'admin' | null;
  effort: 'xs' | 's' | 'm' | 'l' | 'xl' | null;
  blocks: string[];
  blocked_by: string[];
  note_id: string | null;
  repo: string | null;
  branch: string | null;
  state_history: Array<{ state: string; timestamp: string; reason?: string }>;
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  id: string;
  title: string;
  state: string;
  context_id: string;
  priority: string;
  energy: string | null;
  effort: string | null;
  blocks: string;
  blocked_by: string;
  note_id: string | null;
  repo: string | null;
  branch: string | null;
  state_history: string;
  created_at: string;
  updated_at: string;
}

function parseTask(row: TaskRow): Task {
  return {
    ...row,
    state: row.state as TaskState,
    priority: row.priority as Task['priority'],
    energy: (row.energy ?? null) as Task['energy'],
    effort: (row.effort ?? null) as Task['effort'],
    blocks: JSON.parse(row.blocks),
    blocked_by: JSON.parse(row.blocked_by),
    state_history: JSON.parse(row.state_history),
  };
}

export interface CreateTaskOptions {
  title: string;
  context_id: string;
  priority?: Task['priority'];
  energy?: Task['energy'];
  effort?: Task['effort'];
  repo?: string | null;
}

export function createTask(db: Database.Database, opts: CreateTaskOptions): Task {
  const now = new Date().toISOString();
  const id = generateId('task');
  const priority = opts.priority ?? 'normal';
  const initialHistory = JSON.stringify([{ state: 'backlog', timestamp: now }]);

  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO tasks
       (id, title, state, context_id, priority, energy, effort, blocks, blocked_by,
        note_id, repo, branch, state_history, created_at, updated_at)
       VALUES (?, ?, 'backlog', ?, ?, ?, ?, '[]', '[]', NULL, ?, NULL, ?, ?, ?)`,
    ).run(
      id,
      opts.title,
      opts.context_id,
      priority,
      opts.energy ?? null,
      opts.effort ?? null,
      opts.repo ?? null,
      initialHistory,
      now,
      now,
    );
  });
  insert();

  return getTask(db, id)!;
}

export function getTask(db: Database.Database, id: string): Task | null {
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined;
  if (!row) return null;
  return parseTask(row);
}

export interface ListTasksFilter {
  context_id?: string;
  state?: TaskState;
  view?: string;
  stale_task_days?: number;
}

export function listTasks(db: Database.Database, filter: ListTasksFilter): Task[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter.context_id) {
    conditions.push(`context_id = ?`);
    params.push(filter.context_id);
  }

  const view = filter.view;
  if (view) {
    applyViewFilter(view, conditions, params, filter.stale_task_days ?? 3);
  } else if (filter.state) {
    conditions.push(`state = ?`);
    params.push(filter.state);
  } else {
    // default: all non-done
    conditions.push(`state != 'done'`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = view === 'today' ? priorityEnergyOrder() : `ORDER BY updated_at DESC`;

  const rows = db.prepare(`SELECT * FROM tasks ${where} ${orderBy}`).all(...params) as TaskRow[];
  return rows.map(parseTask);
}

function applyViewFilter(
  view: string,
  conditions: string[],
  params: (string | number)[],
  staleDays: number,
): void {
  switch (view) {
    case 'today':
    case 'active':
      conditions.push(`state = 'active'`);
      break;
    case 'backlog':
      conditions.push(`state = 'backlog'`);
      break;
    case 'blocked':
      conditions.push(`state = 'blocked'`);
      break;
    case 'review':
      conditions.push(`state = 'review'`);
      break;
    case 'deep-work':
      conditions.push(`state = 'active'`);
      conditions.push(`energy = 'deep'`);
      conditions.push(`json_array_length(blocked_by) = 0`);
      break;
    case 'stale':
      conditions.push(`state = 'active'`);
      conditions.push(`updated_at < datetime('now', ?)`);
      params.push(`-${staleDays} days`);
      break;
  }
}

function priorityEnergyOrder(): string {
  return `ORDER BY
    CASE priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC,
    CASE energy WHEN 'deep' THEN 3 WHEN 'shallow' THEN 2 WHEN 'admin' THEN 1 ELSE 0 END DESC`;
}

export function updateTaskState(
  db: Database.Database,
  id: string,
  newState: TaskState,
  reason?: string,
): Task {
  const task = getTask(db, id);
  if (!task) {
    throw new Error(`Task '${id}' not found.`);
  }

  validateTransition(task.state, newState);

  const now = new Date().toISOString();
  const historyEntry: { state: string; timestamp: string; reason?: string } = {
    state: newState,
    timestamp: now,
  };
  if (reason) historyEntry.reason = reason;

  const newHistory = JSON.stringify([...task.state_history, historyEntry]);

  const update = db.transaction(() => {
    db.prepare(
      `UPDATE tasks SET state = ?, updated_at = ?, state_history = ? WHERE id = ?`,
    ).run(newState, now, newHistory, id);
  });
  update();

  return getTask(db, id)!;
}

export interface EditableTaskFields {
  title?: string;
  priority?: Task['priority'];
  energy?: Task['energy'];
  effort?: Task['effort'];
  repo?: string | null;
  branch?: string | null;
}

export function updateTaskFields(
  db: Database.Database,
  id: string,
  fields: EditableTaskFields,
): Task {
  const task = getTask(db, id);
  if (!task) throw new Error(`Task '${id}' not found.`);

  const now = new Date().toISOString();
  const setClauses: string[] = ['updated_at = ?'];
  const params: (string | null)[] = [now];

  if (fields.title !== undefined) { setClauses.push('title = ?'); params.push(fields.title); }
  if (fields.priority !== undefined) { setClauses.push('priority = ?'); params.push(fields.priority); }
  if ('energy' in fields) { setClauses.push('energy = ?'); params.push(fields.energy ?? null); }
  if ('effort' in fields) { setClauses.push('effort = ?'); params.push(fields.effort ?? null); }
  if ('repo' in fields) { setClauses.push('repo = ?'); params.push(fields.repo ?? null); }
  if ('branch' in fields) { setClauses.push('branch = ?'); params.push(fields.branch ?? null); }

  params.push(id);

  db.transaction(() => {
    db.prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
  })();

  return getTask(db, id)!;
}

export function updateTaskDeps(
  db: Database.Database,
  id: string,
  blocks: string[],
  blockedBy: string[],
): void {
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE tasks SET blocks = ?, blocked_by = ?, updated_at = ? WHERE id = ?`).run(
      JSON.stringify(blocks),
      JSON.stringify(blockedBy),
      now,
      id,
    );
  })();
}

export function setTaskNote(db: Database.Database, taskId: string, noteId: string | null): void {
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE tasks SET note_id = ?, updated_at = ? WHERE id = ?`).run(noteId, now, taskId);
  })();
}
