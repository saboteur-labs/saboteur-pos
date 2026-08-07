import { describe, expect, it } from 'vitest';
import { loadKaizenTemplate } from './loader.js';
import { findShippedTemplate } from './paths.js';
import {
  extractTableBlock,
  KaizenParseError,
  parse,
  reassemble,
  tokenize,
  type ExtraNode,
  type FieldNode,
  type ListNode,
  type Node,
  type RepeatNode,
  type SectionNode,
  type TableNode,
} from './parse.js';

const shipped = loadKaizenTemplate({ configPath: '/unused', templatePath: findShippedTemplate() });
const BODY = shipped.body;

/** Direct field children only — used where nesting is the thing under test. */
const fieldsIn = (nodes: Node[]) => nodes.filter((n): n is FieldNode => n.kind === 'field');

/** Every field in the tree, descending into repeat and extra blocks. */
const allFields = (nodes: Node[]): FieldNode[] =>
  nodes.flatMap((n) =>
    n.kind === 'field'
      ? [n]
      : n.kind === 'repeat' || n.kind === 'extra'
        ? allFields(n.children)
        : [],
  );

const findField = (doc: { preamble: Node[]; sections: SectionNode[] }, id: string) =>
  [...allFields(doc.preamble), ...doc.sections.flatMap((s) => allFields(s.children))].find(
    (f) => f.id === id,
  );

describe('tokenize', () => {
  it('is lossless — every byte of the body survives reassembly', () => {
    expect(reassemble(tokenize(BODY))).toBe(BODY);
  });

  it('treats non-sab HTML comments as prose, not structure', () => {
    // Tested against a fixture rather than the shipped template: the shipped
    // one no longer carries inline comments, but a user's may — only `sab:`
    // makes a comment structural, and everything else is theirs to keep.
    const body = '**Week of:** <!-- YYYY-MM-DD -->\n\n<!-- sab:field id="x" type="text" -->\n';
    const tokens = tokenize(body);
    const directiveNames = tokens
      .filter((t) => t.kind === 'directive')
      .map((t) => (t.kind === 'directive' ? t.directive.name : ''));
    expect(directiveNames).toEqual(['field']);
    const prose = tokens
      .filter((t) => t.kind === 'prose')
      .map((t) => (t.kind === 'prose' ? t.text : ''))
      .join('');
    expect(prose).toContain('<!-- YYYY-MM-DD -->');
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

  /**
   * A format hint written as a comment is reproduced verbatim into every note,
   * between a label and its answer. It is also redundant: `promptField` derives
   * the same hint from the declared type, and a `label` attribute carries an
   * example where the type cannot. Prose is never stripped — FR4 — so the only
   * place to keep this honest is here, in what we ship.
   */
  it('carries no inline format hints — the prompt derives them from the type', () => {
    const inlineComments = BODY.split('\n')
      .filter((line) => /\S.*<!--/.test(line) && !line.includes('<!-- sab:'))
      .map((line) => line.trim());
    expect(inlineComments).toEqual([]);
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

  it('parses clean, with no warnings', () => {
    expect(doc.warnings).toEqual([]);
  });

  it('leaves no unfolded directives anywhere in the tree', () => {
    const walk = (nodes: Node[]): Node[] =>
      nodes.flatMap((n) => [
        n,
        ...(n.kind === 'repeat' || n.kind === 'extra' ? walk(n.children) : []),
      ]);
    const all = [...walk(doc.preamble), ...doc.sections.flatMap((s) => walk(s.children))];
    expect(all.filter((n) => n.kind === 'raw-directive')).toEqual([]);
  });
});

describe('parse — composite directives', () => {
  const doc = parse(BODY);
  const snapshots = doc.sections[2];

  it('folds the project snapshots into a repeat bound to contexts', () => {
    const repeat = snapshots.children.find((n): n is RepeatNode => n.kind === 'repeat')!;
    expect(repeat).toMatchObject({
      id: 'projects',
      source: 'contexts',
      exclude: ['inbox'],
      order: 'alpha',
      skippable: true,
      skipReason: 'required',
    });
    expect(repeat.recap).toEqual(['done_tasks', 'linked_commits', 'blocked_tasks']);
  });

  it('gives the repeat the four generic snapshot fields', () => {
    const repeat = snapshots.children.find((n): n is RepeatNode => n.kind === 'repeat')!;
    expect(fieldsIn(repeat.children).map((f) => f.id)).toEqual([
      'what_moved',
      'whats_blocked',
      'improvement',
      'next_action',
    ]);
  });

  it('keeps the per-item heading inside the repeat as prose', () => {
    const repeat = snapshots.children.find((n): n is RepeatNode => n.kind === 'repeat')!;
    const prose = repeat.children
      .filter((n) => n.kind === 'prose')
      .map((n) => (n.kind === 'prose' ? n.text : ''))
      .join('');
    expect(prose).toContain('### {{ context.name }}');
  });

  it('folds three per-context extras, each keyed by slug with its own field', () => {
    const extras = snapshots.children.filter((n): n is ExtraNode => n.kind === 'extra');
    expect(extras.map((e) => e.context)).toEqual([
      'offbeat-fm',
      'getwrite-development',
      'saboteur-pos',
    ]);
    expect(extras.map((e) => fieldsIn(e.children).map((f) => f.id))).toEqual([
      ['artist_profiles'],
      ['export_milestone'],
      ['release_signal'],
    ]);
  });

  it('folds the intentions-review table with its columns', () => {
    const table = doc.sections[1].children.find((n): n is TableNode => n.kind === 'table')!;
    expect(table.id).toBe('intentions_review');
    expect(table.rows).toBe('from:previous.intentions');
    expect(table.emptyMessage).toContain('No prior intentions on record');
    expect(table.columns.map((col) => col.id)).toEqual(['intention', 'outcome', 'why']);
    expect(table.columns[0].prompt).toBe(false);
    expect(table.columns[0].source).toBe('previous.intentions');
    expect(table.columns[1].values).toEqual(['held', 'partial', 'missed', 'dropped']);
  });

  it('folds the bandwidth table with its fixed rows and sum warning', () => {
    const table = doc.sections[4].children.find((n): n is TableNode => n.kind === 'table')!;
    expect(table.id).toBe('allocation');
    expect(table.rows).toBe('contexts+fixed');
    expect(table.exclude).toEqual(['inbox']);
    expect(table.warnUnlessSumsTo).toBe(100);
    expect(table.fixedRows).toEqual(['Job search / financial stability', 'Rest / recovery']);
  });

  it('captures each table markdown block as a placeholder, keeping its header row', () => {
    const tables = doc.sections.flatMap((s) => s.children.filter((n): n is TableNode => n.kind === 'table'));
    expect(tables).toHaveLength(2);
    expect(tables[0].placeholder).toContain('| Intention | Outcome | Why it did/didn\'t happen |');
    expect(tables[1].placeholder).toContain('| Area');
    // The placeholder is removed from the surrounding prose so a run renders the
    // filled table instead of a filled table beside a blank skeleton.
    const prose = doc.sections[1].children
      .filter((n) => n.kind === 'prose')
      .map((n) => (n.kind === 'prose' ? n.text : ''))
      .join('');
    expect(prose).not.toContain('| Intention |');
    expect(prose).toContain('Kaizen principle:');
  });
});

describe('extractTableBlock', () => {
  it('splits without losing the separating newlines', () => {
    const text = '\nlead in\n\n| a | b |\n| - | - |\n\ntrailer\n';
    const split = extractTableBlock(text)!;
    expect(split.block).toBe('| a | b |\n| - | - |');
    expect(split.before + split.block + split.after).toBe(text);
  });

  it('handles a table at the very start of a span', () => {
    const text = '| a |\nafter\n';
    const split = extractTableBlock(text)!;
    expect(split.before).toBe('');
    expect(split.before + split.block + split.after).toBe(text);
  });

  it('returns null when the span holds no table', () => {
    expect(extractTableBlock('just prose\n')).toBeNull();
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

  it('rejects an unclosed repeat, naming the section it is in', () => {
    const src =
      '<!-- sab:section id="project-snapshots" -->\n' +
      '<!-- sab:repeat id="projects" source="contexts" -->\n' +
      '<!-- sab:field id="what_moved" type="text" -->\n';
    expect(() => parse(src)).toThrow(/unclosed/);
    expect(() => parse(src)).toThrow(/project-snapshots/);
  });

  it('rejects an end-repeat with no matching repeat', () => {
    expect(() => parse('<!-- sab:section id="s" -->\n<!-- sab:end-repeat -->\n')).toThrow(
      /no matching/,
    );
  });

  it('rejects a nested repeat', () => {
    const src =
      '<!-- sab:section id="s" -->\n' +
      '<!-- sab:repeat id="a" source="contexts" -->\n' +
      '<!-- sab:repeat id="b" source="contexts" -->\n' +
      '<!-- sab:end-repeat -->\n<!-- sab:end-repeat -->\n';
    expect(() => parse(src)).toThrow(/nests/);
  });

  it('rejects a column outside any table', () => {
    expect(() => parse('<!-- sab:section id="s" -->\n<!-- sab:column id="c" -->\n')).toThrow(
      /outside any/,
    );
  });
});
