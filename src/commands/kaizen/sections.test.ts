import { describe, expect, it } from 'vitest';
import { loadKaizenTemplate } from '../../kaizen/loader.js';
import { findShippedTemplate } from '../../kaizen/paths.js';
import { parse } from '../../kaizen/parse.js';
import { expand, type ExpandedTableNode } from '../../kaizen/expand.js';
import { promptTable } from './sections.js';

const BODY = loadKaizenTemplate({ configPath: '/unused', templatePath: findShippedTemplate() }).body;
const doc = parse(BODY);

const CONTEXTS = [
  { slug: 'inbox', name: 'Inbox' },
  { slug: 'getwrite-development', name: 'GetWrite' },
  { slug: 'offbeat-fm', name: 'OffBeat-FM' },
];

function tableFrom(section: number, previousIntentions?: string[]): ExpandedTableNode {
  const expanded = expand(doc, { contexts: CONTEXTS, previousIntentions });
  return expanded.sections[section].children.find(
    (n): n is ExpandedTableNode => n.kind === 'expanded-table',
  )!;
}

function scripted(lines: string[]) {
  const asked: string[] = [];
  const printed: string[] = [];
  let i = 0;
  return {
    asked,
    printed,
    options: {
      ask: async (q: string) => {
        asked.push(q);
        return lines[i++] ?? '';
      },
      write: () => {},
      print: (t: string) => printed.push(t),
    },
  };
}

describe('section 2 — intentions review', () => {
  it('prompts only outcome and why, prefilling the intention', async () => {
    const table = tableFrom(1, ['Ship kaizen', 'Rest properly']);
    const io = scripted(['held', 'made time for it', 'missed', 'ran out of week']);

    const { answers } = await promptTable(table, io.options);

    expect(answers['intentions_review.0.intention']).toBe('Ship kaizen');
    expect(answers['intentions_review.0.outcome']).toBe('held');
    expect(answers['intentions_review.0.why']).toBe('made time for it');
    expect(answers['intentions_review.1.intention']).toBe('Rest properly');
    expect(answers['intentions_review.1.outcome']).toBe('missed');

    // Four questions for two rows — the intention itself is never asked.
    expect(io.asked).toHaveLength(4);
  });

  it('shows each intention as the row heading so the user knows what they are judging', async () => {
    const table = tableFrom(1, ['Ship kaizen']);
    const io = scripted(['held', 'done']);
    await promptTable(table, io.options);
    expect(io.printed.join('')).toContain('Ship kaizen');
  });

  it('re-prompts an outcome outside the declared enum', async () => {
    const table = tableFrom(1, ['Ship kaizen']);
    const io = scripted(['maybe', 'partial', 'half of it']);
    const { answers } = await promptTable(table, io.options);
    expect(answers['intentions_review.0.outcome']).toBe('partial');
  });

  it('prints the empty message and asks nothing when there are no prior intentions', async () => {
    const table = tableFrom(1);
    const io = scripted([]);

    const { answers } = await promptTable(table, io.options);

    expect(answers).toEqual({});
    expect(io.asked).toEqual([]);
    expect(io.printed.join('')).toContain('No prior intentions on record');
  });
});

describe('section 5 — bandwidth audit', () => {
  it('prompts a percentage for every generated and fixed row', async () => {
    const table = tableFrom(4);
    const io = scripted(['40', '30', '20', '10']);

    const { answers, warnings } = await promptTable(table, io.options);

    expect(answers['allocation.getwrite-development.percent']).toBe('40');
    expect(answers['allocation.offbeat-fm.percent']).toBe('30');
    expect(answers['allocation.Job search / financial stability.percent']).toBe('20');
    expect(answers['allocation.Rest / recovery.percent']).toBe('10');
    expect(warnings).toEqual([]);
  });

  it('warns without blocking when the total is not 100', async () => {
    const table = tableFrom(4);
    const io = scripted(['40', '30', '10', '5']);

    const { answers, warnings } = await promptTable(table, io.options);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('85%');
    // The answers are still collected — a rough estimate is the point.
    expect(answers['allocation.getwrite-development.percent']).toBe('40');
  });

  it('does not warn when nothing was answered at all', async () => {
    const table = tableFrom(4);
    const io = scripted(['', '', '', '']);
    const { warnings } = await promptTable(table, io.options);
    expect(warnings).toEqual([]);
  });

  it('re-prompts a percentage above 100', async () => {
    const table = tableFrom(4);
    const io = scripted(['140', '100', '0', '0', '0']);
    const { answers } = await promptTable(table, io.options);
    expect(answers['allocation.getwrite-development.percent']).toBe('100');
  });

  it('labels rows by context name, not slug', async () => {
    const table = tableFrom(4);
    const io = scripted(['25', '25', '25', '25']);
    await promptTable(table, io.options);
    const printed = io.printed.join('');
    expect(printed).toContain('GetWrite');
    expect(printed).toContain('OffBeat-FM');
    expect(printed).not.toContain('getwrite-development');
  });

  it('excludes inbox from the rows it prompts', async () => {
    const table = tableFrom(4);
    const io = scripted(['25', '25', '25', '25']);
    await promptTable(table, io.options);
    expect(io.printed.join('')).not.toContain('Inbox');
  });
});
