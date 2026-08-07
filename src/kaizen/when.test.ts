import { describe, expect, it } from 'vitest';
import {
  evaluateWhen,
  parseWhen,
  referencedFields,
  WhenSyntaxError,
  type AnswerLookup,
} from './when.js';

const answers = (map: Record<string, string | number>): AnswerLookup => (f) => map[f];
const check = (src: string, map: Record<string, string | number>) =>
  evaluateWhen(parseWhen(src), answers(map));

describe('parseWhen', () => {
  it('parses a numeric comparison', () => {
    expect(parseWhen('energy<=2')).toEqual({
      kind: 'comparison',
      field: 'energy',
      operator: '<=',
      value: '2',
    });
  });

  it('reads <= as one operator rather than < followed by =', () => {
    const expr = parseWhen('energy<=2');
    expect(expr.kind === 'comparison' && expr.operator).toBe('<=');
  });

  it('parses != without mistaking it for =', () => {
    const expr = parseWhen('matches_priorities!=Y');
    expect(expr).toMatchObject({ field: 'matches_priorities', operator: '!=', value: 'Y' });
  });

  it('parses a disjunction', () => {
    expect(parseWhen('energy<=2 or focus<=2')).toMatchObject({
      kind: 'or',
      left: { field: 'energy' },
      right: { field: 'focus' },
    });
  });

  it('binds and tighter than or', () => {
    const expr = parseWhen('a=1 or b=2 and c=3');
    expect(expr.kind).toBe('or');
    expect(expr.kind === 'or' && expr.right.kind).toBe('and');
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseWhen('  energy <= 2  ')).toMatchObject({ field: 'energy', value: '2' });
  });

  it('strips quotes from a value', () => {
    expect(parseWhen('word="rough week"')).toMatchObject({ value: 'rough week' });
  });

  it('reports every referenced field', () => {
    expect(referencedFields(parseWhen('energy<=2 or focus<=2'))).toEqual(['energy', 'focus']);
  });

  describe('rejects unsupported syntax at parse time', () => {
    it('an empty expression', () => {
      expect(() => parseWhen('   ')).toThrow(WhenSyntaxError);
    });

    it('a bare field with no comparison', () => {
      expect(() => parseWhen('energy')).toThrow(/not a supported condition/);
    });

    it('a comparison with no value', () => {
      expect(() => parseWhen('energy<=')).toThrow(/missing a value/);
    });

    it('an expression on the left of the operator', () => {
      expect(() => parseWhen('energy + focus <= 4')).toThrow(/single field id/);
    });
  });
});

describe('evaluateWhen', () => {
  it('compares numerically when both sides are numbers', () => {
    expect(check('energy<=2', { energy: 2 })).toBe(true);
    expect(check('energy<=2', { energy: 3 })).toBe(false);
    expect(check('energy<=2', { energy: '1' })).toBe(true);
  });

  it('compares strings case-insensitively for equality', () => {
    expect(check('matches_priorities!=Y', { matches_priorities: 'y' })).toBe(false);
    expect(check('matches_priorities!=Y', { matches_priorities: 'Partially' })).toBe(true);
    expect(check('matches_priorities=Y', { matches_priorities: 'Y' })).toBe(true);
  });

  it('evaluates or and and', () => {
    expect(check('energy<=2 or focus<=2', { energy: 5, focus: 1 })).toBe(true);
    expect(check('energy<=2 or focus<=2', { energy: 5, focus: 5 })).toBe(false);
    expect(check('energy<=2 and focus<=2', { energy: 1, focus: 5 })).toBe(false);
    expect(check('energy<=2 and focus<=2', { energy: 1, focus: 2 })).toBe(true);
  });

  it('is false when the referenced field is unanswered, whatever the operator', () => {
    // A follow-up predicated on information the user never gave should stay
    // quiet rather than fire on an absence.
    expect(check('energy<=2', {})).toBe(false);
    expect(check('matches_priorities!=Y', {})).toBe(false);
    expect(check('matches_priorities!=Y', { matches_priorities: '' })).toBe(false);
  });

  it('rejects ordering comparisons against non-numeric answers', () => {
    expect(() => check('week_word<=2', { week_word: 'grim' })).toThrow(WhenSyntaxError);
  });

  it('evaluates the template conditions against realistic answers', () => {
    expect(check('energy<=2 or focus<=2', { energy: 4, focus: 2 })).toBe(true);
    expect(check('matches_priorities!=Y', { matches_priorities: 'N' })).toBe(true);
    expect(check('matches_priorities!=Y', { matches_priorities: 'Y' })).toBe(false);
  });
});
