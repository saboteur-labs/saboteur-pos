import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../../config.js';
import { getDb } from '../../db/index.js';
import { createTask } from '../../db/tasks.js';
import type { Task } from '../../db/tasks.js';

interface AddOptions {
  context?: string;
  priority?: Task['priority'];
  energy?: Task['energy'];
  effort?: Task['effort'];
  repo?: string;
  config?: string;
}

export function runTaskAdd(title: string, options: AddOptions): void {
  if (!title || !title.trim()) {
    process.stderr.write('Title is required.\n');
    process.exit(1);
  }

  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  const contextId = options.context ?? config.active_context;

  // Validate context exists
  const ctx = db.prepare(`SELECT id FROM contexts WHERE id = ?`).get(contextId);
  if (!ctx) {
    process.stderr.write(
      `Context '${contextId}' does not exist. Run 'sab context list' to see available contexts.\n`,
    );
    db.close();
    process.exit(1);
  }

  const task = createTask(db, {
    title: title.trim(),
    context_id: contextId,
    priority: options.priority,
    energy: options.energy ?? null,
    effort: options.effort ?? null,
    repo: options.repo ?? null,
  });

  db.close();
  process.stdout.write(`Created task ${task.id}: "${task.title}"\n`);
}
