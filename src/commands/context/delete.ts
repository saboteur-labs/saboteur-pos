import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../../config.js';
import { getDb } from '../../db/index.js';
import { deleteContext } from '../../db/contexts.js';

interface DeleteOptions {
  reassign?: string;
  force?: boolean;
  config?: string;
}

export function runContextDelete(slug: string, options: DeleteOptions): void {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  try {
    const { taskCount, noteCount } = deleteContext(db, slug, {
      reassign: options.reassign,
      force: options.force,
    });
    db.close();

    if (options.reassign) {
      process.stdout.write(
        `Migrated ${taskCount} task${taskCount === 1 ? '' : 's'} and ${noteCount} note${noteCount === 1 ? '' : 's'} to ${options.reassign}. Deleted ${slug}.\n`,
      );
    } else {
      process.stdout.write(
        `Orphaned ${taskCount} task${taskCount === 1 ? '' : 's'} and ${noteCount} note${noteCount === 1 ? '' : 's'} to inbox. Deleted ${slug}.\n`,
      );
    }
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    db.close();
    process.exit(1);
  }
}
