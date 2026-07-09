import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../config.js';
import { getDb } from '../db/index.js';
import { c } from '../colors.js';
import { askSequence } from '../prompt.js';
import { getTask, type Task } from '../db/tasks.js';
import type { CommitRow } from '../db/commits.js';
import { commitsForTasks, doneSince } from './checkin/recap.js';
import { createCheckinNote } from './checkin/writeCheckinNote.js';

export interface RetroOptions {
  scope?: string;
  task?: string;
  context?: string;
  date?: string;
  all?: boolean;
  config?: string;
}

const VALID_SCOPES = ['project', 'feature', 'daily'] as const;
type Scope = (typeof VALID_SCOPES)[number];

interface Question {
  key: string;
  text: string;
}

const FULL_QUESTIONS: Question[] = [
  { key: 'expected', text: 'What did you expect going in?' },
  { key: 'actual', text: 'What actually happened?' },
  { key: 'effort_vs_estimate', text: 'How did actual effort compare to your estimate?' },
  { key: 'went_well', text: 'What went well that you want to repeat?' },
  { key: 'surprised', text: 'What surprised you?' },
  { key: 'slowed_down', text: 'What slowed you down more than once?' },
  { key: 'differently', text: 'What would you do differently?' },
  { key: 'unsure_decision', text: 'What decision are you unsure about?' },
  { key: 'lesson', text: "What's the one lesson to carry forward?" },
  { key: 'next_step', text: "What's the concrete next step or follow-up?" },
];

const DAILY_QUESTIONS: Question[] = [
  { key: 'actual', text: 'What actually happened?' },
  { key: 'surprised', text: 'What surprised you?' },
  { key: 'next_step', text: "What's the concrete next step or follow-up?" },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function renderTasksAndCommits(lines: string[], tasks: Task[], commits: CommitRow[]): void {
  const commitsByTask = new Map<string, CommitRow[]>();
  for (const commit of commits) {
    if (!commit.task_id) continue;
    const list = commitsByTask.get(commit.task_id) ?? [];
    list.push(commit);
    commitsByTask.set(commit.task_id, list);
  }

  if (tasks.length === 0) {
    lines.push(c.muted('    (none)'));
    return;
  }
  for (const t of tasks) {
    lines.push(`    ${c.muted(t.id)}  ${t.title} ${c.muted(`[${t.state}]`)}`);
    for (const cm of commitsByTask.get(t.id) ?? []) {
      const short = cm.sha.slice(0, 7);
      const firstLine = cm.message.split('\n')[0];
      lines.push(`      ${c.muted(short)}  ${firstLine}`);
    }
  }
}

export async function runRetro(options: RetroOptions): Promise<void> {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  if (options.all) {
    process.stderr.write(
      c.red(
        '--all is not meaningful for sab retro — it always writes to a single context. Use --context <slug> instead.\n',
      ),
    );
    db.close();
    process.exit(1);
  }

  if (options.scope === undefined || !VALID_SCOPES.includes(options.scope as Scope)) {
    process.stderr.write(
      c.red(
        `--scope is required and must be one of: ${VALID_SCOPES.join(', ')}.\n`,
      ),
    );
    db.close();
    process.exit(1);
  }
  const scope = options.scope as Scope;

  function resolveContext(): string {
    const contextId = options.context ?? config.active_context;
    const ctx = db.prepare(`SELECT id FROM contexts WHERE id = ?`).get(contextId);
    if (!ctx) {
      process.stderr.write(c.red(`Context '${contextId}' does not exist.\n`));
      db.close();
      process.exit(1);
    }
    return contextId;
  }

  let scopeRef: string;
  let contextId: string;
  let featureTask: Task | null = null;

  if (scope === 'feature') {
    if (!options.task) {
      process.stderr.write(c.red('--task <id> is required for --scope feature.\n'));
      db.close();
      process.exit(1);
    }
    featureTask = getTask(db, options.task);
    if (!featureTask) {
      process.stderr.write(c.red(`Task '${options.task}' not found.\n`));
      db.close();
      process.exit(1);
    }
    scopeRef = options.task;
    contextId = resolveContext();
  } else if (scope === 'project') {
    contextId = resolveContext();
    scopeRef = contextId;
  } else {
    // daily
    if (options.date !== undefined && !DATE_RE.test(options.date)) {
      process.stderr.write(c.red(`Invalid --date '${options.date}'. Expected format: YYYY-MM-DD.\n`));
      db.close();
      process.exit(1);
    }
    scopeRef = options.date ?? new Date().toISOString().slice(0, 10);
    contextId = resolveContext();
  }

  // ── Recap (read-only) ────────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push(c.label(`── Retro recap: ${scope} ──────────────────`));

  if (scope === 'feature') {
    const task = featureTask!;
    lines.push(c.label('  Task:'));
    lines.push(`    ${c.muted(task.id)}  ${task.title} ${c.muted(`[${task.state}]`)}`);
    const commits = commitsForTasks(db, config, [task.id]);
    lines.push(c.label('  Commits:'));
    if (commits.length === 0) {
      lines.push(c.muted('    (none)'));
    } else {
      for (const cm of commits) {
        const short = cm.sha.slice(0, 7);
        const firstLine = cm.message.split('\n')[0];
        lines.push(`    ${c.muted(short)}  ${firstLine}`);
      }
    }
  } else if (scope === 'project') {
    const cutoffIso = new Date(
      Date.now() - config.retro!.project_window_days * 24 * 60 * 60 * 1000,
    ).toISOString();
    const shipped = doneSince(db, contextId, cutoffIso);
    const commits = commitsForTasks(db, config, shipped.map((t) => t.id));
    lines.push(c.label(`  Shipped (last ${config.retro!.project_window_days}d):`));
    renderTasksAndCommits(lines, shipped, commits);
  } else {
    // daily
    const dayStart = `${scopeRef}T00:00:00.000Z`;
    const dayEnd = `${scopeRef}T23:59:59.999Z`;
    const candidates = doneSince(db, contextId, dayStart);
    const shipped = candidates.filter((task) =>
      task.state_history.some(
        (entry) => entry.state === 'done' && entry.timestamp >= dayStart && entry.timestamp <= dayEnd,
      ),
    );
    const commits = commitsForTasks(db, config, shipped.map((t) => t.id));
    lines.push(c.label(`  Shipped (${scopeRef}):`));
    renderTasksAndCommits(lines, shipped, commits);
  }
  lines.push('');

  process.stdout.write(lines.join('\n') + '\n');

  // ── Scope-aware Q&A ────────────────────────────────────────────────────────
  const questions = scope === 'daily' ? DAILY_QUESTIONS : FULL_QUESTIONS;
  const answers = await askSequence(questions);

  const body = questions
    .map((q) => `## ${q.text}\n\n${answers[q.key] || '(no answer given)'}\n`)
    .join('\n');

  const today = new Date().toISOString().slice(0, 10);
  const title = `Retro — ${scope} — ${scopeRef} — ${today}`;

  const result = createCheckinNote(db, config, {
    title,
    tags: ['retro'],
    extraFrontmatter: { scope, scope_ref: scopeRef },
    body,
    contextId,
  });

  db.close();
  process.stdout.write(c.green(`Created ${result.id}: "${title}" → ${result.path}\n`));
}
