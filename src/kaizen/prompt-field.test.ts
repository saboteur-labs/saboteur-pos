import { describe, expect, it } from 'vitest';
import { promptField, PromptAbortedError, type FieldPrompt } from './prompt-field.js';

/** Scripted stdin: each call returns the next queued line. */
function scripted(lines: string[]) {
  const asked: string[] = [];
  let i = 0;
  return {
    asked,
    errors: [] as string[],
    ask: async (q: string) => {
      asked.push(q);
      return lines[i++] ?? '';
    },
  };
}

async function run(field: FieldPrompt, lines: string[]) {
  const io = scripted(lines);
  const errors: string[] = [];
  const value = await promptField(field, { ask: io.ask, write: (t) => errors.push(t) });
  return { value, errors, asked: io.asked };
}

describe('promptField — types', () => {
  it('scale accepts an in-range integer', async () => {
    const { value } = await run({ id: 'energy', type: 'scale', min: 1, max: 5 }, ['3']);
    expect(value).toBe('3');
  });

  it('scale re-prompts on out-of-range and non-integer input', async () => {
    const { value, errors } = await run({ id: 'energy', type: 'scale', min: 1, max: 5 }, [
      '9',
      'three',
      '4',
    ]);
    expect(value).toBe('4');
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('from 1 to 5');
    expect(errors[1]).toContain('whole number');
  });

  it('word rejects multiple words', async () => {
    const { value, errors } = await run({ id: 'w', type: 'word' }, ['two words', 'relentless']);
    expect(value).toBe('relentless');
    expect(errors[0]).toContain('single word');
  });

  it('enum matches case-insensitively and returns the declared casing', async () => {
    const { value } = await run(
      { id: 'outcome', type: 'enum', values: ['held', 'partial', 'missed'] },
      ['PARTIAL'],
    );
    expect(value).toBe('partial');
  });

  it('enum re-prompts on an unlisted value', async () => {
    const { value, errors } = await run(
      { id: 'outcome', type: 'enum', values: ['held', 'missed'] },
      ['maybe', 'held'],
    );
    expect(value).toBe('held');
    expect(errors[0]).toContain('held, missed');
  });

  it('percent accepts a bare number or a trailing %', async () => {
    expect((await run({ id: 'p', type: 'percent' }, ['20'])).value).toBe('20');
    expect((await run({ id: 'p', type: 'percent' }, ['35%'])).value).toBe('35');
  });

  it('percent rejects out-of-range values', async () => {
    const { value, errors } = await run({ id: 'p', type: 'percent' }, ['140', '40']);
    expect(value).toBe('40');
    expect(errors[0]).toContain('0 to 100');
  });

  it('date accepts a real calendar date', async () => {
    expect((await run({ id: 'd', type: 'date' }, ['2026-08-03'])).value).toBe('2026-08-03');
  });

  it('date rejects a well-formed but impossible date', async () => {
    // Date would roll 2026-02-30 into March, filing the review under a week
    // that never happened.
    const { value, errors } = await run({ id: 'd', type: 'date' }, ['2026-02-30', '2026-02-28']);
    expect(value).toBe('2026-02-28');
    expect(errors[0]).toContain('YYYY-MM-DD');
  });

  it('date rejects the wrong shape', async () => {
    const { value } = await run({ id: 'd', type: 'date' }, ['3 August', '2026-08-03']);
    expect(value).toBe('2026-08-03');
  });

  it('duration accepts common forms', async () => {
    expect((await run({ id: 't', type: 'duration' }, ['45m'])).value).toBe('45m');
    expect((await run({ id: 't', type: 'duration' }, ['1h'])).value).toBe('1h');
    expect((await run({ id: 't', type: 'duration' }, ['1h30m'])).value).toBe('1h30m');
  });

  it('duration rejects prose', async () => {
    const { value, errors } = await run({ id: 't', type: 'duration' }, ['about an hour', '60m']);
    expect(value).toBe('60m');
    expect(errors[0]).toContain('45m');
  });

  it('text accepts anything non-empty', async () => {
    expect((await run({ id: 't', type: 'text' }, ['whatever I like'])).value).toBe(
      'whatever I like',
    );
  });
});

describe('promptField — longtext', () => {
  it('reads lines until a blank one', async () => {
    const { value } = await run({ id: 'note', type: 'longtext' }, [
      'first line',
      'second line',
      '',
    ]);
    expect(value).toBe('first line\nsecond line');
  });

  it('returns empty when the first line is blank and the field is optional', async () => {
    const { value } = await run({ id: 'note', type: 'longtext' }, ['']);
    expect(value).toBe('');
  });
});

describe('promptField — required and defaults', () => {
  it('re-prompts an empty answer when required', async () => {
    const { value, errors } = await run({ id: 'f', type: 'text', required: true }, ['', 'finally']);
    expect(value).toBe('finally');
    expect(errors[0]).toContain('required');
  });

  it('accepts empty when optional and records it as unanswered', async () => {
    const { value } = await run({ id: 'f', type: 'text' }, ['']);
    expect(value).toBe('');
  });

  it('uses the default when the answer is empty', async () => {
    const { value } = await run(
      { id: 'week_of', type: 'date', defaultValue: '2026-08-03', required: true },
      [''],
    );
    expect(value).toBe('2026-08-03');
  });

  it('shows the default in the prompt', async () => {
    const { asked } = await run({ id: 'f', type: 'text', defaultValue: '45m' }, ['']);
    expect(asked[0]).toContain('[45m]');
  });

  it('lets an explicit answer override the default', async () => {
    const { value } = await run({ id: 'f', type: 'duration', defaultValue: '45m' }, ['20m']);
    expect(value).toBe('20m');
  });
});

describe('promptField — prompt text', () => {
  it('uses the label when given, and the id otherwise', async () => {
    expect((await run({ id: 'energy', type: 'text', label: 'Energy level' }, ['x'])).asked[0]).toContain(
      'Energy level',
    );
    expect((await run({ id: 'energy', type: 'text' }, ['x'])).asked[0]).toContain('energy');
  });

  it('hints the accepted range or options', async () => {
    expect((await run({ id: 'e', type: 'scale', min: 1, max: 5 }, ['3'])).asked[0]).toContain('1');
    expect(
      (await run({ id: 'o', type: 'enum', values: ['held', 'missed'] }, ['held'])).asked[0],
    ).toContain('held / missed');
  });
});

describe('promptField — loop guard', () => {
  it('gives up rather than spinning when input never satisfies the field', async () => {
    // ask() resolves to '' once stdin is exhausted, so a required field on piped
    // input would otherwise re-prompt forever.
    const io = scripted([]);
    await expect(
      promptField(
        { id: 'f', type: 'text', required: true },
        { ask: io.ask, write: () => {}, maxAttempts: 3 },
      ),
    ).rejects.toThrow(PromptAbortedError);
    expect(io.asked).toHaveLength(3);
  });
});
