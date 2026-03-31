import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../../config.js';
import { getDb } from '../../db/index.js';
import { getTask, updateTaskState } from '../../db/tasks.js';
import { unblockDependents } from '../../deps.js';
import type { TaskState } from '../../state-machine.js';
import { VALID_STATES } from '../../state-machine.js';
import { c, stateColor } from '../../colors.js';

export function runTaskMove(id: string, state: string, options: { config?: string }): void {
  if (!VALID_STATES.includes(state as TaskState)) {
    process.stderr.write(
      c.red(`Invalid state '${state}'. Valid states: ${VALID_STATES.join(', ')}.\n`),
    );
    process.exit(1);
  }

  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  const existing = getTask(db, id);
  if (!existing) {
    process.stderr.write(c.red(`Task '${id}' not found.\n`));
    db.close();
    process.exit(1);
  }

  try {
    const updated = updateTaskState(db, id, state as TaskState);

    // Auto-unblock dependents when task moves to done
    if (state === 'done') {
      unblockDependents(db, id);
    }

    db.close();
    process.stdout.write(`${c.muted(id)}: ${stateColor(existing.state, existing.state)} → ${stateColor(updated.state, updated.state)}\n`);
  } catch (err) {
    process.stderr.write(c.red(`${(err as Error).message}\n`));
    db.close();
    process.exit(1);
  }
}
