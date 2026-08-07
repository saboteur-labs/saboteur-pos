import { c } from '../../colors.js';
import type { ExpandedTableNode } from '../../kaizen/expand.js';
import { cellAnswerKey } from '../../kaizen/expand.js';
import { promptField, type PromptOptions } from '../../kaizen/prompt-field.js';

/**
 * Prompting for the two generated tables — section 2's intentions review and
 * section 5's bandwidth audit. Both walk rows the template did not spell out,
 * so neither can reuse the plain field loop.
 */

export interface TableAnswers {
  /** Keyed by `cellAnswerKey(table, row, column)`. */
  answers: Record<string, string>;
  warnings: string[];
}

export interface TablePromptOptions extends PromptOptions {
  /** Where row headings and notices go. Defaults to stdout. */
  print?: (text: string) => void;
}

/**
 * Prompt a generated table, row by row.
 *
 * Columns marked `prompt="false"` are never asked — they carry data the run
 * already knows (a carried-forward intention, a generated row label) and are
 * shown as context for the columns that are asked.
 */
export async function promptTable(
  table: ExpandedTableNode,
  options: TablePromptOptions,
): Promise<TableAnswers> {
  const print = options.print ?? ((t: string) => process.stdout.write(t));
  const answers: Record<string, string> = {};
  const warnings: string[] = [];

  if (table.rows.length === 0) {
    if (table.emptyMessage) print(c.muted(`  ${table.emptyMessage}\n`));
    return { answers, warnings };
  }

  for (const row of table.rows) {
    print(`  ${c.label(row.label)}\n`);

    for (const column of table.columns) {
      const key = cellAnswerKey(table.id, row.key, column.id);

      const prefilled = row.prefilled[column.id];
      if (prefilled !== undefined) {
        answers[key] = prefilled;
        continue;
      }
      if (!column.prompt) continue;

      answers[key] = await promptField(
        {
          id: key,
          type: column.type ?? 'text',
          label: `    ${column.id}`,
          values: column.values,
          required: column.directive.attrs.required === 'true',
        },
        options,
      );
    }
  }

  const sumWarning = checkSum(table, answers);
  if (sumWarning) warnings.push(sumWarning);

  return { answers, warnings };
}

/**
 * Warn — never block — when a percentage column misses its expected total.
 *
 * The bandwidth audit is a rough estimate by design ("rough % by project/area"),
 * so refusing an answer that sums to 95 would be pedantry standing in the way of
 * the point, which is noticing where the time actually went.
 */
function checkSum(table: ExpandedTableNode, answers: Record<string, string>): string | null {
  if (table.warnUnlessSumsTo === undefined) return null;

  const percentColumns = table.columns.filter((col) => col.type === 'percent');
  if (percentColumns.length === 0) return null;

  let total = 0;
  let answered = 0;
  for (const row of table.rows) {
    for (const column of percentColumns) {
      const raw = answers[cellAnswerKey(table.id, row.key, column.id)];
      if (raw === undefined || raw === '') continue;
      const n = Number(raw);
      if (Number.isFinite(n)) {
        total += n;
        answered++;
      }
    }
  }

  if (answered === 0) return null;
  if (total === table.warnUnlessSumsTo) return null;

  return `Allocation totals ${total}%, not ${table.warnUnlessSumsTo}%.`;
}
