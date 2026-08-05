import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../config.js';
import { getDb } from '../db/index.js';
import { listContexts } from '../db/contexts.js';
import { c } from '../colors.js';
import { ask, closePrompt } from '../prompt.js';
import { KaizenTemplateError, loadKaizenTemplate } from '../kaizen/loader.js';
import { parse } from '../kaizen/parse.js';
import { validate } from '../kaizen/validate.js';
import { expand, type ContextRef } from '../kaizen/expand.js';
import { render } from '../kaizen/render.js';
import { previousIntentions } from './kaizen/intentions.js';
import { persistKaizen } from './kaizen/persist.js';
import { runQuestions } from './kaizen/run.js';
import { editKaizenTemplate } from './kaizen/templateEdit.js';

export interface KaizenOptions {
  context?: string;
  all?: boolean;
  weekOf?: string;
  template?: string;
  editTemplate?: boolean;
  config?: string;
}

/** Monday of the week containing `date`, in local time. */
export function mondayOf(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay(): 0 = Sunday, so Sunday belongs to the week that began six days ago.
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function runKaizen(options: KaizenOptions): Promise<void> {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);

  if (options.editTemplate) {
    editKaizenTemplate({ configPath, templatePath: options.template });
    return;
  }

  if (options.all) {
    process.stderr.write(
      c.red(
        '--all is not meaningful for sab kaizen — it always writes to a single context. ' +
          'Sections 3 and 5 already cover every context. Use --context <slug> instead.\n',
      ),
    );
    process.exit(1);
  }

  if (options.weekOf !== undefined && !ISO_DATE.test(options.weekOf)) {
    process.stderr.write(c.red(`--week-of must be a date as YYYY-MM-DD.\n`));
    process.exit(1);
  }

  const db = getDb(resolvePath(config.db_path));

  try {
    const contextId = options.context ?? config.active_context;
    if (!db.prepare(`SELECT id FROM contexts WHERE id = ?`).get(contextId)) {
      process.stderr.write(c.red(`Context '${contextId}' does not exist.\n`));
      db.close();
      process.exit(1);
    }

    // Load and check the whole template before asking anything: a review that
    // collects half its answers and then dies has wasted the user's time.
    const template = loadKaizenTemplate({ configPath, templatePath: options.template });
    const doc = parse(template.body);
    validate(doc);

    // Sections 3 and 5 enumerate every context, whichever one the note is filed
    // in — the review is cross-cutting by design.
    const contexts: ContextRef[] = listContexts(db).map((ctx) => ({
      slug: ctx.id,
      name: ctx.name,
    }));

    const weekOf = options.weekOf ?? mondayOf(new Date());
    const expanded = expand(doc, {
      contexts,
      previousIntentions: previousIntentions(db, contextId),
    });

    for (const warning of expanded.warnings) {
      process.stderr.write(c.amber(`Warning: ${warning}\n`));
    }

    process.stdout.write(
      `${c.label('Kaizen weekly review')} ${c.muted(`— week of ${weekOf}, filing to ${contextId}`)}\n`,
    );

    const startedAt = Date.now();
    const result = await runQuestions(expanded, {
      db,
      config,
      ask,
      cutoffIso: `${weekOf}T00:00:00.000Z`,
      // Asked last, so the measurement covers the review the user just did.
      deferFields: ['time_spent'],
      defaultFor: (id) => {
        if (id === 'week_of') return weekOf;
        if (id === 'time_spent') return elapsedSince(startedAt);
        return undefined;
      },
    });

    const body = render(expanded, { answers: result.answers, skips: result.skips });

    const note = persistKaizen(db, config, {
      contextId,
      weekOf: result.answers.week_of || weekOf,
      template,
      intentions: result.intentions,
      body,
    });

    process.stdout.write(
      `\n${c.green('Kaizen review saved.')}\n  ${c.muted(note.id)}\n  ${c.muted(note.path)}\n`,
    );
  } catch (err) {
    if (err instanceof KaizenTemplateError || err instanceof Error) {
      process.stderr.write(c.red(`${(err as Error).message}\n`));
      db.close();
      closePrompt();
      process.exit(1);
    }
    throw err;
  }

  db.close();
  closePrompt();
}

/** Elapsed wall-clock time, as a duration the `duration` field accepts. */
export function elapsedSince(startedAtMs: number, nowMs = Date.now()): string {
  const minutes = Math.max(1, Math.round((nowMs - startedAtMs) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h${rest}m`;
}
