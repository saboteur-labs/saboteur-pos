import { execSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

export interface TestEnv {
  configPath: string;
  dbPath: string;
  notesPath: string;
  cleanup: () => void;
}

export function createTestEnv(): TestEnv {
  const id = randomBytes(4).toString('hex');
  const root = join(tmpdir(), `sab-test-${id}`);
  const dbPath = join(root, 'saboteur.db');
  const notesPath = join(root, 'notes');
  const configPath = join(root, 'saboteur.config.json');
  const secretsPath = join(root, 'saboteur.secrets.json');

  mkdirSync(root, { recursive: true });

  // Write a config that points to local paths (no ~ expansion needed)
  const config = {
    version: '1',
    db_path: dbPath,
    secrets_path: secretsPath,
    repos_dir: root,
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

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  mkdirSync(notesPath, { recursive: true });

  // Run sab init --config to set up DB + seed data
  sab(`init --config ${configPath}`, root);

  return {
    configPath,
    dbPath,
    notesPath,
    cleanup: () => {
      try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

const TSX = join(process.cwd(), 'node_modules/.bin/tsx');
const SAB = `${TSX} ${join(process.cwd(), 'src/index.ts')}`;

export function sab(
  args: string,
  cwd = process.cwd(),
): { stdout: string; stderr: string; code: number } {
  try {
    const result = execSync(`${SAB} ${args}`, {
      encoding: 'utf-8',
      cwd,
      env: { ...process.env, EDITOR: 'true' }, // 'true' exits 0 without doing anything
    });
    return { stdout: result, stderr: '', code: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      code: err.status ?? 1,
    };
  }
}

export function sabConfig(args: string, env: TestEnv): ReturnType<typeof sab> {
  return sab(`${args} --config ${env.configPath}`);
}
