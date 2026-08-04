/**
 * Kaizen template parser.
 *
 * Structure comes only from `<!-- sab:* -->` directives; nothing is inferred
 * from prose, heading text, or list formatting. That is what lets a review
 * reproduce the template's prose byte-for-byte into the note — the parser never
 * has to interpret the words it preserves, so it never has an excuse to
 * normalise them.
 *
 * Prose is therefore modelled as opaque spans. Every byte of the template body
 * ends up in exactly one token, verbatim; `assertLossless` pins that.
 */

/** Directive names this parser recognises. Anything else warns and is skipped. */
export const KNOWN_DIRECTIVES = [
  'section',
  'field',
  'followup',
  'table',
  'column',
  'fixed-rows',
  'repeat',
  'end-repeat',
  'extra',
  'list',
] as const;

export type DirectiveName = (typeof KNOWN_DIRECTIVES)[number];

/** Field input types. Validation of their attributes happens in validate.ts. */
export const FIELD_TYPES = [
  'scale',
  'word',
  'text',
  'longtext',
  'enum',
  'percent',
  'date',
  'duration',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export interface Directive {
  name: string;
  attrs: Record<string, string>;
  /** Bare quoted values, e.g. `sab:fixed-rows "Rest / recovery"`. */
  positional: string[];
  /** Offsets into the template body, inclusive of the comment delimiters. */
  start: number;
  end: number;
  raw: string;
}

export type Token =
  | { kind: 'prose'; text: string; start: number; end: number }
  | { kind: 'directive'; directive: Directive };

export interface ProseNode {
  kind: 'prose';
  text: string;
}

export interface FieldNode {
  kind: 'field';
  id: string;
  type: string;
  required: boolean;
  when?: string;
  default?: string;
  directive: Directive;
}

export interface FollowupNode {
  kind: 'followup';
  /** Id of the answer this followup records — `field` on the directive. */
  id: string;
  type: string;
  when?: string;
  required: boolean;
  directive: Directive;
}

export interface ListNode {
  kind: 'list';
  id: string;
  type: string;
  min?: number;
  max?: number;
  carriesForwardTo?: string;
  directive: Directive;
}

/**
 * A recognised directive not yet folded into a composite node. Present only
 * between the flat pass and `fold()`; a parsed document contains none.
 */
export interface RawDirectiveNode {
  kind: 'raw-directive';
  directive: Directive;
}

export interface ColumnSpec {
  id: string;
  type?: string;
  values?: string[];
  source?: string;
  /** `prompt="false"` marks a column whose values come from data, not the user. */
  prompt: boolean;
  directive: Directive;
}

export interface TableNode {
  kind: 'table';
  id: string;
  /** Row source, e.g. `contexts+fixed` or `from:previous.intentions`. */
  rows?: string;
  exclude?: string[];
  emptyMessage?: string;
  warnUnlessSumsTo?: number;
  columns: ColumnSpec[];
  fixedRows: string[];
  /**
   * The markdown table block this directive governs, captured verbatim. Its
   * header row is preserved on render; its empty body rows are replaced by the
   * generated ones.
   */
  placeholder?: string;
  directive: Directive;
}

export interface RepeatNode {
  kind: 'repeat';
  id: string;
  /** Where iteration items come from, e.g. `contexts`. */
  source: string;
  exclude: string[];
  order?: string;
  skippable: boolean;
  /** `required` when a skip must carry a reason. */
  skipReason?: string;
  /** Recap data to show before each iteration's prompts. */
  recap: string[];
  children: Node[];
  directive: Directive;
}

export interface ExtraNode {
  kind: 'extra';
  /** Context slug these fields are appended to. */
  context: string;
  children: Node[];
  directive: Directive;
}

export type Node =
  | ProseNode
  | FieldNode
  | FollowupNode
  | ListNode
  | TableNode
  | RepeatNode
  | ExtraNode
  | RawDirectiveNode;

export interface SectionNode {
  id: string;
  title?: string;
  minutes?: string;
  children: Node[];
  directive: Directive;
}

export interface KaizenDocument {
  /** Nodes before the first `sab:section` — the `Week of` / `Time spent` header. */
  preamble: Node[];
  sections: SectionNode[];
  /** Non-fatal problems. Callers emit these to stderr; parsing continues. */
  warnings: string[];
}

export class KaizenParseError extends Error {}

const COMMENT = /<!--([\s\S]*?)-->/g;

/**
 * Split the body into prose spans and `sab:*` directives.
 *
 * HTML comments that are not `sab:*` (`<!-- YYYY-MM-DD -->`, the explanatory
 * block above the per-context extras) are deliberately left as prose: they are
 * part of the document the user wrote, and only directives are structural.
 */
export function tokenize(body: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;

  COMMENT.lastIndex = 0;
  for (let m = COMMENT.exec(body); m !== null; m = COMMENT.exec(body)) {
    const inner = m[1].trim();
    if (!inner.startsWith('sab:')) continue;

    if (m.index > cursor) {
      tokens.push({ kind: 'prose', text: body.slice(cursor, m.index), start: cursor, end: m.index });
    }
    const end = m.index + m[0].length;
    tokens.push({
      kind: 'directive',
      directive: { ...parseDirective(inner), start: m.index, end, raw: m[0] },
    });
    cursor = end;
  }

  if (cursor < body.length) {
    tokens.push({ kind: 'prose', text: body.slice(cursor), start: cursor, end: body.length });
  }
  return tokens;
}

function parseDirective(inner: string): Pick<Directive, 'name' | 'attrs' | 'positional'> {
  const afterPrefix = inner.slice('sab:'.length);
  const nameMatch = /^[a-z-]+/.exec(afterPrefix);
  if (!nameMatch) {
    throw new KaizenParseError(`Malformed directive: <!-- ${inner} -->`);
  }
  const name = nameMatch[0];
  const attrs: Record<string, string> = {};
  const positional: string[] = [];

  let i = nameMatch[0].length;
  const rest = afterPrefix;
  while (i < rest.length) {
    while (i < rest.length && /\s/.test(rest[i])) i++;
    if (i >= rest.length) break;

    if (rest[i] === '"') {
      const { value, next } = readQuoted(rest, i, inner);
      positional.push(value);
      i = next;
      continue;
    }

    const keyMatch = /^[a-zA-Z_][\w-]*/.exec(rest.slice(i));
    if (!keyMatch) {
      throw new KaizenParseError(
        `Malformed attribute at position ${i} in directive: <!-- ${inner} -->`,
      );
    }
    const key = keyMatch[0];
    i += key.length;

    if (rest[i] !== '=') {
      // Valueless attribute — treat as a present flag.
      attrs[key] = 'true';
      continue;
    }
    i++;
    if (rest[i] !== '"') {
      throw new KaizenParseError(
        `Attribute '${key}' must have a quoted value in directive: <!-- ${inner} -->`,
      );
    }
    const { value, next } = readQuoted(rest, i, inner);
    attrs[key] = value;
    i = next;
  }

  return { name, attrs, positional };
}

/**
 * Read a double-quoted value. Quoting is what lets attribute values carry
 * spaces, pipes, and comparison operators — `values="held|partial"`,
 * `when="energy<=2 or focus<=2"` — so the value is taken literally to the
 * closing quote with no escape processing.
 */
function readQuoted(s: string, openIndex: number, inner: string): { value: string; next: number } {
  const close = s.indexOf('"', openIndex + 1);
  if (close === -1) {
    throw new KaizenParseError(`Unterminated quoted value in directive: <!-- ${inner} -->`);
  }
  return { value: s.slice(openIndex + 1, close), next: close + 1 };
}

/** Build the section/field/list/followup tree from a token stream. */
export function parse(body: string): KaizenDocument {
  const tokens = tokenize(body);
  const doc: KaizenDocument = { preamble: [], sections: [], warnings: [] };

  let current: Node[] = doc.preamble;

  for (const token of tokens) {
    if (token.kind === 'prose') {
      current.push({ kind: 'prose', text: token.text });
      continue;
    }

    const d = token.directive;
    if (!(KNOWN_DIRECTIVES as readonly string[]).includes(d.name)) {
      doc.warnings.push(`Unknown directive '<!-- sab:${d.name} ... -->' ignored.`);
      continue;
    }

    switch (d.name) {
      case 'section': {
        const section: SectionNode = {
          id: requireAttr(d, 'id'),
          title: d.attrs.title,
          minutes: d.attrs.minutes,
          children: [],
          directive: d,
        };
        doc.sections.push(section);
        current = section.children;
        break;
      }
      case 'field':
        current.push({
          kind: 'field',
          id: requireAttr(d, 'id'),
          type: requireAttr(d, 'type'),
          required: d.attrs.required === 'true',
          when: d.attrs.when,
          default: d.attrs.default,
          directive: d,
        });
        break;
      case 'followup':
        current.push({
          kind: 'followup',
          id: requireAttr(d, 'field'),
          type: requireAttr(d, 'type'),
          when: d.attrs.when,
          required: d.attrs.required === 'true',
          directive: d,
        });
        break;
      case 'list':
        current.push({
          kind: 'list',
          id: requireAttr(d, 'id'),
          type: d.attrs.type ?? 'text',
          min: optionalInt(d, 'min'),
          max: optionalInt(d, 'max'),
          carriesForwardTo: d.attrs['carries-forward-to'],
          directive: d,
        });
        break;
      default:
        // Composite directives are folded into structure below.
        current.push({ kind: 'raw-directive', directive: d });
    }
  }

  doc.preamble = fold(doc.preamble, 'preamble');
  for (const section of doc.sections) {
    section.children = fold(section.children, section.id);
  }

  return doc;
}

/**
 * Fold the composite directive families into single nodes:
 * `table` absorbs its columns, fixed rows, and markdown block; `repeat` absorbs
 * everything up to `end-repeat`; `extra` absorbs the fields that follow it.
 */
function fold(nodes: Node[], scope: string): Node[] {
  const out: Node[] = [];
  let i = 0;

  while (i < nodes.length) {
    const node = nodes[i];
    if (node.kind !== 'raw-directive') {
      out.push(node);
      i++;
      continue;
    }

    const d = node.directive;
    switch (d.name) {
      case 'table': {
        const { table, next } = foldTable(nodes, i, out);
        out.push(table);
        i = next;
        break;
      }
      case 'repeat': {
        const { repeat, next } = foldRepeat(nodes, i, scope);
        out.push(repeat);
        i = next;
        break;
      }
      case 'extra': {
        const { extra, next } = foldExtra(nodes, i);
        out.push(extra);
        i = next;
        break;
      }
      case 'end-repeat':
        throw new KaizenParseError(
          `Section '${scope}' has a '<!-- sab:end-repeat -->' with no matching '<!-- sab:repeat -->'.`,
        );
      case 'column':
      case 'fixed-rows':
        throw new KaizenParseError(
          `Section '${scope}' has a '<!-- sab:${d.name} ... -->' outside any '<!-- sab:table ... -->'.`,
        );
      default:
        out.push(node);
        i++;
    }
  }

  return out;
}

/** True for prose that is only whitespace — allowed between stacked directives. */
const isBlank = (n: Node): boolean => n.kind === 'prose' && n.text.trim() === '';

function foldTable(nodes: Node[], start: number, out: Node[]): { table: TableNode; next: number } {
  const d = (nodes[start] as RawDirectiveNode).directive;
  const columns: ColumnSpec[] = [];
  const fixedRows: string[] = [];

  let i = start + 1;
  // Columns and fixed rows are stacked directly under the table directive, with
  // only line breaks between them.
  while (i < nodes.length) {
    const n = nodes[i];
    if (isBlank(n)) {
      i++;
      continue;
    }
    if (n.kind !== 'raw-directive') break;
    const name = n.directive.name;
    if (name === 'column') {
      const values = n.directive.attrs.values;
      columns.push({
        id: requireAttr(n.directive, 'id'),
        type: n.directive.attrs.type,
        values: values === undefined ? undefined : values.split('|'),
        source: n.directive.attrs.source,
        prompt: n.directive.attrs.prompt !== 'false',
        directive: n.directive,
      });
      i++;
      continue;
    }
    if (name === 'fixed-rows') {
      fixedRows.push(...n.directive.positional);
      i++;
      continue;
    }
    break;
  }

  const table: TableNode = {
    kind: 'table',
    id: requireAttr(d, 'id'),
    rows: d.attrs.rows,
    exclude: splitList(d.attrs.exclude),
    emptyMessage: d.attrs['empty-message'],
    warnUnlessSumsTo: optionalInt(d, 'warn-unless-sums-to'),
    columns,
    fixedRows,
    directive: d,
  };

  // Absorb the markdown table block this directive governs. The directive
  // declares that a table exists and names its columns; this only locates the
  // block's extent so the renderer can keep the header row and replace the
  // empty body rows, rather than emitting a filled table beside a blank one.
  const next = nodes[i];
  if (next?.kind === 'prose') {
    const split = extractTableBlock(next.text);
    if (split) {
      if (split.before) out.push({ kind: 'prose', text: split.before });
      table.placeholder = split.block;
      nodes[i] = { kind: 'prose', text: split.after };
    }
  }

  return { table, next: i };
}

/**
 * Locate a contiguous run of markdown table rows (lines whose first non-space
 * character is `|`) inside a prose span.
 *
 * `before + block + after` reconstructs the input exactly — the separating
 * newlines are kept rather than eaten by the split, so folding a table out of a
 * prose span stays lossless.
 */
export function extractTableBlock(
  text: string,
): { before: string; block: string; after: string } | null {
  const lines = text.split('\n');
  const isRow = (l: string) => l.trimStart().startsWith('|');
  const first = lines.findIndex(isRow);
  if (first === -1) return null;
  let last = first;
  while (last + 1 < lines.length && isRow(lines[last + 1])) last++;

  const before = lines.slice(0, first).join('\n') + (first > 0 ? '\n' : '');
  const block = lines.slice(first, last + 1).join('\n');
  const after = last + 1 < lines.length ? '\n' + lines.slice(last + 1).join('\n') : '';

  return { before, block, after };
}

function foldRepeat(nodes: Node[], start: number, scope: string): { repeat: RepeatNode; next: number } {
  const d = (nodes[start] as RawDirectiveNode).directive;
  const children: Node[] = [];

  let i = start + 1;
  let closed = false;
  while (i < nodes.length) {
    const n = nodes[i];
    if (n.kind === 'raw-directive' && n.directive.name === 'end-repeat') {
      closed = true;
      i++;
      break;
    }
    if (n.kind === 'raw-directive' && n.directive.name === 'repeat') {
      throw new KaizenParseError(
        `Section '${scope}' nests '<!-- sab:repeat -->' inside another repeat, which is not supported.`,
      );
    }
    children.push(n);
    i++;
  }

  if (!closed) {
    throw new KaizenParseError(
      `Section '${scope}' has an unclosed '<!-- sab:repeat ... -->' — no '<!-- sab:end-repeat -->' was found.`,
    );
  }

  return {
    repeat: {
      kind: 'repeat',
      id: requireAttr(d, 'id'),
      source: requireAttr(d, 'source'),
      exclude: splitList(d.attrs.exclude) ?? [],
      order: d.attrs.order,
      skippable: d.attrs.skippable === 'true',
      skipReason: d.attrs['skip-reason'],
      recap: splitList(d.attrs.recap) ?? [],
      children: fold(children, scope),
      directive: d,
    },
    next: i,
  };
}

/**
 * An `sab:extra` block runs until the next `sab:extra` or the end of its
 * section — there is no explicit terminator, since each block is a short list
 * of fields appended to one context's snapshot.
 */
function foldExtra(nodes: Node[], start: number): { extra: ExtraNode; next: number } {
  const d = (nodes[start] as RawDirectiveNode).directive;
  const children: Node[] = [];

  let i = start + 1;
  while (i < nodes.length) {
    const n = nodes[i];
    if (n.kind === 'raw-directive' && n.directive.name === 'extra') break;
    children.push(n);
    i++;
  }

  return {
    extra: {
      kind: 'extra',
      context: requireAttr(d, 'context'),
      children: fold(children, `extra:${d.attrs.context}`),
      directive: d,
    },
    next: i,
  };
}

function splitList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function requireAttr(d: Directive, key: string): string {
  const value = d.attrs[key];
  if (value === undefined || value === '') {
    throw new KaizenParseError(`Directive '<!-- sab:${d.name} ... -->' is missing '${key}'.`);
  }
  return value;
}

function optionalInt(d: Directive, key: string): number | undefined {
  const raw = d.attrs[key];
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new KaizenParseError(
      `Directive '<!-- sab:${d.name} ... -->' has a non-integer '${key}' of '${raw}'.`,
    );
  }
  return n;
}

/**
 * Reassemble the template body from its tokens.
 *
 * Used by tests as the losslessness guard: if this ever stops equalling the
 * input, the parser has begun normalising text it is supposed to preserve, and
 * FR4's byte-for-byte guarantee is already broken regardless of what the
 * renderer does.
 */
export function reassemble(tokens: Token[]): string {
  return tokens.map((t) => (t.kind === 'prose' ? t.text : t.directive.raw)).join('');
}
