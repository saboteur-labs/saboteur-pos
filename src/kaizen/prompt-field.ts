import { c } from '../colors.js';

/** Line-reader. Injected so the prompt logic is testable without a TTY. */
export type Ask = (question: string) => Promise<string>;

export interface FieldPrompt {
  id: string;
  type: string;
  /** Human-facing prompt text. Falls back to the id when a template gives none. */
  label?: string;
  required?: boolean;
  values?: string[];
  min?: number;
  max?: number;
  /** Offered when the user answers empty — already resolved to a concrete value. */
  defaultValue?: string;
}

export interface PromptOptions {
  ask: Ask;
  /** Where validation complaints go. Defaults to stderr. */
  write?: (text: string) => void;
  /**
   * Guard against an unbounded re-prompt loop. `ask()` returns '' when stdin is
   * exhausted, so a required field on piped input would otherwise spin forever.
   */
  maxAttempts?: number;
}

export class PromptAbortedError extends Error {}

const DEFAULT_MAX_ATTEMPTS = 10;

/**
 * Prompt for one field, re-prompting until the answer satisfies its declared
 * type. Returns the canonical form of the answer — an enum resolves to its
 * declared casing, a percent drops its `%`.
 *
 * An optional field accepts empty and returns '' (recorded as unanswered); a
 * required one re-prompts.
 */
export async function promptField(field: FieldPrompt, options: PromptOptions): Promise<string> {
  const write = options.write ?? ((t: string) => process.stderr.write(t));
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const raw =
      field.type === 'longtext'
        ? await readParagraph(options.ask, promptText(field))
        : await options.ask(promptText(field));

    const answer = raw.trim();

    if (answer === '') {
      if (field.defaultValue !== undefined) return field.defaultValue;
      if (!field.required) return '';
      write(c.red(`  ${field.label ?? field.id} is required.\n`));
      continue;
    }

    const result = coerce(field, answer);
    if (result.ok) return result.value;
    write(c.red(`  ${result.error}\n`));
  }

  throw new PromptAbortedError(
    `Gave up prompting for '${field.id}' after ${maxAttempts} invalid answers.`,
  );
}

function promptText(field: FieldPrompt): string {
  const label = field.label ?? field.id;
  const hint = hintFor(field);
  const suffix = field.defaultValue !== undefined ? ` [${field.defaultValue}]` : '';
  return `${label}${hint ? ` ${c.muted(hint)}` : ''}${suffix}: `;
}

function hintFor(field: FieldPrompt): string {
  switch (field.type) {
    case 'scale':
      return `(${field.min}–${field.max})`;
    case 'enum':
      return `(${(field.values ?? []).join(' / ')})`;
    case 'percent':
      return '(%)';
    case 'date':
      return '(YYYY-MM-DD)';
    case 'duration':
      return '(e.g. 45m, 1h30m)';
    case 'word':
      return '(one word)';
    case 'longtext':
      return '(blank line to finish)';
    default:
      return '';
  }
}

/**
 * Read a multi-line answer, terminated by a blank line.
 *
 * `longtext` fields are the reflective ones — the Kaizen question, the honest
 * note — where a single line would quietly shape what gets written.
 */
async function readParagraph(ask: Ask, prompt: string): Promise<string> {
  const lines: string[] = [];
  let line = await ask(prompt);
  while (line.trim() !== '') {
    lines.push(line);
    line = await ask('');
  }
  return lines.join('\n');
}

type Coerced = { ok: true; value: string } | { ok: false; error: string };

function coerce(field: FieldPrompt, answer: string): Coerced {
  switch (field.type) {
    case 'scale': {
      const n = Number(answer);
      if (!Number.isInteger(n)) return { ok: false, error: `Enter a whole number.` };
      const { min = 1, max = 5 } = field;
      if (n < min || n > max) return { ok: false, error: `Enter a number from ${min} to ${max}.` };
      return { ok: true, value: String(n) };
    }
    case 'word':
      if (/\s/.test(answer)) return { ok: false, error: 'Enter a single word.' };
      return { ok: true, value: answer };
    case 'enum': {
      const values = field.values ?? [];
      const match = values.find((v) => v.toLowerCase() === answer.toLowerCase());
      if (!match) return { ok: false, error: `Enter one of: ${values.join(', ')}.` };
      return { ok: true, value: match };
    }
    case 'percent': {
      const n = Number(answer.replace(/%$/, '').trim());
      if (!Number.isFinite(n)) return { ok: false, error: 'Enter a number.' };
      if (n < 0 || n > 100) return { ok: false, error: 'Enter a percentage from 0 to 100.' };
      return { ok: true, value: String(n) };
    }
    case 'date':
      if (!isCalendarDate(answer)) {
        return { ok: false, error: 'Enter a date as YYYY-MM-DD.' };
      }
      return { ok: true, value: answer };
    case 'duration':
      if (!/^(\d+h)?(\d+m)?$/.test(answer) || answer === '') {
        return { ok: false, error: 'Enter a duration like 45m, 1h, or 1h30m.' };
      }
      return { ok: true, value: answer };
    default:
      return { ok: true, value: answer };
  }
}

/**
 * Reject dates that are well-formed but not real (2026-02-30). `Date` would
 * happily roll those over into March, silently filing a review under a week
 * that never happened.
 */
function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
