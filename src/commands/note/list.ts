import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../../config.js';
import { getDb } from '../../db/index.js';
import { listKnowledgeEntries } from '../../db/knowledge.js';
import { incrementalSync } from '../../sync.js';
import { formatDate } from '../../utils.js';
import { c } from '../../colors.js';

interface NoteListOptions {
  view?: string;
  context?: string;
  all?: boolean;
  config?: string;
}

export function runNoteList(options: NoteListOptions): void {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  // Auto incremental sync before query
  incrementalSync(db, config);

  const contextId = options.all ? undefined : (options.context ?? config.active_context);

  const entries = listKnowledgeEntries(db, {
    context_id: contextId,
    view: options.view,
  });

  db.close();

  if (entries.length === 0) {
    process.stdout.write('No notes found.\n');
    return;
  }

  const headerText = `${'ID'.padEnd(14)} ${'TITLE'.padEnd(30)} ${'TAGS'.padEnd(20)} ${'TASK'.padEnd(14)} UPDATED`;
  process.stdout.write(c.label(headerText) + '\n');
  process.stdout.write(c.border('-'.repeat(headerText.length)) + '\n');

  for (const entry of entries) {
    const tags = entry.tags.join(', ') || '-';
    process.stdout.write(
      `${c.muted((entry.id ?? '-').padEnd(14))} ` +
        `${(entry.title ?? '-').slice(0, 30).padEnd(30)} ` +
        `${c.muted(tags.slice(0, 20).padEnd(20))} ` +
        `${c.muted((entry.task_id ?? '-').padEnd(14))} ` +
        `${c.muted(formatDate(entry.updated_at))}\n`,
    );
  }
}
