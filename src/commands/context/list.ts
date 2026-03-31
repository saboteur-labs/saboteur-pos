import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../../config.js';
import { getDb } from '../../db/index.js';
import { listContexts } from '../../db/contexts.js';

export function runContextList(options: { config?: string }): void {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));
  const contexts = listContexts(db);
  db.close();

  const header = `${'CONTEXT'.padEnd(20)} ${'TASKS'.padEnd(8)} NOTES`;
  process.stdout.write(header + '\n');
  process.stdout.write('-'.repeat(header.length) + '\n');

  for (const ctx of contexts) {
    const active = ctx.id === config.active_context ? ' *' : '';
    process.stdout.write(
      `${(ctx.id + active).padEnd(20)} ${String(ctx.task_count).padEnd(8)} ${ctx.note_count}\n`,
    );
  }
}
