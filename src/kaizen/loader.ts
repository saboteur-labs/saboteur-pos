import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import matter from 'gray-matter';
import { kaizenTemplatePathFor } from './paths.js';

/**
 * Directive vocabulary version understood by this parser. Bumped only when the
 * `sab:*` grammar itself changes — not when a user edits their template, which
 * moves `template_version` instead.
 */
export const SUPPORTED_SCHEMA = 1;

export interface KaizenFrontmatter {
  template: string;
  template_version: number;
  schema: number;
}

export interface KaizenTemplate {
  /** Absolute path the template was read from. */
  path: string;
  /** Entire file, verbatim. */
  raw: string;
  /** Everything after the frontmatter block, sliced from `raw` without normalisation. */
  body: string;
  /** Index into `raw` where `body` begins, so callers can map back to source offsets. */
  bodyOffset: number;
  frontmatter: KaizenFrontmatter;
  /** sha256 of the file's bytes as read. */
  hash: string;
}

export class KaizenTemplateError extends Error {}

export interface LoadOptions {
  /** Workspace config path; the template is resolved alongside it. */
  configPath: string;
  /** Explicit override (`--template`), taking precedence over the workspace default. */
  templatePath?: string;
}

/**
 * Read and validate a Kaizen template.
 *
 * Read-only by construction: this module never writes, and nothing downstream is
 * given a handle that could. A review records `hash` so the exact template text
 * that produced it stays identifiable even after the user edits the file.
 */
export function loadKaizenTemplate(options: LoadOptions): KaizenTemplate {
  const path = options.templatePath ?? kaizenTemplatePathFor(options.configPath);

  if (!existsSync(path)) {
    throw new KaizenTemplateError(
      `No Kaizen template found at ${path}. Run 'sab init' to create one.`,
    );
  }

  const bytes = readFileSync(path);
  const raw = bytes.toString('utf-8');
  const hash = createHash('sha256').update(bytes).digest('hex');

  const { bodyOffset } = splitFrontmatter(raw, path);
  const body = raw.slice(bodyOffset);
  const frontmatter = readFrontmatter(raw, path);

  return { path, raw, body, bodyOffset, frontmatter, hash };
}

/**
 * Locate the end of the frontmatter block.
 *
 * Done by hand rather than taking gray-matter's `content`, which strips the
 * newline after the closing delimiter. The body has to be an exact slice of
 * `raw` — the prose in it is reproduced byte-for-byte into every note, so a
 * single normalised character here becomes a spec violation downstream.
 */
function splitFrontmatter(raw: string, path: string): { bodyOffset: number } {
  const opening = /^---\r?\n/.exec(raw);
  if (!opening) {
    throw new KaizenTemplateError(
      `${path} has no frontmatter block. A Kaizen template must begin with '---' ` +
        `followed by 'template: kaizen'.`,
    );
  }
  const closing = /^---[ \t]*\r?\n?/m.exec(raw.slice(opening[0].length));
  if (!closing) {
    throw new KaizenTemplateError(
      `${path} has an unterminated frontmatter block — no closing '---' was found.`,
    );
  }
  return { bodyOffset: opening[0].length + closing.index + closing[0].length };
}

function readFrontmatter(raw: string, path: string): KaizenFrontmatter {
  let data: Record<string, unknown>;
  try {
    data = matter(raw).data as Record<string, unknown>;
  } catch (err) {
    throw new KaizenTemplateError(
      `${path} has malformed frontmatter: ${(err as Error).message}`,
    );
  }

  if (data.template !== 'kaizen') {
    throw new KaizenTemplateError(
      `${path} is not a Kaizen template — expected 'template: kaizen' in its frontmatter, ` +
        `found ${data.template === undefined ? 'no template field' : `'${String(data.template)}'`}.`,
    );
  }

  const schema = data.schema;
  if (typeof schema !== 'number' || !Number.isInteger(schema)) {
    throw new KaizenTemplateError(
      `${path} is missing an integer 'schema' field in its frontmatter. ` +
        `This version of sab supports schema ${SUPPORTED_SCHEMA}.`,
    );
  }
  if (schema !== SUPPORTED_SCHEMA) {
    throw new KaizenTemplateError(
      `${path} declares schema ${schema}, but this version of sab supports schema ` +
        `${SUPPORTED_SCHEMA}. ` +
        (schema > SUPPORTED_SCHEMA
          ? 'Upgrade sab to run this template.'
          : 'Update the template to the current schema.'),
    );
  }

  const version = data.template_version;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new KaizenTemplateError(
      `${path} is missing an integer 'template_version' field in its frontmatter. ` +
        `Notes record it so a review can be traced back to the template that produced it.`,
    );
  }

  return { template: 'kaizen', template_version: version, schema };
}
