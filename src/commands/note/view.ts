import { readFileSync } from 'fs';
import matter from 'gray-matter';
import { DEFAULT_CONFIG_PATH, loadConfig, resolvePath } from '../../config.js';
import { getDb } from '../../db/index.js';
import { getKnowledgeEntry } from '../../db/knowledge.js';
import { incrementalSync } from '../../sync.js';
import { resolveWikiLinks } from '../../wiki.js';
import { c } from '../../colors.js';

export function runNoteView(id: string, options: { config?: string }): void {
  const configPath = resolvePath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = loadConfig(configPath);
  const db = getDb(resolvePath(config.db_path));

  incrementalSync(db, config);

  const entry = getKnowledgeEntry(db, id);
  if (!entry) {
    process.stderr.write(c.red(`Note '${id}' not found.\n`));
    db.close();
    process.exit(1);
  }

  const raw = readFileSync(entry.path, 'utf-8');
  const parsed = matter(raw);

  const bodyWithLinks = resolveWikiLinks(db, parsed.content);
  db.close();

  // Print frontmatter summary then body
  process.stdout.write(`${c.border('---')}\n`);
  process.stdout.write(`${c.label('id:')} ${entry.id}\n`);
  process.stdout.write(`${c.label('title:')} ${entry.title ?? '-'}\n`);
  process.stdout.write(`${c.label('tags:')} [${entry.tags.join(', ')}]\n`);
  process.stdout.write(`${c.label('context:')} ${c.cyan(entry.context_id ?? '-')}\n`);
  if (entry.task_id) process.stdout.write(`${c.label('task_id:')} ${entry.task_id}\n`);
  process.stdout.write(`${c.label('updated_at:')} ${entry.updated_at ?? '-'}\n`);
  process.stdout.write(`${c.border('---')}\n`);
  process.stdout.write(bodyWithLinks.trimStart());
}
