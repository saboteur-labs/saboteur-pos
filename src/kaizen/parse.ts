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
 * A recognised directive this layer does not yet build a node for — the
 * composite table/repeat/extra family, consumed in the next layer. Kept in
 * document order so nothing is lost in the meantime.
 */
export interface RawDirectiveNode {
  kind: 'raw-directive';
  directive: Directive;
}

export type Node = ProseNode | FieldNode | FollowupNode | ListNode | RawDirectiveNode;

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
        // Composite directives (table/column/fixed-rows/repeat/end-repeat/extra)
        // are recognised vocabulary handled by the next layer.
        current.push({ kind: 'raw-directive', directive: d });
    }
  }

  return doc;
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
