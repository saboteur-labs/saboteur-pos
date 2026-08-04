import {
  FIELD_TYPES,
  type ExtraNode,
  type FieldNode,
  type FollowupNode,
  type KaizenDocument,
  type ListNode,
  type Node,
  type RepeatNode,
  type TableNode,
} from './parse.js';
import { parseWhen, referencedFields, WhenSyntaxError } from './when.js';

/**
 * Sections `sab kaizen` knows how to run. The command understands the
 * seven-section Kaizen structure specifically — arbitrary user-authored
 * templates with unknown section semantics are an explicit non-goal — so a
 * missing section is an error rather than a shorter review.
 */
export const REQUIRED_SECTIONS = [
  'pulse-check',
  'intentions-review',
  'project-snapshots',
  'kaizen-question',
  'bandwidth',
  'next-intentions',
  'honest-note',
] as const;

export class KaizenValidationError extends Error {}

/** Anything that produces an answer keyed by id. */
type Answerable = FieldNode | FollowupNode | ListNode;

const isAnswerable = (n: Node): n is Answerable =>
  n.kind === 'field' || n.kind === 'followup' || n.kind === 'list';

/**
 * Check a parsed template before any prompting begins.
 *
 * Everything here fails the whole run rather than degrading: a review that
 * collects half a set of answers and then dies on a malformed directive has
 * wasted the user's time and produced nothing. The one deliberate exception is
 * unknown directives, which the parser warns about and skips.
 */
export function validate(doc: KaizenDocument): void {
  requireSections(doc);
  checkIdUniqueness(doc);
  checkFieldAttributes(doc);
  checkConditions(doc);
  checkCarryForwardTargets(doc);
}

function requireSections(doc: KaizenDocument): void {
  const present = new Set(doc.sections.map((s) => s.id));
  const missing = REQUIRED_SECTIONS.filter((id) => !present.has(id));
  if (missing.length > 0) {
    throw new KaizenValidationError(
      `Kaizen template is missing required section${missing.length > 1 ? 's' : ''}: ` +
        `${missing.join(', ')}. Each must be declared with '<!-- sab:section id="..." -->'.`,
    );
  }
}

/**
 * Ids must be unique within their scope, since they are the answer keys.
 *
 * Scopes: the document (everything outside a repeat), each repeat's own fields,
 * and each table's columns. A `sab:extra` block is checked against its section's
 * repeat as well as itself — its fields are appended to that repeat's per-item
 * prompts, so a collision there would silently overwrite an answer.
 */
function checkIdUniqueness(doc: KaizenDocument): void {
  const documentScope: Answerable[] = [];

  const collect = (nodes: Node[], into: Answerable[]): void => {
    for (const node of nodes) {
      if (isAnswerable(node)) into.push(node);
      if (node.kind === 'table') {
        assertUnique(
          node.columns.map((col) => ({ id: col.id })),
          `table '${node.id}'`,
        );
      }
    }
  };

  for (const container of [doc.preamble, ...doc.sections.map((s) => s.children)]) {
    collect(container, documentScope);

    const repeats = container.filter((n): n is RepeatNode => n.kind === 'repeat');
    const extras = container.filter((n): n is ExtraNode => n.kind === 'extra');

    for (const repeat of repeats) {
      const perItem: Answerable[] = [];
      collect(repeat.children, perItem);
      assertUnique(perItem, `repeat '${repeat.id}'`);

      // Extras extend the same per-item answer namespace.
      for (const extra of extras) {
        const withExtra: Answerable[] = [...perItem];
        collect(extra.children, withExtra);
        assertUnique(withExtra, `context '${extra.context}' extras`);
      }
    }

    // Extras in a section with no repeat still must not collide with each other.
    if (repeats.length === 0) {
      for (const extra of extras) {
        const own: Answerable[] = [];
        collect(extra.children, own);
        assertUnique(own, `context '${extra.context}' extras`);
      }
    }
  }

  assertUnique(documentScope, 'template');
}

function assertUnique(items: Array<{ id: string }>, scope: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new KaizenValidationError(
        `Duplicate id '${item.id}' in ${scope}. Ids are answer keys and must be unique within their scope.`,
      );
    }
    seen.add(item.id);
  }
}

function checkFieldAttributes(doc: KaizenDocument): void {
  for (const node of everyNode(doc)) {
    if (node.kind === 'table') {
      for (const col of node.columns) {
        if (col.type === 'enum' && (col.values === undefined || col.values.length === 0)) {
          throw new KaizenValidationError(
            `Column '${col.id}' in table '${node.id}' is an enum but declares no 'values'.`,
          );
        }
      }
      continue;
    }

    if (node.kind !== 'field' && node.kind !== 'followup') continue;

    if (!(FIELD_TYPES as readonly string[]).includes(node.type)) {
      throw new KaizenValidationError(
        `Field '${node.id}' has unknown type '${node.type}'. Supported types: ${FIELD_TYPES.join(', ')}.`,
      );
    }

    const attrs = node.directive.attrs;
    if (node.type === 'enum' && !attrs.values) {
      throw new KaizenValidationError(`Field '${node.id}' is an enum but declares no 'values'.`);
    }
    if (node.type === 'scale') {
      for (const bound of ['min', 'max'] as const) {
        if (attrs[bound] === undefined) {
          throw new KaizenValidationError(
            `Field '${node.id}' is a scale but declares no '${bound}'.`,
          );
        }
        if (!Number.isFinite(Number(attrs[bound]))) {
          throw new KaizenValidationError(
            `Field '${node.id}' has a non-numeric '${bound}' of '${attrs[bound]}'.`,
          );
        }
      }
      if (Number(attrs.min) >= Number(attrs.max)) {
        throw new KaizenValidationError(
          `Field '${node.id}' has min ${attrs.min} which is not below max ${attrs.max}.`,
        );
      }
    }
  }
}

/**
 * A `when` must parse, and must reference a field prompted *earlier* — a
 * condition on a later answer could never be true at the moment it is checked,
 * so it would silently suppress its prompt forever.
 */
function checkConditions(doc: KaizenDocument): void {
  const order = promptOrder(doc);
  const positionOf = new Map(order.map((id, index) => [id, index]));

  order.forEach((id, index) => {
    const node = nodeById(doc, id);
    const raw = node?.kind === 'field' || node?.kind === 'followup' ? node.when : undefined;
    if (!raw) return;

    let expr;
    try {
      expr = parseWhen(raw);
    } catch (err) {
      if (err instanceof WhenSyntaxError) {
        throw new KaizenValidationError(`Field '${id}' has an invalid 'when': ${err.message}`);
      }
      throw err;
    }

    for (const ref of referencedFields(expr)) {
      const at = positionOf.get(ref);
      if (at === undefined) {
        throw new KaizenValidationError(
          `Field '${id}' has a 'when' referencing unknown field '${ref}'.`,
        );
      }
      if (at >= index) {
        throw new KaizenValidationError(
          `Field '${id}' has a 'when' referencing '${ref}', which is prompted later. ` +
            `A condition can only depend on an answer already collected.`,
        );
      }
    }
  });
}

function checkCarryForwardTargets(doc: KaizenDocument): void {
  const tableIds = new Set(
    [...everyNode(doc)].filter((n): n is TableNode => n.kind === 'table').map((t) => t.id),
  );

  for (const node of everyNode(doc)) {
    if (node.kind !== 'list' || !node.carriesForwardTo) continue;
    if (!tableIds.has(node.carriesForwardTo)) {
      throw new KaizenValidationError(
        `List '${node.id}' carries forward to '${node.carriesForwardTo}', which is not a table in this template.`,
      );
    }
  }
}

/** Every node in the document, descending into composites. */
function* everyNode(doc: KaizenDocument): Generator<Node> {
  function* walk(nodes: Node[]): Generator<Node> {
    for (const node of nodes) {
      yield node;
      if (node.kind === 'repeat' || node.kind === 'extra') yield* walk(node.children);
    }
  }
  yield* walk(doc.preamble);
  for (const section of doc.sections) yield* walk(section.children);
}

/** Answer ids in the order a run collects them. */
function promptOrder(doc: KaizenDocument): string[] {
  return [...everyNode(doc)].filter(isAnswerable).map((n) => n.id);
}

function nodeById(doc: KaizenDocument, id: string): Answerable | undefined {
  return [...everyNode(doc)].filter(isAnswerable).find((n) => n.id === id);
}
