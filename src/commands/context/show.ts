import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../../config.js';

export function runContextShow(options: { config?: string }): void {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  process.stdout.write(`${config.active_context}\n`);
}
