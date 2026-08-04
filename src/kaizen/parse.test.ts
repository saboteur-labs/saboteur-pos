import { describe, expect, it } from 'vitest';
import { loadKaizenTemplate } from './loader.js';
import { findShippedTemplate } from './paths.js';
import {
  KaizenParseError,
  parse,
  reassemble,
  tokenize,
  type FieldNode,
  type ListNode,
  type Node,
  type SectionNode,
} from './parse.js';

const shipped = loadKaizenTemplate({ configPath: '/unused', templatePath: findShippedTemplate() });
const BODY = shipped.body;

const fieldsIn = (nodes: Node[]) => nodes.filter((n): n is FieldNode => n.kind === 'field');
const findField = (doc: { preamble: Node[]; sections: SectionNode[] }, id: string) =>
  [...fieldsIn(doc.preamble), ...doc.sections.flatMap((s) => fieldsIn(s.children))].find(
    (f) => f.id === id,
  );

describe('tokenize', () => {
  it('is lossless — every byte of the body survives reassembly', () => {
    expect(reassemble(tokenize(BODY))).toBe(BODY);
  });

  it('treats non-sab HTML comments as prose, not structure', () => {
    // The template uses `<!-- YYYY-MM-DD -->` and `<!-- e.g. 45m -->` as inline
    // human hints; they are part of the document, not directives.
    const tokens = tokenize(BODY);
    const directiveNames = tokens
      .filter((t) => t.kind === 'directive')
      .map((t) => (t.kind === 'directive' ? t.directive.name : ''));
    expect(directiveNames).not.toContain('YYYY-MM-DD');
    const prose = tokens.filter((t) => t.kind === 'prose').map((t) => (t.kind === 'prose' ? t.text : '')).join('');
    expect(prose).toContain('<!-- YYYY-MM-DD -->');
    expect(prose).toContain('<!-- e.g. 45m -->');
  });

  it('keeps the long explanatory comment block as prose', () => {
    const prose = tokenize(BODY)
      .filter((t) => t.kind === 'prose')
      .map((t) => (t.kind === 'prose' ? t.text : ''))
      .join('');
    expect(prose).toContain('Per-context extra prompts.');
  });

  it('records source offsets that map back into the body', () => {
    for (const token of tokenize(BODY)) {
      if (token.kind === 'directive') {
        expect(BODY.slice(token.directive.start, token.directive.end)).toBe(token.directive.raw);
      } else {
        expect(BODY.slice(token.start, token.end)).toBe(token.text);
      }
    }
  });
});

describe('attribute parsing', () => {
  const attrsOf = (src: string) => {
    const tokens = tokenize(src);
    if (tokens[0].kind !== 'directive') throw new Error('expected a directive');
    return tokens[0].directive;
  };

  it('reads quoted values containing spaces', () => {
    expect(
      attrsOf('<!-- sab:table id="t" empty-message="No prior intentions on record." -->').attrs[
        'empty-message'
      ],
    ).toBe('No prior intentions on record.');
  });

  it('reads quoted values containing pipes', () => {
    expect(
      attrsOf('<!-- sab:column id="outcome" type="enum" values="held|partial|missed|dropped" -->')
        .attrs.values,
    ).toBe('held|partial|missed|dropped');
  });

  it('reads quoted values containing comparison operators', () => {
    expect(attrsOf('<!-- sab:followup when="energy<=2 or focus<=2" field="n" type="text" -->').attrs.when).toBe(
      'energy<=2 or focus<=2',
    );
  });

  it('reads hyphenated attribute names', () => {
    expect(attrsOf('<!-- sab:list id="i" carries-forward-to="r" -->').attrs['carries-forward-to']).toBe('r');
  });

  it('reads bare positional quoted values', () => {
    expect(attrsOf('<!-- sab:fixed-rows "Job search / financial stability" "Rest / recovery" -->').positional).toEqual([
      'Job search / financial stability',
      'Rest / recovery',
    ]);
  });

  it('rejects an unterminated quoted value', () => {
    expect(() => attrsOf('<!-- sab:field id="oops -->')).toThrow(KaizenParseError);
  });

  it('rejects an unquoted attribute value', () => {
    expect(() => attrsOf('<!-- sab:field id=oops -->')).toThrow(/quoted value/);
  });
});

describe('parse — shipped template', () => {
  const doc = parse(BODY);

  it('yields the seven sections in template order', () => {
    expect(doc.sections.map((s) => s.id)).toEqual([
      'pulse-check',
      'intentions-review',
      'project-snapshots',
      'kaizen-question',
      'bandwidth',
      'next-intentions',
      'honest-note',
    ]);
  });

  it('carries section titles and minutes', () => {
    expect(doc.sections[0].title).toBe('Pulse Check');
    expect(doc.sections[0].minutes).toBe('5');
    expect(doc.sections[2].minutes).toBe('10-15');
  });

  it('puts the header fields in the preamble, before any section', () => {
    expect(fieldsIn(doc.preamble).map((f) => f.id)).toEqual(['week_of', 'time_spent']);
  });

  it('parses field ids and types', () => {
    expect(findField(doc, 'week_of')?.type).toBe('date');
    expect(findField(doc, 'time_spent')?.type).toBe('duration');
    expect(findField(doc, 'energy')?.type).toBe('scale');
    expect(findField(doc, 'kaizen_answer')?.type).toBe('longtext');
    expect(findField(doc, 'matches_priorities')?.type).toBe('enum');
  });

  it('parses required and conditional flags', () => {
    expect(findField(doc, 'energy')?.required).toBe(true);
    expect(findField(doc, 'whats_blocked')?.required).toBe(false);
    expect(findField(doc, 'protect_or_cut')?.when).toBe('matches_priorities!=Y');
  });

  it('parses scale bounds as directive attributes', () => {
    const energy = findField(doc, 'energy')!;
    expect(energy.directive.attrs.min).toBe('1');
    expect(energy.directive.attrs.max).toBe('5');
  });

  it('parses the followup with its condition', () => {
    const followup = doc.sections[0].children.find((n) => n.kind === 'followup');
    expect(followup).toMatchObject({ id: 'low_score_note', type: 'text', when: 'energy<=2 or focus<=2' });
  });

  it('parses the intentions list with its cap and carry-forward binding', () => {
    const list = doc.sections[5].children.find((n): n is ListNode => n.kind === 'list')!;
    expect(list).toMatchObject({ id: 'intentions', min: 1, max: 3, carriesForwardTo: 'intentions_review' });
  });

  it('preserves composite directives in document order for the next layer', () => {
    const raw = doc.sections[2].children
      .filter((n) => n.kind === 'raw-directive')
      .map((n) => (n.kind === 'raw-directive' ? n.directive.name : ''));
    expect(raw[0]).toBe('repeat');
    expect(raw).toContain('end-repeat');
    expect(raw.filter((n) => n === 'extra')).toHaveLength(3);
  });

  it('parses clean, with no warnings', () => {
    expect(doc.warnings).toEqual([]);
  });
});

describe('parse — error and warning handling', () => {
  it('warns and skips an unrecognised directive without aborting', () => {
    const doc = parse('<!-- sab:section id="s" -->\ntext\n<!-- sab:nonsense id="x" -->\nmore\n');
    expect(doc.warnings).toHaveLength(1);
    expect(doc.warnings[0]).toContain('sab:nonsense');
    expect(doc.sections).toHaveLength(1);
    const prose = doc.sections[0].children
      .filter((n) => n.kind === 'prose')
      .map((n) => (n.kind === 'prose' ? n.text : ''))
      .join('');
    expect(prose).toContain('text');
    expect(prose).toContain('more');
  });

  it('drops an unknown directive from the node tree rather than leaking it as prose', () => {
    const doc = parse('<!-- sab:section id="s" -->\n<!-- sab:nonsense -->\n');
    const prose = doc.sections[0].children
      .filter((n) => n.kind === 'prose')
      .map((n) => (n.kind === 'prose' ? n.text : ''))
      .join('');
    expect(prose).not.toContain('sab:nonsense');
  });

  it('rejects a field with no id', () => {
    expect(() => parse('<!-- sab:field type="text" -->')).toThrow(/missing 'id'/);
  });

  it('rejects a section with no id', () => {
    expect(() => parse('<!-- sab:section title="No id" -->')).toThrow(/missing 'id'/);
  });

  it('rejects a non-integer list bound', () => {
    expect(() => parse('<!-- sab:list id="i" max="lots" -->')).toThrow(/non-integer 'max'/);
  });
});
