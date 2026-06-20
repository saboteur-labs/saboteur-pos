/**
 * Path-glob matching for monorepo sub-context attribution.
 *
 * This is the TypeScript counterpart of the glob engine in the saboteur-pos
 * skill's resolve_context.py — same surface (`*` within a segment, `**` across
 * segments, `**​/` matching zero dirs, `?` one non-separator char), so the CLI
 * indexer and the interactive resolver agree on what a glob means.
 *
 * The resolver matches a single cwd against an ordered list (first match wins,
 * user-ordered). Here the rules are pooled from many independent contexts with
 * no natural order, so file attribution instead picks the **most specific** rule
 * per file (longest literal prefix) — see `attributeSubContext`.
 */

export interface SubContextRule {
  glob: string;
  context: string;
}

function escapeRe(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Translate a path glob into an anchored regex. Intentionally small: no brace
 * or character-class expansion. */
export function globToRe(glob: string): RegExp {
  let out = '';
  let i = 0;
  while (i < glob.length) {
    if (glob.startsWith('**/', i)) {
      out += '(?:.*/)?'; // `**​/` also matches zero directories
      i += 3;
    } else if (glob.startsWith('**', i)) {
      out += '.*';
      i += 2;
    } else if (glob[i] === '*') {
      out += '[^/]*';
      i += 1;
    } else if (glob[i] === '?') {
      out += '[^/]';
      i += 1;
    } else {
      out += escapeRe(glob[i]);
      i += 1;
    }
  }
  return new RegExp('^' + out + '$');
}

/** True if `rel` falls under `glob`. A dir glob like `apps/web/**` also matches
 * the directory itself (`apps/web`), not just its contents. */
export function pathMatches(glob: string, rel: string): boolean {
  const r = rel === '' || rel === '.' ? '.' : rel.replace(/\\/g, '/').replace(/\/+$/, '');
  if (globToRe(glob).test(r)) return true;
  const base = glob.replace(/[/*]+$/, '');
  return base.length > 0 && globToRe(base).test(r);
}

/** Length of the literal prefix before the first wildcard — a rule's
 * specificity. `apps/web/**` (8) beats `**` (0), so the deeper rule wins. */
function literalPrefixLen(glob: string): number {
  const m = glob.search(/[*?]/);
  return m === -1 ? glob.length : m;
}

/**
 * Attribute a commit (its changed file paths) to a single sub-context.
 *
 * Each file is assigned to the most specific matching rule; the sub-context
 * touched by the most files wins (ties broken by context id ascending, for
 * determinism). Returns null when no file matches any rule — i.e. the commit
 * touched nothing in a declared sub-area, so it is not sub-attributed.
 */
export function attributeSubContext(files: string[], rules: SubContextRule[]): string | null {
  if (files.length === 0 || rules.length === 0) return null;

  const counts = new Map<string, number>();
  for (const file of files) {
    let best: SubContextRule | null = null;
    let bestLen = -1;
    for (const rule of rules) {
      if (pathMatches(rule.glob, file)) {
        const len = literalPrefixLen(rule.glob);
        if (len > bestLen) {
          best = rule;
          bestLen = len;
        }
      }
    }
    if (best) counts.set(best.context, (counts.get(best.context) ?? 0) + 1);
  }

  let winner: string | null = null;
  let max = 0;
  for (const ctx of [...counts.keys()].sort()) {
    const n = counts.get(ctx)!;
    if (n > max) {
      max = n;
      winner = ctx;
    }
  }
  return winner;
}
