import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import {
  DEFAULT_CONFIG_PATH,
  loadConfig,
  makeDefaultConfig,
  resolvePath,
  saveConfig,
} from '../config.js';
import { getDb } from '../db/index.js';
import { seedKaizenTemplate } from '../kaizen/seed.js';
import { c } from '../colors.js';

function now(): string {
  return new Date().toISOString();
}

export function runInit(options: { config?: string }): void {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const configExists = existsSync(configPath);

  let config = configExists
    ? loadConfig(configPath)
    : makeDefaultConfig(
        join(homedir(), 'saboteur', 'notes'),
        join(homedir(), 'saboteur', 'saboteur.db'),
        join(homedir(), 'saboteur', 'saboteur.secrets.json'),
      );

  const dbPath = resolvePath(config.db_path);
  const notesPath = resolvePath(config.sources[0]?.path ?? join(homedir(), 'saboteur', 'notes'));
  const secretsPath = resolvePath(config.secrets_path);

  // Step 1: Create directories
  mkdirSync(dirname(dbPath), { recursive: true });
  mkdirSync(notesPath, { recursive: true });

  // Step 2: Create DB + run schema
  const db = getDb(dbPath);

  // Step 3: Seed inbox context
  db.prepare(
    `INSERT OR IGNORE INTO contexts (id, name, description, repos, created_at)
     VALUES ('inbox', 'Inbox', 'Default context for unsorted items', '[]', ?)`,
  ).run(now());

  // Step 4: Seed personal-notes source
  db.prepare(
    `INSERT OR IGNORE INTO sources (id, type, path, owner, context_id, enabled)
     VALUES ('personal-notes', 'note', ?, 'core', NULL, 1)`,
  ).run(notesPath);

  db.close();

  // Step 5: Write config if not present
  if (!configExists) {
    saveConfig(config, configPath);
  }

  // Step 6: Write empty secrets file if not present
  if (!existsSync(secretsPath)) {
    mkdirSync(dirname(secretsPath), { recursive: true });
    writeFileSync(secretsPath, JSON.stringify({ plugins: {} }, null, 2) + '\n', 'utf-8');
  }

  // Step 7: Add secrets file to .gitignore in workspace root
  ensureGitignore(secretsPath);

  // Step 8: Seed the Kaizen template (no-op when the user already has one —
  // this is also how workspaces created before the feature get backfilled)
  const kaizen = seedKaizenTemplate(configPath);

  // Step 9: Print confirmation
  process.stdout.write(
    c.green(`Initialized Saboteur workspace.\n`) +
      `  DB:     ${c.muted(dbPath)}\n` +
      `  Notes:  ${c.muted(notesPath)}\n` +
      `  Config: ${c.muted(configPath)}\n` +
      `  Kaizen: ${c.muted(kaizen.path)}${kaizen.seeded ? '' : c.muted(' (existing)')}\n`,
  );
}

function ensureGitignore(secretsPath: string): void {
  // Look for .gitignore in cwd, then home dir
  const candidates = [join(process.cwd(), '.gitignore'), join(homedir(), '.gitignore')];
  const gitignorePath = candidates[0];

  const entry = 'saboteur.secrets.json';
  if (existsSync(gitignorePath)) {
    const contents = readFileSync(gitignorePath, 'utf-8');
    if (!contents.includes(entry)) {
      writeFileSync(gitignorePath, contents + (contents.endsWith('\n') ? '' : '\n') + entry + '\n', 'utf-8');
    }
  } else {
    writeFileSync(gitignorePath, entry + '\n', 'utf-8');
  }
}
