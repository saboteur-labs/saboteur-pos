import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../../config.js';
import { getDb } from '../../db/index.js';
import { createContext, getContext } from '../../db/contexts.js';

interface NewContextOptions {
  name?: string;
  description?: string;
  config?: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export function runContextNew(slug: string, options: NewContextOptions): void {
  if (slug === 'inbox') {
    process.stderr.write("'inbox' is a reserved context name.\n");
    process.exit(1);
  }
  if (!SLUG_RE.test(slug)) {
    process.stderr.write('Slug must be lowercase alphanumeric with optional hyphens.\n');
    process.exit(1);
  }

  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  if (getContext(db, slug)) {
    process.stderr.write(`Context '${slug}' already exists.\n`);
    db.close();
    process.exit(1);
  }

  createContext(db, { slug, name: options.name, description: options.description });
  db.close();
  process.stdout.write(`Created context: ${slug}\n`);
}
