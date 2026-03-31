import chalk from 'chalk';

// Raw color tokens — map 1:1 to Colors.md palette.
// Import `c` and these helpers; never import chalk directly in command files.
export const c = {
  // Hues
  green:  (s: string) => chalk.ansi256(72)(s),
  red:    (s: string) => chalk.ansi256(167)(s),
  amber:  (s: string) => chalk.ansi256(214)(s),
  cyan:   (s: string) => chalk.ansi256(38)(s),
  violet: (s: string) => chalk.ansi256(97)(s),
  blue:   (s: string) => chalk.ansi256(68)(s),
  // Chrome
  label:  (s: string) => chalk.ansi256(255).bold(s),
  muted:  (s: string) => chalk.ansi256(245)(s),
  dim:    (s: string) => chalk.ansi256(240)(s),
  border: (s: string) => chalk.ansi256(237)(s),
};

// Semantic helpers

export function stateColor(state: string, s: string): string {
  switch (state) {
    case 'active':  return c.cyan(s);
    case 'blocked': return c.amber(s);
    case 'review':  return c.violet(s);
    case 'done':    return chalk.ansi256(240).strikethrough(s);
    default:        return s; // backlog → terminal default
  }
}

// For done rows in tables: build the plain-text row first, then wrap here.
// This avoids inner ANSI resets breaking the outer strikethrough.
export function doneRow(s: string): string {
  return chalk.ansi256(240).strikethrough(s);
}

export function priorityBadge(priority: string, s: string): string {
  switch (priority) {
    case 'critical': return chalk.ansi256(167).bold(s);
    case 'high':     return c.amber(s);
    case 'low':      return c.muted(s);
    default:         return s; // normal → terminal default
  }
}

export function energyBadge(energy: string | null, s: string): string {
  switch (energy) {
    case 'deep':  return c.blue(s);
    case 'admin': return c.muted(s);
    default:      return s; // shallow or null → terminal default
  }
}
