import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath, resolveSlotFromTime } from '../config.js';
import { getDb } from '../db/index.js';
import { c } from '../colors.js';
import { askSequence } from '../prompt.js';
import { blockedInScope, commitsForTasks, doneSince, mostRecentStandup } from './checkin/recap.js';
import { createCheckinNote } from './checkin/writeCheckinNote.js';

export interface StandupOptions {
  context?: string;
  all?: boolean;
  slot?: string;
  config?: string;
}

const VALID_SLOTS = ['pre-work', 'wd-1', 'wd-2', 'wd-3', 'post-work'] as const;
type Slot = (typeof VALID_SLOTS)[number];

interface Question {
  key: string;
  text: string;
}

const SLOT_QUESTIONS: Record<Slot, Question[]> = {
  'pre-work': [
    { key: 'working_on', text: 'What are you working on today?' },
    { key: 'must_get_done', text: "What's the one thing that must get done today?" },
    { key: 'focused_time', text: 'How much focused time do you realistically have today?' },
    { key: 'energy', text: "What's your energy/focus like right now?" },
    { key: 'blockers', text: 'Are there any blockers to clear?' },
  ],
  'wd-1': [
    { key: 'must_get_done', text: "What's the one thing that must get done today?" },
    { key: 'blockers', text: 'Are there any blockers to clear?' },
  ],
  'wd-2': [
    { key: 'must_get_done', text: "What's the one thing that must get done today?" },
    { key: 'blockers', text: 'Are there any blockers to clear?' },
  ],
  'wd-3': [
    { key: 'must_get_done', text: "What's the one thing that must get done today?" },
    { key: 'blockers', text: 'Are there any blockers to clear?' },
  ],
  'post-work': [
    { key: 'did_you_do_it', text: 'Did you do what you set out to do last session?' },
    { key: 'challenges', text: 'What challenges did you face yesterday (or on your last work session)?' },
    { key: 'carrying_over', text: "What's carrying over unfinished?" },
    { key: 'blockers', text: 'Are there any blockers to clear?' },
  ],
};

// Question headers we look for in a prior standup's rendered body when
// surfacing reconciliation context (FR7).
const RECONCILIATION_HEADERS = [
  'What are you working on today?',
  "What's the one thing that must get done today?",
];

function findPriorAnswers(body: string): string[] {
  const sections = body.split(/^## /m).slice(1);
  const found: string[] = [];
  for (const section of sections) {
    const newlineIdx = section.indexOf('\n');
    if (newlineIdx === -1) continue;
    const header = section.slice(0, newlineIdx).trim();
    if (RECONCILIATION_HEADERS.includes(header)) {
      const answer = section.slice(newlineIdx + 1).trim();
      found.push(`${header}\n  ${answer || '(no answer given)'}`);
    }
  }
  return found;
}

export async function runStandup(options: StandupOptions): Promise<void> {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  if (options.all) {
    process.stderr.write(
      c.red(
        '--all is not meaningful for sab standup — it always writes to a single context. Use --context <slug> instead.\n',
      ),
    );
    db.close();
    process.exit(1);
  }

  const contextId = options.context ?? config.active_context;
  const ctx = db.prepare(`SELECT id FROM contexts WHERE id = ?`).get(contextId);
  if (!ctx) {
    process.stderr.write(c.red(`Context '${contextId}' does not exist.\n`));
    db.close();
    process.exit(1);
  }

  let resolvedSlot: Slot;
  if (options.slot !== undefined) {
    if (!VALID_SLOTS.includes(options.slot as Slot)) {
      process.stderr.write(
        c.red(`Invalid slot '${options.slot}'. Valid slots: ${VALID_SLOTS.join(', ')}.\n`),
      );
      db.close();
      process.exit(1);
    }
    resolvedSlot = options.slot as Slot;
  } else {
    try {
      resolvedSlot = resolveSlotFromTime(config.standup!.slot_windows, new Date()) as Slot;
    } catch (err) {
      process.stderr.write(c.red(`${(err as Error).message}\n`));
      db.close();
      process.exit(1);
    }
  }

  // ── Recap (read-only) ────────────────────────────────────────────────────
  const prior = mostRecentStandup(db, contextId);
  const cutoffIso =
    prior !== null
      ? String(prior.frontmatter.created_at)
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const shipped = doneSince(db, contextId, cutoffIso);
  const commits = commitsForTasks(db, config, shipped.map((t) => t.id));
  const blocked = blockedInScope(db, contextId);

  const commitsByTask = new Map<string, typeof commits>();
  for (const commit of commits) {
    if (!commit.task_id) continue;
    const list = commitsByTask.get(commit.task_id) ?? [];
    list.push(commit);
    commitsByTask.set(commit.task_id, list);
  }

  const lines: string[] = [];
  lines.push(c.label('── Since last session ──────────────────'));
  lines.push(c.label('  Shipped:'));
  if (shipped.length === 0) {
    lines.push(c.muted('    (none)'));
  } else {
    for (const t of shipped) {
      lines.push(`    ${c.muted(t.id)}  ${t.title}`);
      for (const cm of commitsByTask.get(t.id) ?? []) {
        const short = cm.sha.slice(0, 7);
        const firstLine = cm.message.split('\n')[0];
        lines.push(`      ${c.muted(short)}  ${firstLine}`);
      }
    }
  }
  lines.push(c.label('  Blocked:'));
  if (blocked.length === 0) {
    lines.push(c.muted('    (none)'));
  } else {
    for (const { task, blockerTitles } of blocked) {
      lines.push(`    ${c.muted(task.id)}  ${c.amber(task.title)}`);
      lines.push(`      ${c.muted('Blocked by:')} ${c.muted(blockerTitles.join(', '))}`);
    }
  }

  if (prior !== null) {
    const priorAnswers = findPriorAnswers(prior.body);
    lines.push(c.label('  From your last standup:'));
    if (priorAnswers.length === 0) {
      lines.push(c.muted('    (no matching answers found in prior standup)'));
    } else {
      for (const answer of priorAnswers) {
        lines.push(`    ${answer.replace(/\n/g, '\n    ')}`);
      }
    }
  } else {
    lines.push(c.muted('  (no prior standup found in this scope)'));
  }
  lines.push('');

  process.stdout.write(lines.join('\n') + '\n');

  // ── Slot-aware Q&A ────────────────────────────────────────────────────────
  const questions = SLOT_QUESTIONS[resolvedSlot];
  const answers = await askSequence(questions);

  const body = questions
    .map((q) => `## ${q.text}\n\n${answers[q.key] || '(no answer given)'}\n`)
    .join('\n');

  const today = new Date().toISOString().slice(0, 10);
  const title = `Standup — ${resolvedSlot} — ${today}`;

  const result = createCheckinNote(db, config, {
    title,
    tags: ['standup'],
    extraFrontmatter: { slot: resolvedSlot },
    body,
    contextId,
  });

  db.close();
  process.stdout.write(c.green(`Created ${result.id}: "${title}" → ${result.path}\n`));
}
