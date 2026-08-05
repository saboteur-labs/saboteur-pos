import { cellAnswerKey, itemAnswerKey } from './expand.js';
import type {
  ExpandedDocument,
  ExpandedNode,
  ExpandedRepeatNode,
  ExpandedTableNode,
  RepeatItem,
  TableRow,
} from './expand.js';
import type { ListNode, ProseNode } from './parse.js';

/**
 * Render collected answers back into the template's own shape.
 *
 * The contract this file exists to keep: every prompt, heading, blockquote, and
 * instructional sentence comes out byte-for-byte as the template wrote it. The
 * renderer only ever *appends* answers to prose or *replaces* a placeholder it
 * was explicitly handed. It never reflows, re-wraps, or regenerates markdown
 * from structure, because the moment it does, the user's wording is at the
 * mercy of a formatter.
 */

export interface RenderOptions {
  /** Flat answer map, keyed as the prompting layer keyed it. */
  answers: Record<string, string>;
  /** Skip reasons for repeated items, keyed `<repeatId>.<itemKey>`. */
  skips?: Record<string, string>;
  /** Field types that render on their own lines rather than inline. */
  blockTypes?: string[];
}

const DEFAULT_BLOCK_TYPES = ['longtext'];

export function render(doc: ExpandedDocument, options: RenderOptions): string {
  const ctx: RenderContext = {
    answers: options.answers,
    skips: options.skips ?? {},
    blockTypes: new Set(options.blockTypes ?? DEFAULT_BLOCK_TYPES),
  };

  return [
    renderNodes(doc.preamble, ctx, (id) => id),
    ...doc.sections.map((section) => renderNodes(section.children, ctx, (id) => id)),
  ].join('');
}

interface RenderContext {
  answers: Record<string, string>;
  skips: Record<string, string>;
  blockTypes: Set<string>;
}

/** Maps a field's local id to the key its answer was stored under. */
type KeyResolver = (fieldId: string) => string;

/** An answer waiting for the prose line it belongs to. */
interface Pending {
  text: string;
  block: boolean;
}

function renderNodes(nodes: ExpandedNode[], ctx: RenderContext, keyOf: KeyResolver): string {
  let out = '';
  let pending: Pending | null = null;

  const flushInto = (prose: string): string => {
    if (!pending) return prose;
    const filled = attachAnswer(prose, pending);
    pending = null;
    return filled;
  };

  for (const node of nodes) {
    switch (node.kind) {
      case 'prose':
        out += flushInto(node.text);
        break;

      case 'field': {
        const answer = ctx.answers[keyOf(node.id)] ?? '';
        // An unanswered optional field still renders its prompt — the prompt is
        // the template's words, and dropping it would edit the document.
        pending = { text: answer, block: ctx.blockTypes.has(node.type) };
        break;
      }

      case 'followup':
        // Always a block. A follow-up is attached to an instruction rather than
        // a fill-in label ("If you scored 1–2 on either, note it"), so appending
        // inline would run the answer onto the end of that sentence.
        pending = { text: ctx.answers[keyOf(node.id)] ?? '', block: true };
        break;

      case 'list':
        out += renderList(node, ctx, keyOf);
        break;

      case 'expanded-table':
        out += renderTable(node, ctx);
        break;

      case 'expanded-repeat':
        out += renderRepeat(node, ctx);
        break;
    }
  }

  // A trailing answer with no prose after it still has to land somewhere.
  if (pending && pending.text !== '') {
    out += `${pending.text}\n`;
  }

  return out;
}

/**
 * Place an answer against the prompt it answers.
 *
 * Inline answers are appended to the end of the prompt's line, which is how the
 * template is written to be filled in by hand (`- **Energy level:** 4`). Block
 * answers go beneath it, since a multi-line reflection appended to a label
 * would run off the end of the line it belongs to.
 */
function attachAnswer(prose: string, pending: Pending): string {
  if (pending.text === '') return prose;

  const lines = prose.split('\n');
  const at = lines.findIndex((line) => line.trim() !== '');
  if (at === -1) {
    return `${prose}${pending.text}\n`;
  }

  lines[at] = pending.block
    ? `${lines[at]}\n\n${pending.text}`
    : `${lines[at]} ${pending.text}`;
  return lines.join('\n');
}

function renderList(node: ListNode, ctx: RenderContext, keyOf: KeyResolver): string {
  const entries: string[] = [];
  for (let i = 0; ; i++) {
    const value = ctx.answers[keyOf(`${node.id}.${i}`)];
    if (value === undefined) break;
    if (value.trim() !== '') entries.push(value);
  }

  if (node.placeholder === undefined) {
    return entries.map((entry, i) => `${i + 1}. ${entry}`).join('\n');
  }
  if (entries.length === 0) {
    // Keep the stub rather than emitting nothing, so the section still reads as
    // a list the user left empty.
    return node.placeholder;
  }
  return entries.map((entry, i) => `${i + 1}. ${entry}`).join('\n');
}

function renderTable(table: ExpandedTableNode, ctx: RenderContext): string {
  if (table.rows.length === 0) {
    return table.emptyMessage ? `_${table.emptyMessage}_` : '';
  }

  const header = headerLines(table);
  const body = table.rows.map((row) => renderRow(table, row, ctx));
  return [...header, ...body].join('\n');
}

/**
 * The template's own header and delimiter rows, kept verbatim.
 *
 * Regenerating them from column ids would replace the user's wording
 * ("Why it did/didn't happen") with machine names.
 */
function headerLines(table: ExpandedTableNode): string[] {
  if (table.placeholder === undefined) {
    return [
      `| ${table.columns.map((col) => col.id).join(' | ')} |`,
      `| ${table.columns.map(() => '---').join(' | ')} |`,
    ];
  }
  return table.placeholder.split('\n').slice(0, 2);
}

function renderRow(table: ExpandedTableNode, row: TableRow, ctx: RenderContext): string {
  const cells = table.columns.map((column) => {
    const prefilled = row.prefilled[column.id];
    if (prefilled !== undefined) return escapeCell(prefilled);
    // A non-prompted column with no prefill is the row's own label — the `Area`
    // column of the bandwidth table.
    if (!column.prompt) return escapeCell(row.label);
    return escapeCell(ctx.answers[cellAnswerKey(table.id, row.key, column.id)] ?? '');
  });
  return `| ${cells.join(' | ')} |`;
}

/** Keep a pipe in an answer from splitting the cell it was typed into. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

function renderRepeat(repeat: ExpandedRepeatNode, ctx: RenderContext): string {
  return repeat.items.map((item) => renderItem(repeat, item, ctx)).join('');
}

function renderItem(repeat: ExpandedRepeatNode, item: RepeatItem, ctx: RenderContext): string {
  const reason = ctx.skips[`${repeat.id}.${item.key}`];
  if (reason !== undefined) return renderSkippedItem(item, reason);

  return renderNodes(item.children, ctx, (fieldId) =>
    itemAnswerKey(repeat.id, item.key, fieldId),
  );
}

/**
 * A skipped project keeps its heading and records why, in place of its prompts.
 *
 * Emitting the bare unanswered prompts instead would make a deliberate skip
 * indistinguishable from a section the user silently abandoned — which is the
 * distinction the template's own instruction turns on.
 */
function renderSkippedItem(item: RepeatItem, reason: string): string {
  const lead: string[] = [];
  for (const node of item.children) {
    if (node.kind !== 'prose') break;
    lead.push((node as ProseNode).text);
  }
  return `${lead.join('').trimEnd()}\n\n_Skipped — ${reason}_\n`;
}
