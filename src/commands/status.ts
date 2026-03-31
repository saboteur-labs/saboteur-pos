import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../config.js';
import { getDb } from '../db/index.js';
import { c, stateColor } from '../colors.js';

export function runStatus(options: { config?: string }): void {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const dbPath = resolvePath(config.db_path);
  const notesPath = config.sources[0]?.path ?? '(none)';

  const db = getDb(dbPath);

  const stateCounts = db
    .prepare(
      `SELECT state, COUNT(*) as count FROM tasks GROUP BY state`,
    )
    .all() as Array<{ state: string; count: number }>;

  const knowledgeCount = (
    db.prepare(`SELECT COUNT(*) as count FROM knowledge_index`).get() as { count: number }
  ).count;

  const sourceCount = (
    db.prepare(`SELECT COUNT(*) as count FROM sources`).get() as { count: number }
  ).count;

  db.close();

  const stateMap: Record<string, number> = {};
  for (const row of stateCounts) {
    stateMap[row.state] = row.count;
  }
  const total = Object.values(stateMap).reduce((a, b) => a + b, 0);

  process.stdout.write(`${c.label('Config:  ')} ${c.muted(configPath)}\n`);
  process.stdout.write(`${c.label('DB:      ')} ${c.muted(dbPath)}\n`);
  process.stdout.write(`${c.label('Notes:   ')} ${c.muted(resolvePath(notesPath))}\n`);
  process.stdout.write(`${c.label('Context: ')} ${c.cyan(config.active_context)}\n`);
  process.stdout.write(`\n${c.label(`Tasks (${total} total):`)}\n`);
  for (const state of ['backlog', 'active', 'blocked', 'review', 'done']) {
    process.stdout.write(`  ${stateColor(state, state.padEnd(8))} ${stateMap[state] ?? 0}\n`);
  }
  process.stdout.write(`\n${c.label('Knowledge index:')} ${knowledgeCount} entries\n`);
  process.stdout.write(`${c.label('Sources:        ')} ${sourceCount} registered\n`);
}
