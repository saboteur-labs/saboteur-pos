import { existsSync, readdirSync, statSync } from 'fs';
import { basename, join } from 'path';

export type RepoKind = 'working' | 'bare' | 'broken';

export interface DiscoveredRepo {
  path: string;
  name: string;
  kind: RepoKind;
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
