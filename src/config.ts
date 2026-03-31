import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

export interface BriefingConfig {
  stale_task_days: number;
  provider_timeout_ms: number; // Phase 2c stub — not used in Phase 1
}

export interface SourceConfig {
  id: string;
  type: string;
  path: string;
  owner: string;
  enabled: boolean;
}

export interface Config {
  version: string;
  db_path: string;
  secrets_path: string;
  repos_dir: string; // Phase 2a stub — not used in Phase 1
  active_context: string;
  briefing: BriefingConfig;
  sources: SourceConfig[];
}

export const DEFAULT_CONFIG_PATH = join(homedir(), 'saboteur', 'saboteur.config.json');

export function resolvePath(p: string): string {
  if (p.startsWith('~/')) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

export function loadConfig(configPath?: string): Config {
  const path = resolvePath(configPath ?? DEFAULT_CONFIG_PATH);
  if (!existsSync(path)) {
    process.stderr.write(
      `Config not found at ${path}. Run 'sab init' to initialize a workspace.\n`,
    );
    process.exit(1);
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as Config;
  } catch {
    process.stderr.write(
      `Config at ${path} is malformed. Run 'sab init' to reinitialize.\n`,
    );
    process.exit(1);
  }
}

export function saveConfig(config: Config, configPath: string): void {
  const resolved = resolvePath(configPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function makeDefaultConfig(notesPath: string, dbPath: string, secretsPath: string): Config {
  return {
    version: '1',
    db_path: dbPath,
    secrets_path: secretsPath,
    repos_dir: '~/code',
    active_context: 'inbox',
    briefing: {
      stale_task_days: 3,
      provider_timeout_ms: 2000,
    },
    sources: [
      {
        id: 'personal-notes',
        type: 'note',
        path: notesPath,
        owner: 'core',
        enabled: true,
      },
    ],
  };
}
