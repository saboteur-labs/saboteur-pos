import { create } from 'zustand';
import {
  fetchBriefing as apiFetchBriefing,
  fetchTasks as apiFetchTasks,
  fetchNotes as apiFetchNotes,
  type BriefingData,
  type Task,
  type Note,
} from './api';

// Views that map to a ?view= query param on /api/tasks.
export const TASK_VIEWS = new Set([
  'active', 'today', 'backlog', 'blocked', 'review', 'deep-work', 'stale',
]);

// Views that drive top-level section navigation.
export const NAV_VIEWS = new Set(['briefing', 'tasks', 'notes']);

export interface AppStore {
  briefing: BriefingData | null;
  tasks: Task[];
  notes: Note[];
  /** Current navigation + task-filter view. Default is 'briefing'. */
  selectedView: string;
  selectedNoteId: string | null;

  fetchBriefing(): Promise<void>;
  fetchTasks(view?: string): Promise<void>;
  fetchNotes(): Promise<void>;
  /** Switch view and, if it's a task view, immediately refetch tasks. */
  setSelectedView(view: string): void;
  setSelectedNoteId(id: string | null): void;
}

export const useStore = create<AppStore>((set, get) => ({
  briefing: null,
  tasks: [],
  notes: [],
  selectedView: 'briefing',
  selectedNoteId: null,

  async fetchBriefing() {
    const data = await apiFetchBriefing();
    set({ briefing: data });
  },

  async fetchTasks(view?: string) {
    const effective = view ?? (TASK_VIEWS.has(get().selectedView) ? get().selectedView : undefined);
    const data = await apiFetchTasks(effective);
    set({ tasks: data });
  },

  async fetchNotes() {
    const data = await apiFetchNotes();
    set({ notes: data });
  },

  setSelectedView(view: string) {
    set({ selectedView: view });
    if (TASK_VIEWS.has(view)) {
      get().fetchTasks(view).catch(() => {});
    }
  },

  setSelectedNoteId(id: string | null) {
    set({ selectedNoteId: id });
  },
}));
