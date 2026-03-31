import type Database from 'better-sqlite3';
import { getTask, updateTaskDeps, updateTaskState } from './db/tasks.js';

export function linkBlocks(db: Database.Database, taskAId: string, taskBId: string): void {
  const taskA = getTask(db, taskAId);
  if (!taskA) throw new Error(`Task '${taskAId}' not found.`);
  const taskB = getTask(db, taskBId);
  if (!taskB) throw new Error(`Task '${taskBId}' not found.`);

  // Cycle detection: check if taskA is already reachable from taskB via blocks chain
  if (hasCycle(db, taskBId, taskAId)) {
    const path = getCyclePath(db, taskBId, taskAId);
    throw new Error(`Cannot create circular dependency: ${path}.`);
  }

  const newBlocksA = [...taskA.blocks.filter((id) => id !== taskBId), taskBId];
  const newBlockedByB = [...taskB.blocked_by.filter((id) => id !== taskAId), taskAId];

  db.transaction(() => {
    updateTaskDeps(db, taskAId, newBlocksA, taskA.blocked_by);
    updateTaskDeps(db, taskBId, taskB.blocks, newBlockedByB);
  })();
}

export function unblockDependents(db: Database.Database, doneTaskId: string): void {
  const doneTask = getTask(db, doneTaskId);
  if (!doneTask) return;

  for (const dependentId of doneTask.blocks) {
    const dependent = getTask(db, dependentId);
    if (!dependent) continue;

    const newBlockedBy = dependent.blocked_by.filter((id) => id !== doneTaskId);
    updateTaskDeps(db, dependentId, dependent.blocks, newBlockedBy);

    // Auto-unblock: if blocked_by is now empty and task is in 'blocked' state
    if (newBlockedBy.length === 0 && dependent.state === 'blocked') {
      updateTaskState(db, dependentId, 'active', `unblocked by ${doneTaskId}`);
    }
  }
}

function hasCycle(db: Database.Database, fromId: string, targetId: string): boolean {
  const visited = new Set<string>();
  const queue = [fromId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const task = getTask(db, current);
    if (task) {
      queue.push(...task.blocks);
    }
  }
  return false;
}

function getCyclePath(db: Database.Database, fromId: string, targetId: string): string {
  // BFS to find path from fromId → targetId
  const queue: string[][] = [[fromId]];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    if (current === targetId) return [...path, fromId].join(' → ');
    if (visited.has(current)) continue;
    visited.add(current);
    const task = getTask(db, current);
    if (task) {
      for (const next of task.blocks) {
        queue.push([...path, next]);
      }
    }
  }
  return `${fromId} → ... → ${targetId}`;
}
