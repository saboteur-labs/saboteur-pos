import type Database from 'better-sqlite3';
import { c } from '../../colors.js';
import type { Config } from '../../config.js';
import type {
  ExpandedDocument,
  ExpandedNode,
  ExpandedRepeatNode,
  ExpandedTableNode,
  RepeatItem,
} from '../../kaizen/expand.js';
import { itemAnswerKey } from '../../kaizen/expand.js';
import type { FieldNode, FollowupNode, ListNode } from '../../kaizen/parse.js';
import { promptField, type Ask, type PromptOptions } from '../../kaizen/prompt-field.js';
import { evaluateWhen, parseWhen } from '../../kaizen/when.js';
import { collectContextRecap, formatContextRecap, parseRecapRequest } from './recap.js';
import { promptTable } from './sections.js';

/**
 * Walks an expanded template and asks its questions in order.
 *
 * The template drives everything — which questions exist, in what order, of what
 * type, and under what condition. Nothing about the seven Kaizen sections is
 * hardcoded here.
 */

export interface RunOptions extends PromptOptions {
  db: Database.Database;
  config: Config;
  /** Start of the period under review, for recap cutoffs. */
  cutoffIso: string;
  print?: (text: string) => void;
  /**
   * Resolves a field's default at the moment it is asked. A function rather than
   * a map because some defaults (elapsed time) are only meaningful once the run
   * has actually run.
   */
  defaultFor?: (fieldId: string) => string | undefined;
  /**
   * Preamble fields to ask after every section instead of in place.
   *
   * "Time spent on this review" sits second in the template but can only be
   * measured once the review is over; asking it there would offer a default of
   * zero. It still *renders* in its template position — this changes when it is
   * asked, not where it appears.
   */
  deferFields?: string[];
  /**
   * Answers already supplied on the command line, by field id.
   *
   * These are recorded and *not* prompted. A value stated as a flag has been
   * stated; re-asking it only creates the chance to type something that
   * silently contradicts it.
   */
  presetAnswers?: Record<string, string>;
}

export interface RunResult {
  answers: Record<string, string>;
  skips: Record<string, string>;
  warnings: string[];
  /** Section 6's answers, in order, for the carry-forward frontmatter. */
  intentions: string[];
}

export async function runQuestions(
  doc: ExpandedDocument,
  options: RunOptions,
): Promise<RunResult> {
  const print = options.print ?? ((t: string) => process.stdout.write(t));
  const result: RunResult = { answers: {}, skips: {}, warnings: [], intentions: [] };
  const opts = { ...options, print };

  const deferred = new Set(options.deferFields ?? []);
  const isDeferred = (node: ExpandedNode) =>
    (node.kind === 'field' || node.kind === 'followup') && deferred.has(node.id);

  await askNodes(doc.preamble.filter((n) => !isDeferred(n)), (id) => id, doc, result, opts);

  for (const section of doc.sections) {
    if (section.title) print(`\n${c.label(`── ${section.title} ──`)}\n\n`);
    await askNodes(section.children, (id) => id, doc, result, opts);
  }

  await askNodes(doc.preamble.filter(isDeferred), (id) => id, doc, result, opts);

  return result;
}

type KeyResolver = (fieldId: string) => string;

async function askNodes(
  nodes: ExpandedNode[],
  keyOf: KeyResolver,
  doc: ExpandedDocument,
  result: RunResult,
  options: RunOptions & { print: (t: string) => void },
): Promise<void> {
  for (const node of nodes) {
    switch (node.kind) {
      case 'field':
      case 'followup':
        await askField(node, keyOf, result, options);
        break;
      case 'list':
        await askList(node, keyOf, result, options);
        break;
      case 'expanded-table':
        await askTable(node, result, options);
        break;
      case 'expanded-repeat':
        await askRepeat(node, doc, result, options);
        break;
      case 'prose':
        break;
    }
  }
}

async function askField(
  node: FieldNode | FollowupNode,
  keyOf: KeyResolver,
  result: RunResult,
  options: RunOptions & { print: (t: string) => void },
): Promise<void> {
  const key = keyOf(node.id);

  // A conditional prompt is only asked when its condition holds against what has
  // already been answered; otherwise it is left unasked, not blank-answered.
  if (node.when && !evaluateWhen(parseWhen(node.when), (field) => result.answers[keyOf(field)])) {
    return;
  }

  // Keyed on the bare id but only honoured where the key *is* the bare id, so a
  // preset can never leak into a repeat item that happens to reuse the id.
  const preset = key === node.id ? options.presetAnswers?.[node.id] : undefined;
  if (preset !== undefined) {
    result.answers[key] = preset;
    options.print(`${c.muted(`  ${labelFor(node)}: ${preset} (from flag)`)}\n`);
    return;
  }

  const attrs = node.directive.attrs;
  result.answers[key] = await promptField(
    {
      id: key,
      type: node.type,
      label: labelFor(node),
      required: node.required,
      values: attrs.values?.split('|'),
      min: attrs.min === undefined ? undefined : Number(attrs.min),
      max: attrs.max === undefined ? undefined : Number(attrs.max),
      defaultValue: options.defaultFor?.(node.id),
    },
    options,
  );
}

/**
 * A prompt label.
 *
 * The template's prose is the real question, printed in the rendered note; this
 * is only what appears at the terminal, so it falls back to the field id rather
 * than trying to extract a question from surrounding markdown.
 */
function labelFor(node: FieldNode | FollowupNode): string {
  return node.directive.attrs.label ?? node.id.replace(/_/g, ' ');
}

async function askList(
  node: ListNode,
  keyOf: KeyResolver,
  result: RunResult,
  options: RunOptions & { print: (t: string) => void },
): Promise<void> {
  const max = node.max ?? 3;
  const min = node.min ?? 0;

  for (let i = 0; i < max; i++) {
    const entry = await promptField(
      {
        id: `${node.id}.${i}`,
        type: node.type,
        label: `  ${i + 1}`,
        required: i < min,
      },
      options,
    );
    result.answers[keyOf(`${node.id}.${i}`)] = entry;
    // Stop at the first blank past the minimum: three slots are a ceiling, not a
    // quota, and the template is explicit that fewer is better.
    if (entry.trim() === '') break;
    result.intentions.push(entry);
  }
}

async function askTable(
  node: ExpandedTableNode,
  result: RunResult,
  options: RunOptions & { print: (t: string) => void },
): Promise<void> {
  const { answers, warnings } = await promptTable(node, options);
  Object.assign(result.answers, answers);
  result.warnings.push(...warnings);
  for (const warning of warnings) options.print(c.amber(`  ${warning}\n`));
}

async function askRepeat(
  repeat: ExpandedRepeatNode,
  doc: ExpandedDocument,
  result: RunResult,
  options: RunOptions & { print: (t: string) => void },
): Promise<void> {
  const request = parseRecapRequest(repeat.recap);

  for (const item of repeat.items) {
    options.print('\n');
    if (repeat.recap.length > 0) {
      const recap = collectContextRecap(
        options.db,
        options.config,
        item.key,
        options.cutoffIso,
        request,
      );
      options.print(formatContextRecap(item.label, recap));
    }

    if (repeat.skippable && (await askedToSkip(item, repeat, result, options))) continue;

    await askNodes(
      item.children,
      (fieldId) => itemAnswerKey(repeat.id, item.key, fieldId),
      doc,
      result,
      options,
    );
  }
}

/**
 * Offer to skip this project, requiring a reason when the template demands one.
 *
 * The template's own instruction is that a skip should be stated rather than
 * left blank, so the reason is prompted as required rather than optional.
 */
async function askedToSkip(
  item: RepeatItem,
  repeat: ExpandedRepeatNode,
  result: RunResult,
  options: RunOptions & { print: (t: string) => void },
): Promise<boolean> {
  const answer = await options.ask(`  Skip ${item.label}? (y/N): `);
  if (!/^y(es)?$/i.test(answer.trim())) return false;

  const reason = await promptField(
    {
      id: `${repeat.id}.${item.key}.skip_reason`,
      type: 'text',
      label: '    Reason',
      required: repeat.skipReason === 'required',
    },
    options,
  );
  result.skips[`${repeat.id}.${item.key}`] = reason;
  return true;
}

export type { Ask };
