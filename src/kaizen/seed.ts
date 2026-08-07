import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { findShippedTemplate, kaizenTemplatePathFor, templatesDirFor } from './paths.js';

export type SeedResult =
  | { seeded: true; path: string }
  | { seeded: false; path: string; reason: 'exists' };

/**
 * Write the shipped Kaizen template into the workspace, unless the user already
 * has one there.
 *
 * Never overwrites: the template is user-owned and hand-edited, and a review
 * records the hash of whatever version it ran against. Clobbering it on `init`
 * would silently change the instrument. This is also what makes the call safe to
 * run unconditionally on every `init`, which is how existing workspaces get
 * backfilled.
 */
export function seedKaizenTemplate(configPath: string): SeedResult {
  const target = kaizenTemplatePathFor(configPath);
  if (existsSync(target)) {
    return { seeded: false, path: target, reason: 'exists' };
  }
  mkdirSync(templatesDirFor(configPath), { recursive: true });
  copyFileSync(findShippedTemplate(), target);
  return { seeded: true, path: target };
}
