import { execSync } from 'child_process';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../../config.js';
import { getDb } from '../../db/index.js';
import { getTask, updateTaskFields } from '../../db/tasks.js';

const YAML_HEADER = `# Editable fields: title, priority, energy, effort, repo, branch
# priority: critical | high | normal | low
# energy:   deep | shallow | admin | (leave blank for none)
# effort:   xs | s | m | l | xl | (leave blank for none)
`;

function serializeTask(task: Awaited<ReturnType<typeof getTask>>): string {
  if (!task) return '';
  return (
    YAML_HEADER +
    `id: ${task.id}  # read-only\n` +
    `title: ${task.title}\n` +
    `priority: ${task.priority}\n` +
    `energy: ${task.energy ?? ''}\n` +
    `effort: ${task.effort ?? ''}\n` +
    `repo: ${task.repo ?? ''}\n` +
    `branch: ${task.branch ?? ''}\n` +
    `\n# Read-only fields:\n` +
    `# state: ${task.state}\n` +
    `# context: ${task.context_id}\n` +
    `# created_at: ${task.created_at}\n`
  );
}

function parseYamlFields(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    if (line.startsWith('#') || !line.includes(':')) continue;
    const colonIdx = line.indexOf(':');
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key && !key.startsWith('#')) result[key] = value;
  }
  return result;
}

export function runTaskEdit(id: string, options: { config?: string }): void {
  const editor = process.env.EDITOR;
  if (!editor) {
    process.stderr.write('No $EDITOR set. Export EDITOR=<your editor> and try again.\n');
    process.exit(1);
  }

  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  const task = getTask(db, id);
  if (!task) {
    process.stderr.write(`Task '${id}' not found.\n`);
    db.close();
    process.exit(1);
  }

  const tmpDir = join(tmpdir(), 'saboteur');
  mkdirSync(tmpDir, { recursive: true });
  const tmpFile = join(tmpDir, `task-${id}.yaml`);
  writeFileSync(tmpFile, serializeTask(task), 'utf-8');

  try {
    execSync(`${editor} ${tmpFile}`, { stdio: 'inherit' });
  } catch {
    process.stderr.write('Editor exited with an error.\n');
    unlinkSync(tmpFile);
    db.close();
    process.exit(1);
  }

  const edited = readFileSync(tmpFile, 'utf-8');
  unlinkSync(tmpFile);

  const fields = parseYamlFields(edited);
  const validPriorities = ['critical', 'high', 'normal', 'low'];
  const validEnergies = ['deep', 'shallow', 'admin', ''];
  const validEfforts = ['xs', 's', 'm', 'l', 'xl', ''];

  if (fields.priority && !validPriorities.includes(fields.priority)) {
    process.stderr.write(`Invalid priority '${fields.priority}'. Valid: ${validPriorities.join(', ')}.\n`);
    db.close();
    process.exit(1);
  }
  if ('energy' in fields && !validEnergies.includes(fields.energy)) {
    process.stderr.write(`Invalid energy '${fields.energy}'. Valid: deep, shallow, admin.\n`);
    db.close();
    process.exit(1);
  }
  if ('effort' in fields && !validEfforts.includes(fields.effort)) {
    process.stderr.write(`Invalid effort '${fields.effort}'. Valid: xs, s, m, l, xl.\n`);
    db.close();
    process.exit(1);
  }

  updateTaskFields(db, id, {
    title: fields.title || task.title,
    priority: (fields.priority as ReturnType<typeof getTask> extends Promise<infer T> ? never : any) || task.priority,
    energy: (fields.energy || null) as any,
    effort: (fields.effort || null) as any,
    repo: fields.repo || null,
    branch: fields.branch || null,
  });

  db.close();
  process.stdout.write(`Updated task ${id}.\n`);
}
