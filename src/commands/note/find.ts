import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../../config.js';
import { getDb } from '../../db/index.js';
import { listKnowledgeEntries } from '../../db/knowledge.js';
import { incrementalSync } from '../../sync.js';
import { formatDate } from '../../utils.js';

interface NoteFindOptions {
  tag?: string;
  task?: string;
  context?: string;
  all?: boolean;
  config?: string;
}

export function runNoteFind(options: NoteFindOptions): void {
  if (!options.tag && !options.task) {
    process.stderr.write('Specify at least --tag <tag> or --task <id>.\n');
    process.exit(1);
  }

  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  incrementalSync(db, config);

  const contextId = options.all ? undefined : (options.context ?? config.active_context);

  const entries = listKnowledgeEntries(db, {
    context_id: contextId,
    tag: options.tag,
    task_id: options.task,
  });

  db.close();

  if (entries.length === 0) {
    process.stdout.write('No notes found.\n');
    return;
  }

  const header = `${'ID'.padEnd(14)} ${'TITLE'.padEnd(30)} UPDATED`;
  process.stdout.write(header + '\n');
  process.stdout.write('-'.repeat(header.length) + '\n');
  for (const entry of entries) {
    process.stdout.write(
      `${(entry.id ?? '-').padEnd(14)} ${(entry.title ?? '-').slice(0, 30).padEnd(30)} ${formatDate(entry.updated_at)}\n`,
    );
  }
}
