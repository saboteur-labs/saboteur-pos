import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export const KAIZEN_TEMPLATE_FILENAME = 'kaizen.md';

/**
 * Locate the Kaizen template shipped with the package.
 *
 * Walks up from this module looking for `templates/kaizen.md`. Both layouts put
 * the asset two levels up — `src/kaizen/` under tsx, `dist/kaizen/` after a
 * build — but walking rather than hardcoding `../..` keeps this working if the
 * module moves or the build output nests differently.
 */
export function findShippedTemplate(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'templates', KAIZEN_TEMPLATE_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not locate the shipped Kaizen template (templates/${KAIZEN_TEMPLATE_FILENAME}). ` +
      `This usually means the package was built or published without its templates directory.`,
  );
}

/**
 * The templates directory for a workspace, resolved alongside its config file so
 * that `--config` overrides (and tests) get their own isolated templates dir.
 */
export function templatesDirFor(configPath: string): string {
  return join(dirname(configPath), 'templates');
}

/** The user's editable Kaizen template for a workspace. */
export function kaizenTemplatePathFor(configPath: string): string {
  return join(templatesDirFor(configPath), KAIZEN_TEMPLATE_FILENAME);
}
