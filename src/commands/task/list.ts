import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../../config.js';
import { getDb } from '../../db/index.js';
import { listTasks, type Task } from '../../db/tasks.js';
import { daysSince } from '../../utils.js';
import { c, stateColor, priorityBadge, energyBadge, doneRow } from '../../colors.js';

interface ListOptions {
  view?: string;
  context?: string;
  all?: boolean;
  config?: string;
}

const PRIORITY_LABELS: Record<string, string> = {
  critical: 'crit',
  high: 'high',
  normal: 'norm',
  low: 'low ',
};

export function runTaskList(options: ListOptions): void {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  const contextId = options.all ? undefined : (options.context ?? config.active_context);

  const tasks = listTasks(db, {
    context_id: contextId,
    view: options.view,
    stale_task_days: config.briefing.stale_task_days,
  });

  db.close();

  if (tasks.length === 0) {
    process.stdout.write('No tasks found.\n');
    return;
  }

  const headerText = `${'ID'.padEnd(12)} ${'STATE'.padEnd(8)} ${'PRI'.padEnd(5)} ${'ENERGY'.padEnd(8)} TITLE`;
  process.stdout.write(c.label(headerText) + '\n');
  process.stdout.write(c.border('-'.repeat(headerText.length)) + '\n');

  for (const task of tasks) {
    const days = daysSince(task.updated_at);
    const daysLabel = `(${days}d)`;
    const energy = task.energy ?? '-';
    const priLabel = PRIORITY_LABELS[task.priority] ?? task.priority;

    if (task.state === 'done') {
      const plain =
        `${task.id.padEnd(12)} ` +
        `${task.state.padEnd(8)} ` +
        `${priLabel.padEnd(5)} ` +
        `${energy.padEnd(8)} ` +
        `${task.title} ${daysLabel}`;
      process.stdout.write(doneRow(plain) + '\n');
    } else {
      const line =
        `${stateColor(task.state, task.id.padEnd(12))} ` +
        `${stateColor(task.state, task.state.padEnd(8))} ` +
        `${priorityBadge(task.priority, priLabel.padEnd(5))} ` +
        `${energyBadge(task.energy, energy.padEnd(8))} ` +
        `${stateColor(task.state, task.title)} ${c.muted(daysLabel)}`;
      process.stdout.write(line + '\n');
    }
  }
}
