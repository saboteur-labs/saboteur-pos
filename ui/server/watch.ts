import { EventEmitter } from 'events';
import { watch } from 'chokidar';
import type { FSWatcher } from 'chokidar';

export type ChangeType = 'tasks' | 'notes' | 'briefing';

export declare interface FileWatcher {
  on(event: 'change', listener: (type: ChangeType) => void): this;
  emit(event: 'change', type: ChangeType): boolean;
}

export class FileWatcher extends EventEmitter {
  private readonly watcher: FSWatcher;
  private readonly timers = new Map<ChangeType, ReturnType<typeof setTimeout>>();
  /** Resolves once chokidar has finished its initial scan and is actively watching. */
  readonly ready: Promise<void>;

  constructor(dbPath: string, notesDirPath: string) {
    super();

    this.watcher = watch([dbPath, notesDirPath], {
      ignoreInitial: true,
      // Allow the DB file, the notes dir itself, and .md files inside it.
      // Exclude WAL/SHM sidecars and non-.md files in the notes dir.
      ignored: (p: string) => {
        if (p === dbPath) return false;
        if (p === notesDirPath) return false;
        if (p.startsWith(notesDirPath + '/')) return !p.endsWith('.md');
        return true;
      },
    });

    this.ready = new Promise((resolve) => this.watcher.once('ready', resolve));

    this.watcher.on('all', (_event: string, filePath: string) => {
      if (filePath === dbPath) {
        this.debounce('tasks');
        this.debounce('briefing');
      } else if (filePath.endsWith('.md')) {
        this.debounce('notes');
        this.debounce('briefing');
      }
    });
  }

  private debounce(type: ChangeType): void {
    const existing = this.timers.get(type);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(type);
      this.emit('change', type);
    }, 250);
    this.timers.set(type, timer);
  }

  close(): Promise<void> {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    return this.watcher.close();
  }
}
