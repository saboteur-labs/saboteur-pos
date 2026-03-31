import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../config.js';
import { getDb } from '../db/index.js';
import { listTasks } from '../db/tasks.js';
import { incrementalSync } from '../sync.js';
import { daysSince } from '../utils.js';
import { c, priorityBadge, energyBadge } from '../colors.js';

interface BriefingOptions {
  context?: string;
  config?: string;
}

const PRIORITY_ORDER = ['critical', 'high', 'normal', 'low'];
const ENERGY_ORDER = ['deep', 'shallow', 'admin'];

export function runBriefing(options: BriefingOptions): void {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  // Auto incremental sync before querying notes
  incrementalSync(db, config);

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

  db.close();

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
      if (t.blocked_by.length > 0) {
        lines.push(`    ${c.muted('Blocked by:')} ${c.muted(t.blocked_by.join(', '))}`);
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

  // Empty state check (all optional sections empty, only Section 2 has content)
  const hasOptionalContent =
    activeTasks.length > 0 ||
    staleTasks.length > 0 ||
    blockedTasks.length > 0 ||
    reviewTasks.length > 0 ||
    yesterdayNotes.length > 0 ||
    inboxTaskCount > 0 ||
    inboxNoteCount > 0;

  if (!hasOptionalContent) {
    lines.push(c.muted(`Nothing active in ${activeContext}. Check your inbox or backlog.`));
  }

  process.stdout.write(lines.join('\n') + '\n');
}
