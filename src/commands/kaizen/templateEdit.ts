import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { c } from '../../colors.js';
import { kaizenTemplatePathFor } from '../../kaizen/paths.js';

export interface EditTemplateOptions {
  configPath: string;
  templatePath?: string;
}

/**
 * Open the Kaizen template in `$EDITOR`.
 *
 * This is the CLI's only path that writes the template. A review run never
 * touches it — the guarantee is that answering a review cannot reshape the
 * instrument that measures the week, so changing it has to be a separate,
 * deliberate act.
 */
export function editKaizenTemplate(options: EditTemplateOptions): void {
  const path = options.templatePath ?? kaizenTemplatePathFor(options.configPath);

  if (!existsSync(path)) {
    process.stderr.write(c.red(`No Kaizen template found at ${path}. Run 'sab init' to create one.\n`));
    process.exit(1);
  }

  const editor = process.env.EDITOR;
  if (!editor) {
    process.stderr.write(c.red('No $EDITOR set. Export EDITOR=<your editor> and try again.\n'));
    process.exit(1);
  }

  const result = spawnSync(editor, [path], { stdio: 'inherit' });
  if (result.status !== 0) {
    process.stderr.write(c.red(`Editor exited with status ${result.status ?? 'unknown'}.\n`));
    process.exit(1);
  }

  process.stdout.write(`${c.green('Template saved.')}\n  ${c.muted(path)}\n`);
}
