import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../../config.js';
import { getDb } from '../../db/index.js';
import { listContexts } from '../../db/contexts.js';
import { c } from '../../colors.js';

export function runContextList(options: { config?: string }): void {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));
  const contexts = listContexts(db);
  db.close();

  const headerText = `${'CONTEXT'.padEnd(20)} ${'TASKS'.padEnd(8)} NOTES`;
  process.stdout.write(c.label(headerText) + '\n');
  process.stdout.write(c.border('-'.repeat(headerText.length)) + '\n');

  for (const ctx of contexts) {
    const isActive = ctx.id === config.active_context;
    const slug = isActive ? ctx.id + ' *' : ctx.id;
    const counts = `${String(ctx.task_count).padEnd(8)} ${ctx.note_count}`;
    if (isActive) {
      process.stdout.write(`${c.cyan(slug.padEnd(20))} ${c.muted(counts)}\n`);
    } else {
      process.stdout.write(`${slug.padEnd(20)} ${c.muted(counts)}\n`);
    }
  }
}
