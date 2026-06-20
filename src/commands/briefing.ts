import { DEFAULT_CONFIG_PATH, getReposDirs, loadConfig, resolvePath } from '../config.js';
import { getDb } from '../db/index.js';
import { listTasks, getTask } from '../db/tasks.js';
import { getContext, repoNames } from '../db/contexts.js';
import { incrementalSync } from '../sync.js';
import { daysSince } from '../utils.js';
import { c, priorityBadge, energyBadge } from '../colors.js';
import { collisionWarning, discoverAllRepos, type CollisionInfo } from '../git/discover.js';
import { indexCommits } from '../git/index-job.js';
import {
  GitTimeoutError,
  getBranchLastActivity,
  getHeadState,
  isDirty,
  listBranches,
  withGitTimeout,
} from '../git/read.js';

const BRIEFING_GIT_TIMEOUT_MS = 500;

interface BriefingOptions {
  context?: string;
  config?: string;
  weekly?: boolean;
  all?: boolean;
}

const PRIORITY_ORDER = ['critical', 'high', 'normal', 'low'];
const ENERGY_ORDER = ['deep', 'shallow', 'admin'];

export function runBriefing(options: BriefingOptions): void {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  if (options.weekly) {
    runWeeklyBriefing(db, config, options);
    return;
  }

  // Auto incremental sync before querying notes
  incrementalSync(db, config);

  // Refresh git → task commit links before rendering repo state.
  const indexResult = indexCommits(db, config);

  const activeContext = options.context ?? config.active_context;
  const staleDays = config.briefing.stale_task_days;

  // ── Section 1: Inbox ─────────────────────────────────────────────────────
  const inboxTaskCount = (
    db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE context_id = 'inbox'`).get() as { c: number }
  ).c;
  const inboxNoteCount = (
    db
      .prepare(`SELECT COUNT(*) as c FROM knowledge_index WHERE context_id = 'inbox'`)
      .get() as { c: number }
  ).c;

  // ── Section 3/4: Active + Stale tasks ────────────────────────────────────
  const allActiveTasks = listTasks(db, {
    context_id: activeContext,
    view: 'active',
    stale_task_days: staleDays,
  });

  const staleThreshold = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString();
  const staleTasks = allActiveTasks.filter((t) => t.updated_at < staleThreshold);
  const staleIds = new Set(staleTasks.map((t) => t.id));
  const activeTasks = allActiveTasks.filter((t) => !staleIds.has(t.id));

  // Sort active tasks: priority desc, energy desc
  activeTasks.sort((a, b) => {
    const pa = PRIORITY_ORDER.indexOf(a.priority);
    const pb = PRIORITY_ORDER.indexOf(b.priority);
    if (pa !== pb) return pa - pb;
    const ea = a.energy ? ENERGY_ORDER.indexOf(a.energy) : ENERGY_ORDER.length;
    const eb = b.energy ? ENERGY_ORDER.indexOf(b.energy) : ENERGY_ORDER.length;
    return ea - eb;
  });

  // ── Section 5: Blocked tasks ──────────────────────────────────────────────
  const blockedTasks = listTasks(db, { context_id: activeContext, state: 'blocked' });

  // ── Section 6: In Review ──────────────────────────────────────────────────
  const reviewTasks = listTasks(db, { context_id: activeContext, state: 'review' });

  // ── Section 7: Yesterday's notes ─────────────────────────────────────────
  const yesterdayNotes = db
    .prepare(
      `SELECT ki.id, ki.title, ki.type, ki.task_id, t.title as task_title
       FROM knowledge_index ki
       LEFT JOIN tasks t ON ki.task_id = t.id
       WHERE ki.updated_at >= datetime('now', '-1 day')
         AND ki.context_id = ?`,
    )
    .all(activeContext) as Array<{
    id: string;
    title: string | null;
    type: string;
    task_id: string | null;
    task_title: string | null;
  }>;

  // Get context display name before closing DB
  const ctxRow = db.prepare(`SELECT name FROM contexts WHERE id = ?`).get(activeContext) as
    | { name: string }
    | undefined;
  const contextName = ctxRow?.name ?? activeContext;

  // Resolve blocker titles before closing the DB
  const blockerTitlesById = new Map<string, string[]>();
  for (const t of blockedTasks) {
    if (t.blocked_by.length === 0) continue;
    blockerTitlesById.set(
      t.id,
      t.blocked_by.map((id) => getTask(db, id)?.title ?? id),
    );
  }

  // Collect repo state before closing DB
  const repoState = collectRepoState(
    db,
    config,
    activeContext,
    indexResult.timedOut,
    options.all ?? false,
  );

  db.close();

  // Repos with a basename that collides across roots are excluded; warn on stderr.
  if (repoState.collisions.length > 0) {
    process.stderr.write(collisionWarning(repoState.collisions) + '\n');
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  const lines: string[] = [];

  // Section 1: Inbox (omit if both = 0)
  if (inboxTaskCount > 0 || inboxNoteCount > 0) {
    lines.push(c.label(`── Inbox ─────────────────────────────────────`));
    lines.push(`${inboxTaskCount} unsorted task${inboxTaskCount === 1 ? '' : 's'}, ${inboxNoteCount} unsorted note${inboxNoteCount === 1 ? '' : 's'}`);
    lines.push('');
  }

  // Section 2: Active Context (never omit)
  lines.push(c.label(`── Active Context: `) + c.cyan(activeContext) + c.label(` (${contextName}) ──────────────────`));
  lines.push('');

  // Section 3: Active Tasks
  lines.push(c.label(`── Active Tasks ──────────────────────────────`));
  if (activeTasks.length === 0) {
    lines.push('  (none)');
  } else {
    for (const t of activeTasks) {
      const days = daysSince(t.updated_at);
      const pri = priorityBadge(t.priority, t.priority);
      const energy = energyBadge(t.energy, t.energy ?? '-');
      const effort = t.effort ?? '-';
      lines.push(`  ${c.muted(t.id)}  ${t.title}`);
      lines.push(`    ${pri} / ${energy} / ${effort}  ${c.muted(`(${days}d in state)`)}`);
    }
  }
  lines.push('');

  // Section 4: Stale Tasks (omit if empty)
  if (staleTasks.length > 0) {
    lines.push(c.label(`── Stale Tasks ───────────────────────────────`));
    for (const t of staleTasks) {
      const days = daysSince(t.updated_at);
      lines.push(c.amber(`  ${t.id}  ${t.title}  (${days}d since last change)`));
    }
    lines.push('');
  }

  // Section 5: Blocked Tasks (omit if empty)
  if (blockedTasks.length > 0) {
    lines.push(c.label(`── Blocked Tasks ─────────────────────────────`));
    for (const t of blockedTasks) {
      lines.push(`  ${c.muted(t.id)}  ${c.amber(t.title)}`);
      const blockerTitles = blockerTitlesById.get(t.id);
      if (blockerTitles && blockerTitles.length > 0) {
        lines.push(`    ${c.muted('Blocked by:')} ${c.muted(blockerTitles.join(', '))}`);
      }
    }
    lines.push('');
  }

  // Section 6: In Review (omit if empty)
  if (reviewTasks.length > 0) {
    lines.push(c.label(`── In Review ─────────────────────────────────`));
    for (const t of reviewTasks) {
      const days = daysSince(t.updated_at);
      lines.push(`  ${c.muted(t.id)}  ${c.violet(t.title)}  ${c.muted(`(${days}d)`)}`);
    }
    lines.push('');
  }

  // Section 7: Yesterday's Notes (omit if empty)
  if (yesterdayNotes.length > 0) {
    lines.push(c.label(`── Yesterday's Notes ─────────────────────────`));
    for (const n of yesterdayNotes) {
      const taskSuffix = n.task_title ? `  → ${c.cyan(n.task_title)}` : '';
      lines.push(`  ${c.muted(n.id)}  ${n.title ?? '(untitled)'}${taskSuffix}`);
    }
    lines.push('');
  }

  // Section 8: Repo State (omit if no tracked repos for this context)
  const repoStateLines = renderRepoState(repoState, activeContext);
  if (repoStateLines.length > 0) {
    lines.push(c.label(`── Repo State ────────────────────────────────`));
    lines.push(...repoStateLines);
    lines.push('');
  }

  // Empty state check (all optional sections empty, only Section 2 has content)
  const hasOptionalContent =
    activeTasks.length > 0 ||
    staleTasks.length > 0 ||
    blockedTasks.length > 0 ||
    reviewTasks.length > 0 ||
    yesterdayNotes.length > 0 ||
    inboxTaskCount > 0 ||
    inboxNoteCount > 0 ||
    repoStateLines.length > 0;

  if (!hasOptionalContent) {
    lines.push(c.muted(`Nothing active in ${activeContext}. Check your inbox or backlog.`));
  }

  process.stdout.write(lines.join('\n') + '\n');
}

interface RepoStateEntry {
  name: string;
  headLabel: string;
  dirty: boolean;
  commits: Array<{ sha: string; message: string; author_ts: string; task_title: string | null }>;
}

interface StaleBranch {
  repo: string;
  branch: string;
  daysSinceCommit: number;
}

interface SkippedRepo {
  name: string;
  reason: 'bare' | 'read-error' | 'timeout' | 'name-collision';
}

function collectRepoState(
  db: ReturnType<typeof getDb>,
  config: ReturnType<typeof loadConfig>,
  activeContext: string,
  timedOutFromIndex: string[] = [],
  bypassScope = false,
): {
  repos: RepoStateEntry[];
  staleBranches: StaleBranch[];
  skipped: SkippedRepo[];
  showLinkHint: boolean;
  collisions: CollisionInfo[];
} {
  const { repos: allDiscovered, collisions } = discoverAllRepos(getReposDirs(config));
  const skipped: SkippedRepo[] = allDiscovered
    .filter((r) => r.kind !== 'working')
    .map((r) => ({
      name: r.name,
      reason:
        r.kind === 'bare' ? 'bare' : r.kind === 'collision' ? 'name-collision' : 'read-error',
    }));
  const timedOutSet = new Set(timedOutFromIndex);
  const discovered = allDiscovered.filter((r) => r.kind === 'working');

  // Repos are opt-in per context: only repos in the context's `repos` array
  // are shown. An empty scope shows none — and, when there are repos that
  // could be linked, a hint guiding the user to link them. `--all`
  // (bypassScope) ignores the scope entirely and shows every working repo.
  const ctx = getContext(db, activeContext);
  const scope = ctx ? repoNames(ctx) : [];
  const showLinkHint = !bypassScope && scope.length === 0 && discovered.length > 0;
  const allowed = new Set(scope);
  const filtered = bypassScope ? discovered : discovered.filter((r) => allowed.has(r.name));
  if (
    filtered.length === 0 &&
    skipped.length === 0 &&
    timedOutSet.size === 0 &&
    !showLinkHint
  ) {
    return { repos: [], staleBranches: [], skipped: [], showLinkHint, collisions };
  }

  // A commit surfaces under a context two ways: linked to a task in that
  // context (existing behavior), or — for a monorepo sub-context — path-
  // attributed to it even with no task link. LEFT JOIN so unlinked rows survive.
  const commitQuery = db.prepare(
    `SELECT c.sha, c.message, c.author_ts, t.title as task_title
       FROM commits c
       LEFT JOIN tasks t ON c.task_id = t.id
      WHERE c.repo = ?
        AND ( (c.task_id IS NOT NULL AND t.context_id = ?)
              OR c.sub_context = ? )
      ORDER BY c.author_ts DESC
      LIMIT 5`,
  );

  const staleThresholdMs = config.briefing.stale_branch_days * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const staleBranches: StaleBranch[] = [];

  const repos: RepoStateEntry[] = [];
  for (const repo of filtered) {
    if (timedOutSet.has(repo.name)) {
      skipped.push({ name: repo.name, reason: 'timeout' });
      continue;
    }
    try {
      withGitTimeout(BRIEFING_GIT_TIMEOUT_MS, () => {
        const head = getHeadState(repo.path);
        const headLabel = head.kind === 'branch' ? head.name : `detached @ ${head.sha}`;

        for (const branch of listBranches(repo.path)) {
          const lastActivity = getBranchLastActivity(repo.path, branch);
          if (!lastActivity) continue;
          const ageMs = now - new Date(lastActivity).getTime();
          if (ageMs > staleThresholdMs) {
            staleBranches.push({
              repo: repo.name,
              branch,
              daysSinceCommit: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
            });
          }
        }

        repos.push({
          name: repo.name,
          headLabel,
          dirty: isDirty(repo.path),
          commits: commitQuery.all(
            repo.name,
            activeContext,
            activeContext,
          ) as RepoStateEntry['commits'],
        });
      });
    } catch (err) {
      if (err instanceof GitTimeoutError) {
        skipped.push({ name: repo.name, reason: 'timeout' });
      } else {
        throw err;
      }
    }
  }

  return { repos, staleBranches, skipped, showLinkHint, collisions };
}

function renderRepoState(
  state: {
    repos: RepoStateEntry[];
    staleBranches: StaleBranch[];
    skipped: SkippedRepo[];
    showLinkHint: boolean;
  },
  activeContext: string,
): string[] {
  if (state.repos.length === 0 && state.skipped.length === 0 && !state.showLinkHint) return [];
  const lines: string[] = [];
  if (state.showLinkHint) {
    lines.push(c.muted(`  (no repos linked to '${activeContext}')`));
    lines.push(c.muted(`  Link with: sab context repos add ${activeContext} <repo>`));
  }
  for (const repo of state.repos) {
    const dirtyLabel = repo.dirty ? c.amber('✘ dirty') : c.muted('✓ clean');
    lines.push(`  ${c.cyan(repo.name)}  ${c.muted(`(${repo.headLabel})`)}  ${dirtyLabel}`);
    for (const cm of repo.commits) {
      const short = cm.sha.slice(0, 7);
      const firstLine = cm.message.split('\n')[0];
      const date = cm.author_ts.slice(0, 10);
      // No arrow for a path-attributed commit with no task link — that absence
      // is the "missed link" cue the briefing is meant to surface.
      const link = cm.task_title ? `  → ${c.cyan(cm.task_title)}` : '';
      lines.push(`    ${c.muted(short)}  ${firstLine}  ${c.muted(date)}${link}`);
    }
  }

  if (state.staleBranches.length > 0) {
    lines.push('');
    lines.push(`  ${c.label('Stale Branches')}`);
    for (const b of state.staleBranches) {
      lines.push(
        c.amber(`    ${b.repo}/${b.branch}  (${b.daysSinceCommit}d since last commit)`),
      );
    }
  }

  if (state.skipped.length > 0) {
    if (state.repos.length > 0 || state.staleBranches.length > 0) lines.push('');
    const summary = state.skipped
      .map((s) => `${s.name} (${s.reason})`)
      .join(', ');
    lines.push(
      c.muted(`  Skipped ${state.skipped.length} repo${state.skipped.length === 1 ? '' : 's'}: ${summary}`),
    );
  }

  return lines;
}

interface WeeklyTask {
  id: string;
  title: string;
  state: string;
  state_history: string;
}

function runWeeklyBriefing(
  db: ReturnType<typeof getDb>,
  config: ReturnType<typeof loadConfig>,
  options: BriefingOptions,
): void {
  // Refresh git data so commit counts are current
  indexCommits(db, config);

  const activeContext = options.context ?? config.active_context;
  const cutoffIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const rows = db
    .prepare(
      `SELECT id, title, state, state_history FROM tasks WHERE context_id = ?`,
    )
    .all(activeContext) as WeeklyTask[];

  const shipped: Array<{ id: string; title: string }> = [];
  const stalled: Array<{ id: string; title: string; state: string; daysIdle: number }> = [];
  const now = Date.now();

  for (const row of rows) {
    const hist = JSON.parse(row.state_history) as Array<{
      state: string;
      timestamp: string;
      reason?: string;
    }>;
    const shippedInWindow = hist.some(
      (e) => e.state === 'done' && e.timestamp >= cutoffIso,
    );
    if (shippedInWindow) {
      shipped.push({ id: row.id, title: row.title });
      continue;
    }
    if (row.state === 'active' || row.state === 'blocked') {
      const last = hist[hist.length - 1];
      if (last && last.timestamp < cutoffIso) {
        const ageDays = Math.floor((now - new Date(last.timestamp).getTime()) / (24 * 60 * 60 * 1000));
        stalled.push({ id: row.id, title: row.title, state: row.state, daysIdle: ageDays });
      }
    }
  }

  const repoActivity = db
    .prepare(
      `SELECT repo, COUNT(*) as count FROM commits
        WHERE author_ts >= ?
        GROUP BY repo
        ORDER BY count DESC, repo ASC`,
    )
    .all(cutoffIso) as Array<{ repo: string; count: number }>;

  db.close();

  const lines: string[] = [];
  lines.push(
    c.label('── Weekly Briefing — ') +
      c.cyan(activeContext) +
      c.label(' (last 7 days) ─────────'),
  );
  lines.push('');

  lines.push(c.label('Shipped'));
  if (shipped.length === 0) {
    lines.push(c.muted('  (none)'));
  } else {
    for (const t of shipped) {
      lines.push(`  ${c.muted(t.id)}  ${t.title}`);
    }
  }
  lines.push('');

  lines.push(c.label('Stalled'));
  if (stalled.length === 0) {
    lines.push(c.muted('  (none)'));
  } else {
    for (const t of stalled) {
      lines.push(
        c.amber(`  ${t.id}  ${t.title}  (${t.state}, ${t.daysIdle}d idle)`),
      );
    }
  }
  lines.push('');

  lines.push(c.label('Repo Activity'));
  if (repoActivity.length === 0) {
    lines.push(c.muted('  (no commits in window)'));
  } else {
    for (const r of repoActivity) {
      lines.push(`  ${c.cyan(r.repo.padEnd(20))}  ${r.count} commit${r.count === 1 ? '' : 's'}`);
    }
  }

  process.stdout.write(lines.join('\n') + '\n');
}
