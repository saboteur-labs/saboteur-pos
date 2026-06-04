import { existsSync, readdirSync, statSync } from 'fs';
import { basename, dirname, join } from 'path';

export type RepoKind = 'working' | 'bare' | 'broken' | 'collision';

export interface DiscoveredRepo {
  path: string;
  name: string;
  kind: RepoKind;
}

export interface CollisionInfo {
  name: string;
  dirs: string[];
}

export interface DiscoverAllResult {
  repos: DiscoveredRepo[];
  collisions: CollisionInfo[];
}

export function discoverRepos(reposDir: string): DiscoveredRepo[] {
  if (!existsSync(reposDir)) return [];

  const entries = readdirSync(reposDir, { withFileTypes: true });
  const repos: DiscoveredRepo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(reposDir, entry.name);
    const kind = classifyRepo(path);
    if (kind === null) continue;
    repos.push({ path, name: basename(path), kind });
  }

  return repos;
}

/**
 * Discover repos across multiple roots and union the results. Working repos
 * whose basename appears in more than one root are excluded (re-marked
 * `collision`) so an ambiguous basename never enters the index; each is
 * reported in `collisions`. Single-root input matches `discoverRepos`.
 */
export function discoverAllRepos(roots: string[]): DiscoverAllResult {
  const seenPaths = new Set<string>();
  const all: DiscoveredRepo[] = [];
  for (const root of roots) {
    for (const repo of discoverRepos(root)) {
      if (seenPaths.has(repo.path)) continue;
      seenPaths.add(repo.path);
      all.push(repo);
    }
  }

  // Group working repos by basename; ≥2 across roots is a collision.
  const workingByName = new Map<string, DiscoveredRepo[]>();
  for (const repo of all) {
    if (repo.kind !== 'working') continue;
    const list = workingByName.get(repo.name) ?? [];
    list.push(repo);
    workingByName.set(repo.name, list);
  }

  const collidingNames = new Set<string>();
  const collisions: CollisionInfo[] = [];
  for (const [name, list] of workingByName) {
    if (list.length < 2) continue;
    collidingNames.add(name);
    collisions.push({ name, dirs: list.map((r) => dirname(r.path)) });
  }

  const repos = all.map((repo) =>
    repo.kind === 'working' && collidingNames.has(repo.name)
      ? { ...repo, kind: 'collision' as const }
      : repo,
  );

  return { repos, collisions };
}

export function collisionWarning(collisions: CollisionInfo[]): string {
  return collisions
    .map(
      (c) =>
        `Warning: repo basename '${c.name}' exists in ${c.dirs.length} directories ` +
        `(${c.dirs.join(', ')}); both are excluded. Rename one to disambiguate.`,
    )
    .join('\n');
}

function classifyRepo(dir: string): RepoKind | null {
  const dotGit = join(dir, '.git');
  if (existsSync(dotGit)) {
    try {
      const s = statSync(dotGit);
      if (s.isDirectory()) {
        const hasHead = existsSync(join(dotGit, 'HEAD'));
        const hasObjects = existsSync(join(dotGit, 'objects'));
        const hasRefs = existsSync(join(dotGit, 'refs'));
        if (hasHead && hasObjects && hasRefs) return 'working';
        return 'broken';
      }
      return 'broken';
    } catch {
      return 'broken';
    }
  }

  const hasHead = existsSync(join(dir, 'HEAD'));
  const hasObjects = existsSync(join(dir, 'objects'));
  const hasRefs = existsSync(join(dir, 'refs'));
  if (hasHead && hasObjects && hasRefs) return 'bare';
  if (hasHead || hasObjects || hasRefs) return 'broken';

  return null;
}
