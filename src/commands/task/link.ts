import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../../config.js';
import { getDb } from '../../db/index.js';
import { getTask, setTaskNote } from '../../db/tasks.js';
import { linkBlocks } from '../../deps.js';

interface LinkOptions {
  note?: string;
  blocks?: string;
  config?: string;
}

export function runTaskLink(id: string, options: LinkOptions): void {
  if (!options.note && !options.blocks) {
    process.stderr.write('Specify --note <note_id> or --blocks <task_id>.\n');
    process.exit(1);
  }

  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  const task = getTask(db, id);
  if (!task) {
    process.stderr.write(`Task '${id}' not found.\n`);
    db.close();
    process.exit(1);
  }

  if (options.note) {
    // Verify note exists in knowledge_index
    const note = db
      .prepare(`SELECT id, title FROM knowledge_index WHERE id = ?`)
      .get(options.note) as { id: string; title: string } | undefined;
    if (!note) {
      process.stderr.write(`Note '${options.note}' not found in knowledge index.\n`);
      db.close();
      process.exit(1);
    }

    // Bidirectional: set task.note_id and knowledge_index.task_id
    db.transaction(() => {
      setTaskNote(db, id, options.note!);
      db.prepare(`UPDATE knowledge_index SET task_id = ? WHERE id = ?`).run(id, options.note!);
    })();

    db.close();
    process.stdout.write(`Linked ${options.note} to ${id}.\n`);
    return;
  }

  if (options.blocks) {
    const targetTask = getTask(db, options.blocks);
    if (!targetTask) {
      process.stderr.write(`Task '${options.blocks}' not found.\n`);
      db.close();
      process.exit(1);
    }

    try {
      linkBlocks(db, id, options.blocks);
      db.close();
      process.stdout.write(`${id} now blocks ${options.blocks}.\n`);
    } catch (err) {
      process.stderr.write(`${(err as Error).message}\n`);
      db.close();
      process.exit(1);
    }
  }
}
