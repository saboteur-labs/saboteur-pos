import { DEFAULT_CONFIG_PATH, getReposDirs, loadConfig, resolvePath } from '../../config.js';
import { getDb } from '../../db/index.js';
import { addContextRepos, getContext, removeContextRepos } from '../../db/contexts.js';
import { discoverAllRepos } from '../../git/discover.js';
import { c } from '../../colors.js';

interface ReposOptions {
  config?: string;
}

export function runContextReposList(slug: string, options: ReposOptions): void {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));
  const ctx = getContext(db, slug);
  db.close();

  if (!ctx) {
    process.stderr.write(c.red(`Context '${slug}' does not exist.\n`));
    process.exit(1);
  }

  if (ctx.repos.length === 0) {
    process.stdout.write(c.muted('(no repos linked)\n'));
    return;
  }

  for (const repo of ctx.repos) {
    process.stdout.write(`${c.cyan(repo)}\n`);
  }
}

export function runContextReposAdd(slug: string, repos: string[], options: ReposOptions): void {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  const ctx = getContext(db, slug);
  if (!ctx) {
    process.stderr.write(c.red(`Context '${slug}' does not exist.\n`));
    db.close();
    process.exit(1);
  }

  // Validate every name against discovered working repos before any write.
  // Collision-excluded basenames are kind 'collision', not 'working', so an
  // ambiguous name is intentionally not linkable.
  const working = new Set(
    discoverAllRepos(getReposDirs(config))
      .repos.filter((r) => r.kind === 'working')
      .map((r) => r.name),
  );
  for (const repo of repos) {
    if (!working.has(repo)) {
      process.stderr.write(
        c.red(`'${repo}' not found under repos_dir. Run 'sab git list' to see available repos.\n`),
      );
      db.close();
      process.exit(1);
    }
  }

  addContextRepos(db, slug, repos);
  db.close();
  process.stdout.write(c.green(`Linked ${repos.join(', ')} to ${slug}.\n`));
}

export function runContextReposRemove(slug: string, repos: string[], options: ReposOptions): void {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  const ctx = getContext(db, slug);
  if (!ctx) {
    process.stderr.write(c.red(`Context '${slug}' does not exist.\n`));
    db.close();
    process.exit(1);
  }

  removeContextRepos(db, slug, repos);
  db.close();
  process.stdout.write(c.green(`Unlinked ${repos.join(', ')} from ${slug}.\n`));
}
