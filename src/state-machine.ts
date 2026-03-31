export type TaskState = 'backlog' | 'active' | 'blocked' | 'review' | 'done';

// 'blocked' is reachable from any non-done state (LOGIC.md §2)
const TRANSITIONS: Record<TaskState, TaskState[]> = {
  backlog: ['active', 'blocked'],
  active: ['blocked', 'review', 'backlog'],
  blocked: ['active', 'blocked'],
  review: ['done', 'active', 'blocked'],
  done: [],
};

export function validateTransition(from: TaskState, to: TaskState): void {
  if (from === 'done') {
    throw new Error(`Cannot move task from 'done' to '${to}'. No transitions out of 'done'.`);
  }
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(
      `Cannot move task from '${from}' to '${to}'. Valid transitions: ${TRANSITIONS[from].join(', ') || 'none'}.`,
    );
  }
}

export const VALID_STATES: TaskState[] = ['backlog', 'active', 'blocked', 'review', 'done'];
