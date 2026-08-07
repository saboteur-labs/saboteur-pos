import { describe, expect, it } from 'vitest';
import { loadKaizenTemplate } from './loader.js';
import { findShippedTemplate } from './paths.js';
import { parse, type FieldNode } from './parse.js';
import {
  cellAnswerKey,
  expand,
  itemAnswerKey,
  type ExpandedRepeatNode,
  type ExpandedTableNode,
  type ExpandOptions,
} from './expand.js';

const BODY = loadKaizenTemplate({ configPath: '/unused', templatePath: findShippedTemplate() }).body;
const doc = parse(BODY);

/** The user's real contexts, minus inbox, in the order `sab context list` gives. */
const CONTEXTS = [
  { slug: 'biz-opps', name: 'Business / Operations' },
  { slug: 'claude-microdriver', name: 'Claude Microdriver' },
  { slug: 'getwrite-development', name: 'GetWrite' },
  { slug: 'inbox', name: 'Inbox' },
  { slug: 'offbeat-fm', name: 'OffBeat-FM' },
  { slug: 'otocho', name: 'Otocho' },
  { slug: 'saboteur-pos', name: 'Saboteur POS' },
  { slug: 'saboteur-sites', name: 'Saboteur Sites' },
];

const run = (options: Partial<ExpandOptions> = {}) =>
  expand(doc, { contexts: CONTEXTS, ...options });

const repeatIn = (d: ReturnType<typeof run>, section: number) =>
  d.sections[section].children.find((n): n is ExpandedRepeatNode => n.kind === 'expanded-repeat')!;
const tableIn = (d: ReturnType<typeof run>, section: number) =>
  d.sections[section].children.find((n): n is ExpandedTableNode => n.kind === 'expanded-table')!;

describe('expand — project snapshots', () => {
  it('produces one item per non-inbox context, in alpha order by slug', () => {
    const repeat = repeatIn(run(), 2);
    expect(repeat.items.map((i) => i.key)).toEqual([
      'biz-opps',
      'claude-microdriver',
      'getwrite-development',
      'offbeat-fm',
      'otocho',
      'saboteur-pos',
      'saboteur-sites',
    ]);
  });

  it('carries the skip policy and recap request from the directive', () => {
    const repeat = repeatIn(run(), 2);
    expect(repeat.skippable).toBe(true);
    expect(repeat.skipReason).toBe('required');
    expect(repeat.recap).toEqual(['done_tasks', 'linked_commits', 'blocked_tasks']);
  });

  it('substitutes the context name into each item heading', () => {
    const repeat = repeatIn(run(), 2);
    const headingOf = (key: string) =>
      repeat.items
        .find((i) => i.key === key)!
        .children.filter((n) => n.kind === 'prose')
        .map((n) => (n.kind === 'prose' ? n.text : ''))
        .join('');
    expect(headingOf('offbeat-fm')).toContain('### OffBeat-FM');
    expect(headingOf('otocho')).toContain('### Otocho');
    expect(headingOf('otocho')).not.toContain('{{');
  });

  it('gives every item the four generic fields', () => {
    const repeat = repeatIn(run(), 2);
    for (const item of repeat.items) {
      const ids = item.children.filter((n): n is FieldNode => n.kind === 'field').map((f) => f.id);
      expect(ids.slice(0, 4)).toEqual([
        'what_moved',
        'whats_blocked',
        'improvement',
        'next_action',
      ]);
    }
  });

  it('appends per-context extras only to their own context', () => {
    const repeat = repeatIn(run(), 2);
    const fieldIds = (key: string) =>
      repeat.items
        .find((i) => i.key === key)!
        .children.filter((n): n is FieldNode => n.kind === 'field')
        .map((f) => f.id);

    expect(fieldIds('offbeat-fm')).toContain('artist_profiles');
    expect(fieldIds('getwrite-development')).toContain('export_milestone');
    expect(fieldIds('saboteur-pos')).toContain('release_signal');

    expect(fieldIds('otocho')).toEqual(['what_moved', 'whats_blocked', 'improvement', 'next_action']);
    expect(fieldIds('offbeat-fm')).not.toContain('export_milestone');
  });

  it('drops an extra whose slug matches no context, silently', () => {
    // Retiring a project must not require a template edit, so an orphaned extra
    // is not an error — but it must also not leak into another context.
    const without = expand(doc, { contexts: CONTEXTS.filter((c) => c.slug !== 'offbeat-fm') });
    const repeat = repeatIn(without, 2);
    expect(repeat.items.map((i) => i.key)).not.toContain('offbeat-fm');
    const allFieldIds = repeat.items.flatMap((i) =>
      i.children.filter((n): n is FieldNode => n.kind === 'field').map((f) => f.id),
    );
    expect(allFieldIds).not.toContain('artist_profiles');
    expect(without.warnings).toEqual([]);
  });

  it('does not let the last extra pull the section separator into one context', () => {
    // sab:extra has no terminator, so it swallows to the end of the section. The
    // closing `---` belongs to the section and must not appear under whichever
    // context happens to be declared last.
    const repeat = repeatIn(run(), 2);
    for (const item of repeat.items) {
      const prose = item.children
        .filter((n) => n.kind === 'prose')
        .map((n) => (n.kind === 'prose' ? n.text : ''))
        .join('');
      expect(prose.trimEnd().endsWith('---')).toBe(false);
    }
  });

  it('keeps the section separator once, outside the repeat', () => {
    const sectionProse = run()
      .sections[2].children.filter((n) => n.kind === 'prose')
      .map((n) => (n.kind === 'prose' ? n.text : ''))
      .join('');
    expect(sectionProse).toContain('---');
  });

  it('leaves no extra nodes in the tree', () => {
    const expanded = run();
    const kinds = expanded.sections.flatMap((s) => s.children.map((n) => n.kind));
    expect(kinds).not.toContain('extra');
    expect(kinds).not.toContain('repeat');
  });

  it('produces no items when every context is excluded', () => {
    const empty = expand(doc, { contexts: [{ slug: 'inbox', name: 'Inbox' }] });
    expect(repeatIn(empty, 2).items).toEqual([]);
  });
});

describe('expand — bandwidth table', () => {
  it('lists context rows followed by the fixed rows', () => {
    const table = tableIn(run(), 4);
    expect(table.rows.map((r) => r.label)).toEqual([
      'Business / Operations',
      'Claude Microdriver',
      'GetWrite',
      'OffBeat-FM',
      'Otocho',
      'Saboteur POS',
      'Saboteur Sites',
      'Job search / financial stability',
      'Rest / recovery',
    ]);
  });

  it('preserves the fixed rows wording exactly and marks them as fixed', () => {
    const fixed = tableIn(run(), 4).rows.filter((r) => r.fixed);
    expect(fixed.map((r) => r.label)).toEqual([
      'Job search / financial stability',
      'Rest / recovery',
    ]);
  });

  it('excludes inbox from the generated rows', () => {
    expect(tableIn(run(), 4).rows.map((r) => r.key)).not.toContain('inbox');
  });

  it('carries the sum warning threshold', () => {
    expect(tableIn(run(), 4).warnUnlessSumsTo).toBe(100);
  });
});

describe('expand — intentions review table', () => {
  it('produces one row per prior intention, prefilling the intention column', () => {
    const table = tableIn(run({ previousIntentions: ['Ship kaizen', 'Rest properly'] }), 1);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].prefilled).toEqual({ intention: 'Ship kaizen' });
    expect(table.rows[1].label).toBe('Rest properly');
  });

  it('produces no rows when there are no prior intentions', () => {
    const table = tableIn(run(), 1);
    expect(table.rows).toEqual([]);
    expect(table.emptyMessage).toContain('No prior intentions on record');
  });

  it('keeps the columns the user still has to answer', () => {
    const table = tableIn(run({ previousIntentions: ['a'] }), 1);
    expect(table.columns.filter((col) => col.prompt).map((col) => col.id)).toEqual([
      'outcome',
      'why',
    ]);
  });
});

describe('expand — answer keys', () => {
  it('namespaces per-item answers by repeat and context', () => {
    expect(itemAnswerKey('projects', 'offbeat-fm', 'what_moved')).toBe(
      'projects.offbeat-fm.what_moved',
    );
  });

  it('namespaces table cells by table and row', () => {
    expect(cellAnswerKey('allocation', 'otocho', 'percent')).toBe('allocation.otocho.percent');
  });
});

describe('expand — warnings', () => {
  it('warns about an unknown row source rather than failing', () => {
    const custom = parse(
      '<!-- sab:section id="s" -->\n<!-- sab:table id="t" rows="planets" -->\n<!-- sab:column id="c" -->\n',
    );
    const expanded = expand(custom, { contexts: CONTEXTS });
    expect(expanded.warnings[0]).toContain("unknown row source 'planets'");
    expect(
      (expanded.sections[0].children.find((n) => n.kind === 'expanded-table') as ExpandedTableNode)
        .rows,
    ).toEqual([]);
  });

  it('carries parser warnings through', () => {
    const custom = parse('<!-- sab:section id="s" -->\n<!-- sab:nonsense -->\n');
    expect(expand(custom, { contexts: [] }).warnings).toHaveLength(1);
  });
});
