import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../../config.js';
import { getDb } from '../../db/index.js';
import { deleteTask } from '../../db/tasks.js';
import { c } from '../../colors.js';

interface DeleteTaskOptions {
  force?: boolean;
  config?: string;
}

export function runTaskDelete(id: string, options: DeleteTaskOptions): void {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  try {
    const { title } = deleteTask(db, id, { force: options.force });
    db.close();
    process.stdout.write(`Deleted task: ${title}\n`);
  } catch (err) {
    process.stderr.write(c.red(`${(err as Error).message}\n`));
    db.close();
    process.exit(1);
  }
}
