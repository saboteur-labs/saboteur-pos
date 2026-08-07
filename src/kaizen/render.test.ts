import { describe, expect, it } from 'vitest';
import { loadKaizenTemplate } from './loader.js';
import { findShippedTemplate } from './paths.js';
import { parse, tokenize } from './parse.js';
import { expand } from './expand.js';
import { render } from './render.js';

const BODY = loadKaizenTemplate({ configPath: '/unused', templatePath: findShippedTemplate() }).body;
const doc = parse(BODY);

const CONTEXTS = [
  { slug: 'inbox', name: 'Inbox' },
  { slug: 'getwrite-development', name: 'GetWrite' },
  { slug: 'offbeat-fm', name: 'OffBeat-FM' },
];

/**
 * Every context the template declares an extra for. Preservation is checked
 * against this list so no per-context prompt is legitimately absent — an extra
 * whose slug matches no context is dropped by design, which would otherwise
 * look like the renderer losing a line.
 */
const ALL_CONTEXTS = [...CONTEXTS, { slug: 'saboteur-pos', name: 'Saboteur POS' }];

const expanded = (previousIntentions?: string[], contexts = CONTEXTS) =>
  expand(doc, { contexts, previousIntentions });

const renderWith = (
  answers: Record<string, string>,
  opts: {
    skips?: Record<string, string>;
    previousIntentions?: string[];
    contexts?: typeof CONTEXTS;
  } = {},
) =>
  render(expanded(opts.previousIntentions, opts.contexts), { answers, skips: opts.skips });

/**
 * Prose lines from the template that the renderer is expected to reproduce
 * untouched. Table rows, empty list stubs, and `{{ }}` lines are excluded:
 * those are placeholders the renderer is explicitly supposed to replace.
 */
function preservedTemplateLines(): string[] {
  return tokenize(BODY)
    .filter((t) => t.kind === 'prose')
    .flatMap((t) => (t.kind === 'prose' ? t.text.split('\n') : []))
    .filter((line) => line.trim() !== '')
    .filter((line) => !line.trimStart().startsWith('|'))
    .filter((line) => !/^\s*\d+\.\s*$/.test(line))
    .filter((line) => !line.includes('{{'));
}

describe('render — byte-for-byte prose preservation', () => {
  it('reproduces every preserved template line exactly, when nothing is answered', () => {
    const outputLines = new Set(renderWith({}, { contexts: ALL_CONTEXTS }).split('\n'));
    const missing = preservedTemplateLines().filter((line) => !outputLines.has(line));
    expect(missing).toEqual([]);
  });

  it('still reproduces every prompt line when answers are present', () => {
    const output = renderWith(
      {
        energy: '4',
        focus: '2',
        week_word: 'relentless',
        kaizen_answer: 'Stop context switching mid-morning.',
        honest_note: 'I am avoiding the pricing decision.',
        matches_priorities: 'N',
        'projects.offbeat-fm.what_moved': 'Three artist profiles claimed.',
      },
      { contexts: ALL_CONTEXTS },
    ).split('\n');

    // A prompt line either survives untouched or gains its answer on the end.
    const missing = preservedTemplateLines().filter(
      (line) => !output.some((out) => out === line || out.startsWith(`${line} `)),
    );
    expect(missing).toEqual([]);
  });

  it('preserves the Kaizen framing quotes and instructional asides verbatim', () => {
    const output = renderWith({});
    expect(output).toContain(
      '> Kaizen principle: a missed intention is not a failure — it\'s data. The question is always _why_, not _whether_.',
    );
    expect(output).toContain('> Fewer is better. An unrealistic intentions list is just a shame generator.');
    expect(output).toContain(
      '_"Small, consistent improvements compound faster than invisible perfection."_',
    );
    expect(output).toContain('Gaman is endurance with dignity — not ignoring the signal.');
  });

  it('emits no sab directives', () => {
    expect(renderWith({ energy: '3' })).not.toContain('sab:');
  });

  it('keeps the template spacing rather than leaving a gap where each directive was', () => {
    // A directive sits on its own line with a blank line after it. Removing only
    // the comment would leave two blank lines between every pair of prompts.
    const output = renderWith({ energy: '3', focus: '2' });
    expect(output).toContain(
      '- **Energy level this week (1–5):** 3\n\n- **Focus quality this week (1–5):** 2',
    );
  });

  it('renders a followup beneath its instruction, not appended to it', () => {
    // The follow-up hangs off a blockquote instruction, not a fill-in label, so
    // an inline answer would run onto the end of that sentence.
    const output = renderWith({ energy: '1', low_score_note: 'Lost Tuesday to context switching.' });
    expect(output).toContain(
      'not ignoring the signal.\n\nLost Tuesday to context switching.',
    );
  });

  it('keeps the template heading structure', () => {
    const output = renderWith({});
    for (const heading of [
      '# Kaizen Weekly Review',
      '## 1. Pulse Check (5 min)',
      '## 4. The Kaizen Question (5 min)',
      '## 7. One Honest Note (2 min)',
    ]) {
      expect(output).toContain(heading);
    }
  });
});

describe('render — answers', () => {
  it('appends an inline answer to its prompt line', () => {
    expect(renderWith({ energy: '4' })).toContain('- **Energy level this week (1–5):** 4');
  });

  it('puts a longtext answer beneath its prompt, not on the same line', () => {
    const output = renderWith({ kaizen_answer: 'Stop context switching.\nProtect mornings.' });
    expect(output).toContain('_Answer here:_\n\nStop context switching.\nProtect mornings.');
  });

  it('renders an unanswered optional field as a bare prompt rather than dropping it', () => {
    const output = renderWith({});
    expect(output).toContain("- **What's blocked:**");
    expect(output).toContain('- **One word that describes the week:**');
  });

  it('answers per-context fields under their own context', () => {
    const output = renderWith({
      'projects.offbeat-fm.what_moved': 'Artist outreach',
      'projects.getwrite-development.what_moved': 'PDF export',
    });
    expect(output).toContain('### OffBeat-FM');
    expect(output).toContain('- **What moved:** Artist outreach');
    expect(output).toContain('- **What moved:** PDF export');
    expect(output).not.toContain('{{');
  });

  it('renders a per-context extra prompt only under its own context', () => {
    const output = renderWith({ 'projects.offbeat-fm.artist_profiles': '3 new, 1 claimed' });
    expect(output).toContain('- **Artist profiles this week (new / claimed):** 3 new, 1 claimed');
    expect(output.match(/Artist profiles this week/g)).toHaveLength(1);
  });
});

describe('render — skipped projects', () => {
  it('records the skip reason in place of the prompts', () => {
    const output = renderWith(
      {},
      { skips: { 'projects.offbeat-fm': 'No movement — deprioritized' } },
    );
    expect(output).toContain('### OffBeat-FM');
    expect(output).toContain('_Skipped — No movement — deprioritized_');
  });

  it('does not emit the skipped project prompts', () => {
    const output = renderWith({}, { skips: { 'projects.offbeat-fm': 'deprioritized' } });
    // GetWrite is not skipped, so its prompts remain — exactly one copy.
    expect(output.match(/- \*\*What moved:\*\*/g)).toHaveLength(1);
  });

  it('leaves unskipped projects fully prompted', () => {
    const output = renderWith({}, { skips: { 'projects.offbeat-fm': 'deprioritized' } });
    expect(output).toContain('### GetWrite');
    expect(output).toContain('- **Export milestone status:**');
  });
});

describe('render — tables', () => {
  it('keeps the header row wording and fills generated rows', () => {
    const output = renderWith(
      {
        'intentions_review.0.outcome': 'held',
        'intentions_review.0.why': 'protected the mornings',
      },
      { previousIntentions: ['Ship the kaizen command'] },
    );
    expect(output).toContain("| Intention | Outcome | Why it did/didn't happen |");
    expect(output).toContain('| Ship the kaizen command | held | protected the mornings |');
  });

  it('leaves no empty skeleton row beside the filled rows', () => {
    const output = renderWith(
      { 'intentions_review.0.outcome': 'held', 'intentions_review.0.why': 'x' },
      { previousIntentions: ['Ship it'] },
    );
    expect(output).not.toContain('|           |         |                          |');
  });

  it('renders the empty message instead of a table when there are no rows', () => {
    const output = renderWith({});
    expect(output).toContain('_No prior intentions on record');
    expect(output).not.toContain('| Intention | Outcome |');
  });

  it('uses the row label for the non-prompted column of the bandwidth table', () => {
    const output = renderWith({
      'allocation.offbeat-fm.percent': '40',
      'allocation.Rest / recovery.percent': '10',
    });
    expect(output).toContain('| OffBeat-FM | 40 |');
    expect(output).toContain('| Rest / recovery | 10 |');
  });

  it('escapes a pipe in an answer so it cannot split the cell', () => {
    const output = renderWith(
      { 'intentions_review.0.outcome': 'held', 'intentions_review.0.why': 'a | b' },
      { previousIntentions: ['x'] },
    );
    expect(output).toContain('| x | held | a \\| b |');
  });

  it('flattens a multi-line answer into one cell', () => {
    const output = renderWith(
      { 'intentions_review.0.outcome': 'held', 'intentions_review.0.why': 'one\ntwo' },
      { previousIntentions: ['x'] },
    );
    expect(output).toContain('| x | held | one two |');
  });
});

describe('render — intentions list', () => {
  it('replaces the empty stub with the intentions given', () => {
    const output = renderWith({
      'intentions.0': 'Ship kaizen',
      'intentions.1': 'Rest properly',
    });
    expect(output).toContain('1. Ship kaizen');
    expect(output).toContain('2. Rest properly');
    // The stub must not survive alongside them.
    expect(output).not.toMatch(/^3\.\s*$/m);
  });

  it('keeps the stub when no intentions were given', () => {
    const output = renderWith({});
    expect(output).toMatch(/^1\.\s*$/m);
  });

  it('renumbers around a blank entry rather than leaving a gap', () => {
    const output = renderWith({
      'intentions.0': 'First',
      'intentions.1': '',
      'intentions.2': 'Second',
    });
    expect(output).toContain('1. First');
    expect(output).toContain('2. Second');
  });
});
