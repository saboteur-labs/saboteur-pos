import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

export interface BriefingConfig {
  stale_task_days: number;
  stale_branch_days: number;
  provider_timeout_ms: number; // Phase 2c stub — not used in Phase 1
  landed_max_rows?: number; // per-repo row cap for the Landed section
  repo_state_max_commits?: number; // per-repo commit cap for Repo State
  week_start?: string; // first day of the Landed window's calendar week
}

export interface GitConfig {
  // Branch-name globs for agent-worktree branches, hidden unless requested.
  worktree_branch_patterns: string[];
}

export interface RepoConfig {
  default_branch?: string;
}

export interface SourceConfig {
  id: string;
  type: string;
  path: string;
  owner: string;
  enabled: boolean;
}

export interface StandupConfig {
  // Keys are slot names (`pre-work`, `wd-1`, `wd-2`, `wd-3`, `post-work`);
  // values are local-time range strings formatted as "HH:MM-HH:MM".
  slot_windows: Record<string, string>;
}

export interface RetroConfig {
  project_window_days: number;
}

export interface Config {
  version: string;
  db_path: string;
  secrets_path: string;
  repos_dir: string; // Phase 2a stub — not used in Phase 1
  repos_dirs?: string[]; // additional repo roots; unioned with repos_dir
  active_context: string;
  briefing: BriefingConfig;
  sources: SourceConfig[];
  standup?: StandupConfig;
  retro?: RetroConfig;
  git?: GitConfig;
  // Per-repo settings keyed by repo basename. Lives in config rather than on a
  // context because one repo can be linked to several contexts.
  repos?: Record<string, RepoConfig>;
}

const DEFAULT_STANDUP_CONFIG: StandupConfig = {
  slot_windows: {
    'pre-work': '00:00-09:00',
    'wd-1': '09:00-12:00',
    'wd-2': '12:00-15:00',
    'wd-3': '15:00-18:00',
    'post-work': '18:00-24:00',
  },
};

const DEFAULT_RETRO_CONFIG: RetroConfig = {
  project_window_days: 14,
};

const DEFAULT_LANDED_MAX_ROWS = 20;
const DEFAULT_REPO_STATE_MAX_COMMITS = 5;
const DEFAULT_WEEK_START = 'monday';
const DEFAULT_WORKTREE_BRANCH_PATTERNS = ['worktree-agent-*'];

export const DEFAULT_CONFIG_PATH = join(homedir(), 'saboteur', 'saboteur.config.json');

export function resolvePath(p: string): string {
  if (p.startsWith('~/')) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

/**
 * Resolve the effective list of repo roots: the tilde/absolute-expanded,
 * de-duplicated union of `repos_dir` (when present) and `repos_dirs`.
 * Nonexistent directories are NOT filtered here — discovery handles that.
 */
export function getReposDirs(config: Config): string[] {
  const raw = [config.repos_dir, ...(config.repos_dirs ?? [])].filter(
    (p): p is string => Boolean(p),
  );
  return [...new Set(raw.map(resolvePath))];
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
    const parsed = JSON.parse(raw) as Config;
    if (parsed.briefing && parsed.briefing.stale_branch_days === undefined) {
      parsed.briefing.stale_branch_days = 14;
    }
    if (parsed.standup === undefined) {
      parsed.standup = { ...DEFAULT_STANDUP_CONFIG, slot_windows: { ...DEFAULT_STANDUP_CONFIG.slot_windows } };
    } else if (parsed.standup.slot_windows === undefined) {
      parsed.standup.slot_windows = { ...DEFAULT_STANDUP_CONFIG.slot_windows };
    }
    if (parsed.retro === undefined) {
      parsed.retro = { ...DEFAULT_RETRO_CONFIG };
    }
    if (parsed.briefing) {
      parsed.briefing.landed_max_rows ??= DEFAULT_LANDED_MAX_ROWS;
      parsed.briefing.repo_state_max_commits ??= DEFAULT_REPO_STATE_MAX_COMMITS;
      parsed.briefing.week_start ??= DEFAULT_WEEK_START;
    }
    if (parsed.git === undefined) {
      parsed.git = { worktree_branch_patterns: [...DEFAULT_WORKTREE_BRANCH_PATTERNS] };
    } else if (parsed.git.worktree_branch_patterns === undefined) {
      parsed.git.worktree_branch_patterns = [...DEFAULT_WORKTREE_BRANCH_PATTERNS];
    }
    parsed.repos ??= {};
    return parsed;
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
      stale_branch_days: 14,
      provider_timeout_ms: 2000,
      landed_max_rows: DEFAULT_LANDED_MAX_ROWS,
      repo_state_max_commits: DEFAULT_REPO_STATE_MAX_COMMITS,
      week_start: DEFAULT_WEEK_START,
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
    standup: { ...DEFAULT_STANDUP_CONFIG, slot_windows: { ...DEFAULT_STANDUP_CONFIG.slot_windows } },
    retro: { ...DEFAULT_RETRO_CONFIG },
    git: { worktree_branch_patterns: [...DEFAULT_WORKTREE_BRANCH_PATTERNS] },
    repos: {},
  };
}

// Getters for the optional fields above. loadConfig back-fills them, but a
// Config built in code (tests, callers) may omit them, so read through these.
export function getLandedMaxRows(config: Config): number {
  return config.briefing.landed_max_rows ?? DEFAULT_LANDED_MAX_ROWS;
}

export function getRepoStateMaxCommits(config: Config): number {
  return config.briefing.repo_state_max_commits ?? DEFAULT_REPO_STATE_MAX_COMMITS;
}

export function getWeekStart(config: Config): string {
  return config.briefing.week_start ?? DEFAULT_WEEK_START;
}

export function getWorktreeBranchPatterns(config: Config): string[] {
  return config.git?.worktree_branch_patterns ?? DEFAULT_WORKTREE_BRANCH_PATTERNS;
}

export function getConfiguredDefaultBranch(config: Config, repoName: string): string | null {
  return config.repos?.[repoName]?.default_branch ?? null;
}

/**
 * Parse an "HH:MM" or "24:00" time string into minutes-since-midnight.
 */
function parseTimeToMinutes(time: string): number {
  const [hh, mm] = time.split(':').map(Number);
  return hh * 60 + mm;
}

/**
 * Resolve which standup slot the given date's local time-of-day falls into,
 * based on the configured `slot_windows` (each formatted "HH:MM-HH:MM").
 *
 * Windows are expected to be contiguous and non-overlapping across a single
 * day; a window ending in "24:00" is treated as inclusive of end-of-day
 * (i.e. any time up to but not including midnight matches it).
 *
 * If multiple windows match (misconfiguration), the first match in
 * `Object.entries(windows)` iteration order is returned. If no window
 * matches, an Error is thrown so the caller can surface a clear CLI message.
 */
export function resolveSlotFromTime(windows: Record<string, string>, date: Date): string {
  const nowMinutes = date.getHours() * 60 + date.getMinutes();
  for (const [slot, range] of Object.entries(windows)) {
    const [start, end] = range.split('-');
    const startMinutes = parseTimeToMinutes(start);
    const endMinutes = parseTimeToMinutes(end);
    if (startMinutes <= nowMinutes && nowMinutes < endMinutes) {
      return slot;
    }
  }
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  throw new Error(
    `No configured standup.slot_windows window contains the current time (${hh}:${mm}).`,
  );
}
