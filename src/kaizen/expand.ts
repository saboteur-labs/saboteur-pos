import type {
  ColumnSpec,
  Directive,
  ExtraNode,
  FieldNode,
  FollowupNode,
  KaizenDocument,
  ListNode,
  Node,
  ProseNode,
  RepeatNode,
  TableNode,
} from './parse.js';

/**
 * Expansion — the step where a template stops being generic and becomes this
 * user's review.
 *
 * Section 3's project snapshots and section 5's bandwidth rows are generated
 * from the user's `sab` contexts rather than from headings in the template, so
 * a new repo is reviewed without a template edit and a retired one disappears
 * without one either.
 */

export interface ContextRef {
  slug: string;
  name: string;
}

export interface ExpandOptions {
  contexts: ContextRef[];
  /** Intentions recorded by the previous Kaizen note, for section 2's prefill. */
  previousIntentions?: string[];
}

export interface TableRow {
  /** Stable answer key for this row. */
  key: string;
  /** Row label as rendered — a context name, or a fixed row's literal wording. */
  label: string;
  /** True for rows declared by `sab:fixed-rows` rather than generated. */
  fixed: boolean;
  /** Column values known before prompting, e.g. a carried-forward intention. */
  prefilled: Record<string, string>;
}

export interface ExpandedTableNode {
  kind: 'expanded-table';
  id: string;
  columns: ColumnSpec[];
  rows: TableRow[];
  emptyMessage?: string;
  warnUnlessSumsTo?: number;
  placeholder?: string;
  directive: Directive;
}

export interface RepeatItem {
  /** Context slug — the stable half of the answer key. */
  key: string;
  /** Context name, as substituted into the item's prose. */
  label: string;
  children: ExpandedNode[];
}

export interface ExpandedRepeatNode {
  kind: 'expanded-repeat';
  id: string;
  skippable: boolean;
  skipReason?: string;
  recap: string[];
  items: RepeatItem[];
  directive: Directive;
}

export type ExpandedNode =
  | ProseNode
  | FieldNode
  | FollowupNode
  | ListNode
  | ExpandedTableNode
  | ExpandedRepeatNode;

export interface ExpandedSection {
  id: string;
  title?: string;
  minutes?: string;
  children: ExpandedNode[];
}

export interface ExpandedDocument {
  preamble: ExpandedNode[];
  sections: ExpandedSection[];
  warnings: string[];
}

/** Answer key for a field inside a repeated item. */
export function itemAnswerKey(repeatId: string, itemKey: string, fieldId: string): string {
  return `${repeatId}.${itemKey}.${fieldId}`;
}

/** Answer key for a cell in a generated table. */
export function cellAnswerKey(tableId: string, rowKey: string, columnId: string): string {
  return `${tableId}.${rowKey}.${columnId}`;
}

export function expand(doc: KaizenDocument, options: ExpandOptions): ExpandedDocument {
  const warnings = [...doc.warnings];
  const ctx = { ...options, warnings };

  return {
    preamble: expandNodes(doc.preamble, ctx),
    sections: doc.sections.map((section) => ({
      id: section.id,
      title: section.title,
      minutes: section.minutes,
      children: expandNodes(section.children, ctx),
    })),
    warnings,
  };
}

interface ExpandContext extends ExpandOptions {
  warnings: string[];
}

function expandNodes(nodes: Node[], ctx: ExpandContext): ExpandedNode[] {
  // Extras are consumed by the repeat they extend, not rendered where they sit.
  const extras = nodes.filter((n): n is ExtraNode => n.kind === 'extra');

  const out: ExpandedNode[] = [];
  for (const node of nodes) {
    switch (node.kind) {
      case 'extra':
        break;
      case 'repeat':
        out.push(expandRepeat(node, extras, ctx));
        break;
      case 'table':
        out.push(expandTable(node, ctx));
        break;
      case 'raw-directive':
        // fold() consumes every recognised composite, so reaching this means the
        // parser and this switch have drifted apart.
        throw new Error(
          `Unfolded '<!-- sab:${node.directive.name} ... -->' reached expansion — this is a bug in the parser.`,
        );
      default:
        out.push(node);
    }
  }
  return out;
}

/** Contexts in scope for generation, excluding what the directive excludes. */
function selectContexts(ctx: ExpandContext, exclude: string[], order?: string): ContextRef[] {
  const excluded = new Set(exclude);
  const selected = ctx.contexts.filter((c) => !excluded.has(c.slug));
  // `order="alpha"` sorts by slug rather than name: the slug is the stable
  // identifier, so a renamed context keeps its position and week-to-week
  // comparisons stay aligned.
  return order === 'alpha' ? [...selected].sort((a, b) => a.slug.localeCompare(b.slug)) : selected;
}

function expandRepeat(
  repeat: RepeatNode,
  extras: ExtraNode[],
  ctx: ExpandContext,
): ExpandedRepeatNode {
  const contexts = selectContexts(ctx, repeat.exclude, repeat.order);

  const items = contexts.map((context) => {
    const extra = extras.filter((e) => e.context === context.slug);
    const children = [...repeat.children, ...extra.flatMap((e) => e.children)];
    return {
      key: context.slug,
      label: context.name,
      children: expandNodes(children, ctx).map((n) => substituteInNode(n, context)),
    };
  });

  return {
    kind: 'expanded-repeat',
    id: repeat.id,
    skippable: repeat.skippable,
    skipReason: repeat.skipReason,
    recap: repeat.recap,
    items,
    directive: repeat.directive,
  };
}

const PLACEHOLDER = /\{\{\s*context\.(name|slug)\s*\}\}/g;

/**
 * Substitute `{{ context.name }}` / `{{ context.slug }}` in an item's prose.
 *
 * This is the one sanctioned edit to template prose. It is not a hole in the
 * byte-for-byte guarantee so much as the declared mechanism by which a repeated
 * block names the thing it is repeating over — the template asks for it
 * explicitly, rather than the renderer deciding to rewrite words on its own.
 */
function substituteInNode(node: ExpandedNode, context: ContextRef): ExpandedNode {
  if (node.kind !== 'prose') return node;
  return {
    kind: 'prose',
    text: node.text.replace(PLACEHOLDER, (_, part: string) =>
      part === 'name' ? context.name : context.slug,
    ),
  };
}

function expandTable(table: TableNode, ctx: ExpandContext): ExpandedTableNode {
  return {
    kind: 'expanded-table',
    id: table.id,
    columns: table.columns,
    rows: resolveRows(table, ctx),
    emptyMessage: table.emptyMessage,
    warnUnlessSumsTo: table.warnUnlessSumsTo,
    placeholder: table.placeholder,
    directive: table.directive,
  };
}

function resolveRows(table: TableNode, ctx: ExpandContext): TableRow[] {
  const spec = table.rows;
  if (spec === undefined) return [];

  if (spec.startsWith('from:')) {
    return rowsFromSource(table, spec.slice('from:'.length), ctx);
  }

  const parts = spec.split('+').map((p) => p.trim());
  const rows: TableRow[] = [];

  for (const part of parts) {
    if (part === 'contexts') {
      for (const context of selectContexts(ctx, table.exclude ?? [], 'alpha')) {
        rows.push({ key: context.slug, label: context.name, fixed: false, prefilled: {} });
      }
    } else if (part === 'fixed') {
      // Fixed rows keep the template's exact wording; they are the non-project
      // areas the bandwidth audit exists to make visible.
      for (const label of table.fixedRows) {
        rows.push({ key: label, label, fixed: true, prefilled: {} });
      }
    } else {
      ctx.warnings.push(
        `Table '${table.id}' declares unknown row source '${part}' — no rows generated for it.`,
      );
    }
  }

  return rows;
}

function rowsFromSource(table: TableNode, source: string, ctx: ExpandContext): TableRow[] {
  if (source !== 'previous.intentions') {
    ctx.warnings.push(
      `Table '${table.id}' declares unknown row source 'from:${source}' — no rows generated.`,
    );
    return [];
  }

  // The column marked `source="previous.intentions"` is prefilled and not
  // prompted; the user answers only the remaining columns for each row.
  const sourced = table.columns.find((col) => col.source === source);

  return (ctx.previousIntentions ?? []).map((text, index) => ({
    key: String(index),
    label: text,
    fixed: false,
    prefilled: sourced ? { [sourced.id]: text } : {},
  }));
}
