/**
 * Conditional-prompt expressions (`when="energy<=2 or focus<=2"`).
 *
 * Deliberately tiny: comparisons against a single prior field, joined by `and`
 * / `or`. Anything richer belongs in the template author's head, not in a
 * expression language nobody asked for — and a template that can branch
 * arbitrarily stops being reviewable at a glance.
 *
 * Parsing is separate from evaluation so a malformed condition fails during
 * validation, before the first question is asked, rather than midway through a
 * review.
 */

export type ComparisonOperator = '=' | '!=' | '<' | '<=' | '>' | '>=';

export interface Comparison {
  kind: 'comparison';
  field: string;
  operator: ComparisonOperator;
  value: string;
}

export interface Junction {
  kind: 'and' | 'or';
  left: WhenExpression;
  right: WhenExpression;
}

export type WhenExpression = Comparison | Junction;

export class WhenSyntaxError extends Error {}

/** Answers collected so far. `undefined` means the field was not answered. */
export type AnswerLookup = (field: string) => string | number | undefined;

// Longest first, so `<=` is not read as `<` followed by a stray `=`.
const OPERATORS: ComparisonOperator[] = ['!=', '<=', '>=', '=', '<', '>'];

/**
 * Parse a `when` expression. `and` binds tighter than `or`, matching every
 * other language a template author is likely to have in mind.
 */
export function parseWhen(source: string): WhenExpression {
  const trimmed = source.trim();
  if (trimmed === '') {
    throw new WhenSyntaxError('Empty when expression.');
  }

  const orParts = splitOn(trimmed, 'or');
  if (orParts.length > 1) {
    return orParts
      .map((p) => parseWhen(p))
      .reduce((left, right) => ({ kind: 'or', left, right }));
  }

  const andParts = splitOn(trimmed, 'and');
  if (andParts.length > 1) {
    return andParts
      .map((p) => parseWhen(p))
      .reduce((left, right) => ({ kind: 'and', left, right }));
  }

  return parseComparison(trimmed);
}

/** Split on a bare keyword, ignoring occurrences inside a longer word. */
function splitOn(source: string, keyword: string): string[] {
  const parts: string[] = [];
  const pattern = new RegExp(`\\s+${keyword}\\s+`, 'g');
  let last = 0;
  for (let m = pattern.exec(source); m !== null; m = pattern.exec(source)) {
    parts.push(source.slice(last, m.index));
    last = m.index + m[0].length;
  }
  parts.push(source.slice(last));
  return parts;
}

function parseComparison(source: string): Comparison {
  for (const operator of OPERATORS) {
    const at = source.indexOf(operator);
    if (at === -1) continue;

    const field = source.slice(0, at).trim();
    const value = source.slice(at + operator.length).trim();

    if (!/^[a-zA-Z_][\w-]*$/.test(field)) {
      throw new WhenSyntaxError(
        `'${source.trim()}' must compare a single field id — found '${field}' on the left.`,
      );
    }
    if (value === '') {
      throw new WhenSyntaxError(`'${source.trim()}' is missing a value after '${operator}'.`);
    }
    return { kind: 'comparison', field, operator, value: stripQuotes(value) };
  }

  throw new WhenSyntaxError(
    `'${source.trim()}' is not a supported condition. ` +
      `Use a comparison such as 'energy<=2' or 'matches_priorities!=Y', joined by 'and' / 'or'.`,
  );
}

function stripQuotes(value: string): string {
  const quoted = /^"(.*)"$|^'(.*)'$/.exec(value);
  return quoted ? (quoted[1] ?? quoted[2]) : value;
}

/** Every field id referenced by an expression. */
export function referencedFields(expr: WhenExpression): string[] {
  return expr.kind === 'comparison'
    ? [expr.field]
    : [...referencedFields(expr.left), ...referencedFields(expr.right)];
}

/**
 * Evaluate an expression against the answers collected so far.
 *
 * An unanswered field makes its comparison false, whatever the operator. The
 * alternative — treating "no answer" as not-equal — would fire follow-up
 * questions predicated on information the user never gave, which is a strange
 * thing to be asked. Conditions here gate extra prompts, so the safe default is
 * to stay quiet.
 */
export function evaluateWhen(expr: WhenExpression, lookup: AnswerLookup): boolean {
  if (expr.kind !== 'comparison') {
    return expr.kind === 'and'
      ? evaluateWhen(expr.left, lookup) && evaluateWhen(expr.right, lookup)
      : evaluateWhen(expr.left, lookup) || evaluateWhen(expr.right, lookup);
  }

  const answer = lookup(expr.field);
  if (answer === undefined || answer === '') return false;

  const left = Number(answer);
  const right = Number(expr.value);
  const numeric = !Number.isNaN(left) && !Number.isNaN(right) && String(answer).trim() !== '';

  if (numeric) {
    switch (expr.operator) {
      case '=':
        return left === right;
      case '!=':
        return left !== right;
      case '<':
        return left < right;
      case '<=':
        return left <= right;
      case '>':
        return left > right;
      case '>=':
        return left >= right;
    }
  }

  const a = String(answer).trim().toLowerCase();
  const b = expr.value.trim().toLowerCase();
  switch (expr.operator) {
    case '=':
      return a === b;
    case '!=':
      return a !== b;
    default:
      throw new WhenSyntaxError(
        `Cannot apply '${expr.operator}' to the non-numeric answer '${answer}' for '${expr.field}'.`,
      );
  }
}
