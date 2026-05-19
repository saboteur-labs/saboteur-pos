// ── Shared types (mirroring server-side shapes, no Node.js deps) ─────────────

export type TaskState = 'backlog' | 'active' | 'blocked' | 'review' | 'done';

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

export interface Note {
  id: string;
  source_id: string;
  type: string;
  title: string | null;
  tags: string[];
  task_id: string | null;
  context_id: string | null;
  path: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface NoteDetail extends Note {
  body: string;
}

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

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`API ${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

export function fetchBriefing(): Promise<BriefingData> {
  return apiFetch('/api/briefing');
}

export function fetchTasks(view?: string): Promise<Task[]> {
  const url = view ? `/api/tasks?view=${encodeURIComponent(view)}` : '/api/tasks';
  return apiFetch(url);
}

export function fetchNotes(): Promise<Note[]> {
  return apiFetch('/api/notes');
}

export function fetchNoteDetail(id: string): Promise<NoteDetail> {
  return apiFetch(`/api/notes/${encodeURIComponent(id)}`);
}
