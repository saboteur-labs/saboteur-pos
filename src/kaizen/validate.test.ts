import { describe, expect, it } from 'vitest';
import { loadKaizenTemplate } from './loader.js';
import { findShippedTemplate } from './paths.js';
import { parse } from './parse.js';
import { KaizenValidationError, REQUIRED_SECTIONS, validate } from './validate.js';

const BODY = loadKaizenTemplate({ configPath: '/unused', templatePath: findShippedTemplate() }).body;

/** Build a minimal template that satisfies the section requirement. */
function template(...extra: string[]): string {
  return [...REQUIRED_SECTIONS.map((id) => `<!-- sab:section id="${id}" -->\n`), ...extra].join('');
}

const check = (src: string) => validate(parse(src));

describe('validate — shipped template', () => {
  it('passes clean', () => {
    expect(() => validate(parse(BODY))).not.toThrow();
  });
});

describe('validate — required sections', () => {
  it('accepts a template with all seven sections', () => {
    expect(() => check(template())).not.toThrow();
  });

  it('names a single missing section', () => {
    const src = REQUIRED_SECTIONS.filter((id) => id !== 'bandwidth')
      .map((id) => `<!-- sab:section id="${id}" -->\n`)
      .join('');
    expect(() => check(src)).toThrow(/missing required section: bandwidth/);
  });

  it('names all missing sections at once', () => {
    expect(() => check('<!-- sab:section id="pulse-check" -->\n')).toThrow(
      /missing required sections:/,
    );
  });
});

describe('validate — id uniqueness', () => {
  it('rejects two fields sharing an id', () => {
    expect(() =>
      check(template('<!-- sab:field id="dup" type="text" -->\n<!-- sab:field id="dup" type="text" -->\n')),
    ).toThrow(/Duplicate id 'dup'/);
  });

  it('rejects duplicate column ids within a table', () => {
    expect(() =>
      check(
        template(
          '<!-- sab:table id="t" -->\n<!-- sab:column id="c" -->\n<!-- sab:column id="c" -->\n',
        ),
      ),
    ).toThrow(/Duplicate id 'c' in table 't'/);
  });

  it('rejects an extra whose field collides with the repeat it extends', () => {
    // The extra's fields are appended to the same per-item answer namespace, so a
    // collision would silently overwrite the generic answer for one context.
    expect(() =>
      check(
        template(
          '<!-- sab:repeat id="r" source="contexts" -->\n' +
            '<!-- sab:field id="what_moved" type="text" -->\n' +
            '<!-- sab:end-repeat -->\n' +
            '<!-- sab:extra context="offbeat-fm" -->\n' +
            '<!-- sab:field id="what_moved" type="text" -->\n',
        ),
      ),
    ).toThrow(/Duplicate id 'what_moved' in context 'offbeat-fm' extras/);
  });

  it('allows two different extras to reuse an id, since each is a separate item', () => {
    expect(() =>
      check(
        template(
          '<!-- sab:repeat id="r" source="contexts" -->\n' +
            '<!-- sab:field id="what_moved" type="text" -->\n' +
            '<!-- sab:end-repeat -->\n' +
            '<!-- sab:extra context="a" -->\n<!-- sab:field id="metric" type="text" -->\n' +
            '<!-- sab:extra context="b" -->\n<!-- sab:field id="metric" type="text" -->\n',
        ),
      ),
    ).not.toThrow();
  });
});

describe('validate — field attributes', () => {
  it('rejects an unknown field type', () => {
    expect(() => check(template('<!-- sab:field id="f" type="haiku" -->\n'))).toThrow(
      /unknown type 'haiku'/,
    );
  });

  it('rejects an enum with no values', () => {
    expect(() => check(template('<!-- sab:field id="f" type="enum" -->\n'))).toThrow(
      /enum but declares no 'values'/,
    );
  });

  it('rejects a scale with no bounds', () => {
    expect(() => check(template('<!-- sab:field id="f" type="scale" -->\n'))).toThrow(
      /scale but declares no 'min'/,
    );
  });

  it('rejects a scale with non-numeric bounds', () => {
    expect(() =>
      check(template('<!-- sab:field id="f" type="scale" min="one" max="5" -->\n')),
    ).toThrow(/non-numeric 'min'/);
  });

  it('rejects an inverted scale', () => {
    expect(() =>
      check(template('<!-- sab:field id="f" type="scale" min="5" max="1" -->\n')),
    ).toThrow(/not below max/);
  });

  it('rejects an enum column with no values', () => {
    expect(() =>
      check(template('<!-- sab:table id="t" -->\n<!-- sab:column id="c" type="enum" -->\n')),
    ).toThrow(/enum but declares no 'values'/);
  });
});

describe('validate — conditions', () => {
  const withFields = (...fields: string[]) => template(...fields);

  it('accepts a condition on an earlier field', () => {
    expect(() =>
      check(
        withFields(
          '<!-- sab:field id="energy" type="scale" min="1" max="5" -->\n',
          '<!-- sab:field id="note" type="text" when="energy<=2" -->\n',
        ),
      ),
    ).not.toThrow();
  });

  it('rejects a condition referencing an unknown field', () => {
    expect(() =>
      check(withFields('<!-- sab:field id="note" type="text" when="nonexistent=1" -->\n')),
    ).toThrow(/referencing unknown field 'nonexistent'/);
  });

  it('rejects a condition referencing a field prompted later', () => {
    // Such a condition could never hold when checked, silently suppressing its
    // prompt forever — worth failing loudly at load time.
    expect(() =>
      check(
        withFields(
          '<!-- sab:field id="note" type="text" when="energy<=2" -->\n',
          '<!-- sab:field id="energy" type="scale" min="1" max="5" -->\n',
        ),
      ),
    ).toThrow(/prompted later/);
  });

  it('rejects a condition referencing itself', () => {
    expect(() =>
      check(withFields('<!-- sab:field id="loop" type="text" when="loop=1" -->\n')),
    ).toThrow(/prompted later/);
  });

  it('rejects malformed condition syntax', () => {
    expect(() =>
      check(
        withFields(
          '<!-- sab:field id="energy" type="scale" min="1" max="5" -->\n',
          '<!-- sab:field id="note" type="text" when="energy plus focus" -->\n',
        ),
      ),
    ).toThrow(/invalid 'when'/);
  });
});

describe('validate — carry-forward targets', () => {
  it('accepts a list pointing at a real table', () => {
    expect(() =>
      check(
        template(
          '<!-- sab:table id="review" -->\n',
          '<!-- sab:list id="intentions" carries-forward-to="review" -->\n',
        ),
      ),
    ).not.toThrow();
  });

  it('rejects a list pointing at a table that does not exist', () => {
    expect(() =>
      check(template('<!-- sab:list id="intentions" carries-forward-to="ghost" -->\n')),
    ).toThrow(/carries forward to 'ghost'/);
  });

  it('is a KaizenValidationError, so callers can distinguish it', () => {
    expect(() => check(template('<!-- sab:field id="f" type="nope" -->\n'))).toThrow(
      KaizenValidationError,
    );
  });
});
