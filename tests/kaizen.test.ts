import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import matter from 'gray-matter';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, sabConfig, type TestEnv } from './helpers.js';

const templateIn = (configPath: string) => join(dirname(configPath), 'templates', 'kaizen.md');

/**
 * Answers for a workspace whose only context is `inbox`.
 *
 * The repeat excludes inbox, so section 3 asks nothing and the bandwidth table
 * has only its two fixed rows — which keeps the script short enough to read.
 */
function baseAnswers(overrides: Partial<Record<string, string>> = {}): string {
  const lines = [
    overrides.weekOf ?? '', // week_of — blank accepts the default
    '3', // energy
    '2', // focus
    'fragmented', // week_word
    'Lost Tuesday to switching', // low_score_note (focus <= 2 fires it)
    'Batch the context switches', // kaizen_answer
    '', //   end of longtext
    '60', // allocation: job search
    '40', // allocation: rest
    'Y', // matches_priorities — Y suppresses protect_or_cut
    'Ship kaizen', // intentions 1
    '', //   blank stops the list
    'Avoiding the pricing page', // honest_note
    '', //   end of longtext
    '', // time_spent — blank accepts the measured default
  ];
  return lines.join('\n') + '\n';
}

function noteFiles(env: TestEnv): string[] {
  return readdirSync(env.notesPath).filter((f) => f.includes('kaizen'));
}

describe('sab kaizen', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
  });
  afterEach(() => env.cleanup());

  describe('flags', () => {
    it('rejects --all and creates no note', () => {
      const result = sabConfig('kaizen --all', env);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('--all is not meaningful');
      expect(noteFiles(env)).toEqual([]);
    });

    it('rejects a malformed --week-of before prompting anything', () => {
      const result = sabConfig('kaizen --week-of last-monday', env);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('YYYY-MM-DD');
      expect(noteFiles(env)).toEqual([]);
    });

    it('rejects a context that does not exist', () => {
      const result = sabConfig('kaizen --context nonexistent', env);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("Context 'nonexistent' does not exist");
    });

    it('reports a missing template rather than crashing', () => {
      const result = sabConfig('kaizen --template /nope/kaizen.md', env);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('No Kaizen template found');
    });
  });

  describe('a completed review', () => {
    it('runs end to end and prints the note id and path', () => {
      const result = sabConfig('kaizen --week-of 2026-08-03', env, baseAnswers());

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Kaizen review saved.');
      expect(result.stdout).toMatch(/note_[0-9a-f]+/);

      const files = noteFiles(env);
      expect(files).toHaveLength(1);
      expect(result.stdout).toContain(files[0]);
    });

    it('files the note under the given week with kaizen frontmatter', () => {
      sabConfig('kaizen --week-of 2026-08-03', env, baseAnswers());

      const file = noteFiles(env)[0];
      expect(file).toMatch(/^2026-08-03-kaizen-/);

      const fm = matter(readFileSync(join(env.notesPath, file), 'utf-8')).data;
      expect(fm.tags).toEqual(['kaizen']);
      expect(fm.week_of).toBe('2026-08-03');
      expect(fm.template_version).toBe(1);
      expect(fm.template_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(fm.intentions).toEqual(['Ship kaizen']);
    });

    it('writes the answers into the template structure', () => {
      sabConfig('kaizen --week-of 2026-08-03', env, baseAnswers());
      const body = readFileSync(join(env.notesPath, noteFiles(env)[0]), 'utf-8');

      expect(body).toContain('- **Energy level this week (1–5):** 3');
      expect(body).toContain('- **One word that describes the week:** fragmented');
      expect(body).toContain('1. Ship kaizen');
      expect(body).toContain('| Job search / financial stability | 60 |');
      expect(body).toContain('Avoiding the pricing page');
    });

    it('is discoverable via sab note find --tag kaizen', () => {
      sabConfig('kaizen --week-of 2026-08-03', env, baseAnswers());
      const found = sabConfig('note find --tag kaizen', env);
      expect(found.code).toBe(0);
      expect(found.stdout).toContain('Kaizen — week of 2026-08-03');
    });

    it('does not modify task state', () => {
      sabConfig('task add "Untouched" --context inbox', env);
      const before = sabConfig('task list --all', env).stdout;
      sabConfig('kaizen --week-of 2026-08-03', env, baseAnswers());
      expect(sabConfig('task list --all', env).stdout).toBe(before);
    });

    it('defaults week_of to a Monday when not given', () => {
      sabConfig('kaizen', env, baseAnswers());
      const fm = matter(readFileSync(join(env.notesPath, noteFiles(env)[0]), 'utf-8')).data;
      const day = new Date(`${fm.week_of}T00:00:00Z`).getUTCDay();
      expect(day).toBe(1);
    });

    it('measures elapsed time rather than leaving it blank', () => {
      sabConfig('kaizen --week-of 2026-08-03', env, baseAnswers());
      const body = readFileSync(join(env.notesPath, noteFiles(env)[0]), 'utf-8');
      expect(body).toMatch(/\*\*Time spent on this review:\*\*.*\d+[hm]/);
    });
  });

  describe('carry-forward between runs', () => {
    it("prefills the next week's review with this week's intentions", () => {
      sabConfig('kaizen --week-of 2026-07-27', env, baseAnswers());

      // Second run: section 2 now has one row, asking outcome and why.
      const second = [
        '', // week_of
        '4', // energy
        '4', // focus
        'steady', // week_word — no followup, both scores are above 2
        'held', // intentions_review.0.outcome
        'protected the mornings', // intentions_review.0.why
        'Keep the batching habit', // kaizen_answer
        '',
        '50', // allocation: job search
        '50', // allocation: rest
        'Y',
        'Rest more', // intentions 1
        '',
        'Nothing to hide this week', // honest_note
        '',
        '', // time_spent
      ].join('\n') + '\n';

      const result = sabConfig('kaizen --week-of 2026-08-03', env, second);
      expect(result.code).toBe(0);

      const latest = noteFiles(env).find((f) => f.startsWith('2026-08-03'))!;
      const body = readFileSync(join(env.notesPath, latest), 'utf-8');
      expect(body).toContain('| Ship kaizen | held | protected the mornings |');
    });

    it('keeps both notes when a week is reviewed twice', () => {
      sabConfig('kaizen --week-of 2026-08-03', env, baseAnswers());

      // The second run asks two more questions than the first: the intentions
      // from run one now fill section 2, which wants an outcome and a why.
      const secondRun = [
        '', // week_of
        '3',
        '2',
        'fragmented',
        'Lost Tuesday',
        'partial', // intentions_review.0.outcome
        'half of it', // intentions_review.0.why
        'Batch the switches',
        '',
        '60',
        '40',
        'Y',
        'Ship kaizen again',
        '',
        'Still avoiding it',
        '',
        '',
      ].join('\n') + '\n';

      const result = sabConfig('kaizen --week-of 2026-08-03', env, secondRun);
      expect(result.code).toBe(0);
      expect(noteFiles(env)).toHaveLength(2);
    });
  });

  describe('context scoping', () => {
    it('files the note in --context while still covering every context', () => {
      sabConfig('context new offbeat-fm', env);

      // With a second context, section 3 now asks about it and the bandwidth
      // table gains a row for it.
      const answers = [
        '', // week_of
        '3',
        '2',
        'fragmented',
        'Lost Tuesday', // low_score_note
        'n', // skip offbeat-fm?
        'Three profiles claimed', // what_moved
        '', // whats_blocked
        '', // improvement
        '', // next_action
        '2 new', // artist_profiles (per-context extra)
        'Batch switches', // kaizen_answer
        '',
        '50', // allocation: offbeat-fm
        '30', // allocation: job search
        '20', // allocation: rest
        'Y',
        'Ship kaizen',
        '',
        'Nothing to add',
        '',
        '',
      ].join('\n') + '\n';

      const result = sabConfig('kaizen --context offbeat-fm', env, answers);
      expect(result.code).toBe(0);

      const body = readFileSync(join(env.notesPath, noteFiles(env)[0]), 'utf-8');
      const fm = matter(body).data;
      expect(fm.context).toBe('offbeat-fm');
      expect(body).toContain('### offbeat-fm');
      expect(body).toContain('- **What moved:** Three profiles claimed');
      // The per-context extra fired for its own context.
      expect(body).toContain('- **Artist profiles this week (new / claimed):** 2 new');
    });

    it('records a skip reason in place of a project\'s answers', () => {
      sabConfig('context new offbeat-fm', env);

      const answers = [
        '',
        '3',
        '2',
        'fragmented',
        'Lost Tuesday',
        'y', // skip offbeat-fm
        'No movement — deprioritized', // reason
        'Batch switches',
        '',
        '50',
        '30',
        '20',
        'Y',
        'Ship kaizen',
        '',
        'Nothing to add',
        '',
        '',
      ].join('\n') + '\n';

      const result = sabConfig('kaizen', env, answers);
      expect(result.code).toBe(0);

      const body = readFileSync(join(env.notesPath, noteFiles(env)[0]), 'utf-8');
      expect(body).toContain('_Skipped — No movement — deprioritized_');
      expect(body).not.toContain('- **What moved:**');
    });
  });

  describe('template handling', () => {
    it('never writes the template during a review', () => {
      const path = templateIn(env.configPath);
      const before = readFileSync(path, 'utf-8');

      sabConfig('kaizen --week-of 2026-08-03', env, baseAnswers());

      expect(readFileSync(path, 'utf-8')).toBe(before);
    });

    it('runs against an alternate template given with --template', () => {
      const alt = join(env.notesPath, '..', 'alt-kaizen.md');
      const original = readFileSync(templateIn(env.configPath), 'utf-8');
      writeFileSync(alt, original.replace('# Kaizen Weekly Review', '# Alternate Review'), 'utf-8');

      const result = sabConfig(`kaizen --week-of 2026-08-03 --template ${alt}`, env, baseAnswers());

      expect(result.code).toBe(0);
      const body = readFileSync(join(env.notesPath, noteFiles(env)[0]), 'utf-8');
      expect(body).toContain('# Alternate Review');
      // And the alternate path is what gets recorded.
      expect(matter(body).data.template_path).toBe(alt);
    });

    it('warns on stderr about an unknown directive but still completes', () => {
      const path = templateIn(env.configPath);
      writeFileSync(
        path,
        readFileSync(path, 'utf-8').replace(
          '## 7. One Honest Note (2 min)',
          '<!-- sab:nonsense id="x" -->\n\n## 7. One Honest Note (2 min)',
        ),
        'utf-8',
      );

      const result = sabConfig('kaizen --week-of 2026-08-03', env, baseAnswers());

      expect(result.code).toBe(0);
      expect(result.stderr).toContain('sab:nonsense');
      expect(noteFiles(env)).toHaveLength(1);
    });

    it('fails before prompting when a required section is missing', () => {
      const path = templateIn(env.configPath);
      writeFileSync(
        path,
        readFileSync(path, 'utf-8').replace(
          '<!-- sab:section id="bandwidth" title="Bandwidth Audit" minutes="5" -->',
          '',
        ),
        'utf-8',
      );

      const result = sabConfig('kaizen --week-of 2026-08-03', env, baseAnswers());

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('bandwidth');
      expect(noteFiles(env)).toEqual([]);
    });

    it('fails on an unsupported schema, naming the one it supports', () => {
      const path = templateIn(env.configPath);
      writeFileSync(path, readFileSync(path, 'utf-8').replace('schema: 1', 'schema: 99'), 'utf-8');

      const result = sabConfig('kaizen', env, baseAnswers());

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('supports schema 1');
    });
  });

  describe('sab kaizen template edit', () => {
    it('opens the template and exits without running a review', () => {
      // The test harness sets EDITOR=true, which exits 0 without editing.
      const result = sabConfig('kaizen template edit', env);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Template saved.');
      expect(noteFiles(env)).toEqual([]);
    });

    it('--edit-template does the same and asks nothing', () => {
      const result = sabConfig('kaizen --edit-template', env);
      expect(result.code).toBe(0);
      expect(noteFiles(env)).toEqual([]);
    });

    it('seeds a template that exists to be edited', () => {
      expect(existsSync(templateIn(env.configPath))).toBe(true);
    });
  });
});
