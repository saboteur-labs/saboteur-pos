import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../../config.js';
import { getDb } from '../../db/index.js';
import { getTask } from '../../db/tasks.js';
import { daysSince, formatDate } from '../../utils.js';

export function runTaskView(id: string, options: { config?: string }): void {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  const task = getTask(db, id);
  if (!task) {
    process.stderr.write(`Task '${id}' not found.\n`);
    db.close();
    process.exit(1);
  }

  // Resolve linked note title if present
  let noteLine = '(none)';
  if (task.note_id) {
    const note = db
      .prepare(`SELECT id, title FROM knowledge_index WHERE id = ?`)
      .get(task.note_id) as { id: string; title: string } | undefined;
    noteLine = note ? `${note.id} — ${note.title}` : task.note_id;
  }

  // Resolve blocks/blocked_by titles
  function resolveTaskTitles(ids: string[]): string {
    if (ids.length === 0) return '(none)';
    return ids
      .map((tid) => {
        const t = db.prepare(`SELECT id, title FROM tasks WHERE id = ?`).get(tid) as
          | { id: string; title: string }
          | undefined;
        return t ? `${t.id} — ${t.title}` : tid;
      })
      .join('\n            ');
  }

  const blocksLine = resolveTaskTitles(task.blocks);
  const blockedByLine = resolveTaskTitles(task.blocked_by);

  db.close();

  const days = daysSince(task.updated_at);
  const hr = '─'.repeat(40);

  process.stdout.write(`${task.id} — ${task.title}\n`);
  process.stdout.write(`${hr}\n`);
  process.stdout.write(`State:    ${task.state} (${days} day${days === 1 ? '' : 's'})\n`);
  process.stdout.write(`Context:  ${task.context_id}\n`);
  process.stdout.write(`Priority: ${task.priority}\n`);
  process.stdout.write(`Energy:   ${task.energy ?? '-'}\n`);
  process.stdout.write(`Effort:   ${task.effort ?? '-'}\n`);
  process.stdout.write(`Repo:     ${task.repo ?? '-'}\n`);
  process.stdout.write(`Branch:   ${task.branch ?? '-'}\n`);
  process.stdout.write(`Note:     ${noteLine}\n`);
  process.stdout.write(`\n`);
  process.stdout.write(`Blocks:     ${blocksLine}\n`);
  process.stdout.write(`Blocked by: ${blockedByLine}\n`);
  process.stdout.write(`\n`);
  process.stdout.write(`State history:\n`);
  for (const entry of task.state_history) {
    const ts = formatDate(entry.timestamp) + ' ' + entry.timestamp.slice(11, 16);
    const reason = entry.reason ? `  (${entry.reason})` : '';
    process.stdout.write(`  ${entry.state.padEnd(10)} → ${ts}${reason}\n`);
  }
}
