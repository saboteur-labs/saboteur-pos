import { DEFAULT_CONFIG_PATH, getReposDirs, loadConfig, resolvePath } from '../../config.js';
import { getDb } from '../../db/index.js';
import { getContext, repoNames } from '../../db/contexts.js';
import { collisionWarning, discoverAllRepos } from '../../git/discover.js';
import { getHeadState } from '../../git/read.js';
import { c } from '../../colors.js';

interface GitListOptions {
  context?: string;
  config?: string;
}

export function runGitList(options: GitListOptions): void {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));
  const activeContext = options.context ?? config.active_context;
  const ctx = getContext(db, activeContext);
  db.close();

  const roots = getReposDirs(config);
  const { repos: discovered, collisions } = discoverAllRepos(roots);

  if (collisions.length > 0) {
    process.stderr.write(collisionWarning(collisions) + '\n');
  }

  if (discovered.length === 0) {
    process.stdout.write(c.muted(`No repos found under ${roots.join(', ')}.\n`));
    return;
  }

  const working = discovered.filter((r) => r.kind === 'working');
  const skipped = discovered.filter((r) => r.kind !== 'working');
  const scoped = ctx && ctx.repos.length > 0 ? new Set(repoNames(ctx)) : null;

  if (scoped) {
    process.stdout.write(c.muted(`Active context: ${activeContext}  (* = in context)\n\n`));
  } else {
    process.stdout.write(
      c.muted(`Active context: ${activeContext}  (no repo scope set; all repos visible)\n\n`),
    );
  }

  if (working.length > 0) {
    const maxName = Math.max(...working.map((r) => r.name.length));
    for (const repo of working) {
      const head = getHeadState(repo.path);
      const branchLabel = head.kind === 'branch' ? head.name : `detached @ ${head.sha}`;
      const marker = scoped && scoped.has(repo.name) ? c.amber('*') : ' ';
      process.stdout.write(
        `${marker} ${c.cyan(repo.name.padEnd(maxName))}  ${branchLabel}\n`,
      );
    }
  } else {
    process.stdout.write(c.muted('  (no working repos)\n'));
  }

  if (skipped.length > 0) {
    process.stdout.write('\n' + c.muted('Skipped:\n'));
    const maxSkipName = Math.max(...skipped.map((s) => s.name.length));
    for (const s of skipped) {
      const reason =
        s.kind === 'bare' ? 'bare' : s.kind === 'collision' ? 'name-collision' : 'read-error';
      process.stdout.write(c.muted(`  ${s.name.padEnd(maxSkipName)}  (${reason})\n`));
    }
  }
}
