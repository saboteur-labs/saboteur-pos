import { getConfiguredDefaultBranch, type Config } from '../config.js';

export interface BranchRefs {
  /** Branch name `refs/remotes/origin/HEAD` points at, or null when unset. */
  originHeadTarget: string | null;
  localBranches: string[];
}

export type DefaultBranchResult =
  | { kind: 'resolved'; branch: string; warning: string | null }
  | { kind: 'unresolved'; reason: 'no-default-branch'; warning: string | null };

const CONVENTIONAL_NAMES = ['main', 'master', 'development', 'develop'];

/**
 * Resolve a repo's default branch from local refs only (FR-4): configured
 * branch, then origin/HEAD, then the first conventional name present. Every
 * candidate must exist as a local branch, since the Landed log reads it.
 * Pure — the caller reads the refs and prints any warning.
 */
export function resolveDefaultBranch(
  repoName: string,
  config: Config,
  refs: BranchRefs,
): DefaultBranchResult {
  const local = new Set(refs.localBranches);
  let warning: string | null = null;

  const configured = getConfiguredDefaultBranch(config, repoName);
  if (configured !== null) {
    if (local.has(configured)) return { kind: 'resolved', branch: configured, warning };
    warning = `repos.${repoName}.default_branch "${configured}" does not exist locally; falling back.`;
  }

  if (refs.originHeadTarget !== null && local.has(refs.originHeadTarget)) {
    return { kind: 'resolved', branch: refs.originHeadTarget, warning };
  }

  const conventional = CONVENTIONAL_NAMES.find((name) => local.has(name));
  if (conventional) return { kind: 'resolved', branch: conventional, warning };

  return { kind: 'unresolved', reason: 'no-default-branch', warning };
}
