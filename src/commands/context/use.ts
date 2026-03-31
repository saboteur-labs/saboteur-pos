import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath, saveConfig } from '../../config.js';
import { getDb } from '../../db/index.js';
import { getContext } from '../../db/contexts.js';
import { c } from '../../colors.js';

export function runContextUse(slug: string, options: { config?: string }): void {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  const ctx = getContext(db, slug);
  db.close();

  if (!ctx) {
    process.stderr.write(
      c.red(`Context '${slug}' does not exist. Run 'sab context list' to see available contexts.\n`),
    );
    process.exit(1);
  }

  config.active_context = slug;
  saveConfig(config, configPath);
  process.stdout.write(`Active context: ${c.cyan(slug)}\n`);
}
