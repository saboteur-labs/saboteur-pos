import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../config.js';
import { getDb } from '../db/index.js';
import { fullSync } from '../sync.js';

export function runSync(options: { config?: string }): void {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  const count = fullSync(db, config);
  const sourceCount = (
    db.prepare(`SELECT COUNT(*) as c FROM sources WHERE enabled = 1`).get() as { c: number }
  ).c;

  db.close();
  process.stdout.write(`Synced ${count} entr${count === 1 ? 'y' : 'ies'} from ${sourceCount} source${sourceCount === 1 ? '' : 's'}.\n`);
}
