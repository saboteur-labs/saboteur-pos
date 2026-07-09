import { Command } from 'commander';
import { runInit } from './commands/init.js';
import { runStatus } from './commands/status.js';
import { runTaskAdd } from './commands/task/add.js';
import { runTaskList } from './commands/task/list.js';
import { runTaskView } from './commands/task/view.js';
import { runTaskMove } from './commands/task/move.js';
import { runTaskEdit } from './commands/task/edit.js';
import { runTaskLink } from './commands/task/link.js';
import { runTaskDelete } from './commands/task/delete.js';
import { runContextNew } from './commands/context/new.js';
import { runContextList } from './commands/context/list.js';
import { runContextUse } from './commands/context/use.js';
import { runContextShow } from './commands/context/show.js';
import { runContextDelete } from './commands/context/delete.js';
import {
  runContextReposAdd,
  runContextReposList,
  runContextReposRemove,
} from './commands/context/repos.js';
import { runNoteNew } from './commands/note/new.js';
import { runNoteList } from './commands/note/list.js';
import { runNoteView } from './commands/note/view.js';
import { runNoteEdit } from './commands/note/edit.js';
import { runNoteFind } from './commands/note/find.js';
import { runSync } from './commands/sync.js';
import { runBriefing } from './commands/briefing.js';
import { runStandup } from './commands/standup.js';
import { runRetro } from './commands/retro.js';
import { runGitList } from './commands/git/list.js';
import { runUi, runUiStop } from './commands/ui.js';

const program = new Command();

program
  .name('sab')
  .description('Saboteur POS — personal task and note management')
  .version('0.1.0')
  .addHelpText('after', `
Global flags (valid on any read command):
  --context <slug>   Override active context for this command only
  --all              Bypass context filter — return results across all contexts

Commands:
  sab init                     Initialize workspace
  sab status                   System state (read-only)
  sab briefing [--context]     Daily briefing (read-only)
  sab briefing --all           Daily briefing showing all repos (ignore context scope)
  sab briefing --weekly        7-day shipped/stalled/repo-activity report
  sab standup [--slot <slot>]  Guided standup check-in (slot-aware Q&A)
  sab retro --scope <s>        Guided retro (project | feature | daily)
  sab sync                     Rebuild knowledge index from disk
  sab git list                 List valid repos under repos_dir with their branches

  sab task add <title>         Create task (default state: backlog)
  sab task list [--view <v>]   List tasks  views: today|active|backlog|blocked|review|deep-work|stale
  sab task view <id>           Full task detail + state history
  sab task move <id> <state>   Transition state
  sab task done <id>           Shorthand: move to done
  sab task block <id>          Shorthand: move to blocked
  sab task edit <id>           Edit fields in \$EDITOR
  sab task link <id> --note <note_id>    Link a note
  sab task link <id> --blocks <task_id>  Create block dependency
  sab task delete <id>                   Delete task permanently (--force to override dependency guard)

  sab context new <slug>       Create context
  sab context list             List contexts with counts
  sab context use <slug>       Set active context
  sab context show             Print active context
  sab context delete <slug>    Delete context (--reassign | --force)
  sab context repos <slug>     List repos linked to a context (add | remove)

  sab note new <title>         Create note (opens \$EDITOR)
  sab note new <title> --body <text>   Create note with body directly (no editor)
  sab note new <title> --body @<path>  Create note with body from file (no editor)
  sab note list [--view recent] List notes
  sab note view <id>           Print note with resolved wiki-links
  sab note edit <id>           Edit note file in \$EDITOR
  sab note edit <id> --body <text>    Replace note body directly (no editor)
  sab note edit <id> --body @<path>   Replace note body from file (no editor)
  sab note find --tag <tag>    Filter notes by tag
  sab note find --task <id>    Filter notes linked to a task

State machine:
  backlog → active → review → done
  any non-done → blocked → active
  active → backlog

Enums:
  priority  critical | high | normal | low     (default: normal)
  energy    deep | shallow | admin
  effort    xs | s | m | l | xl
  state     backlog | active | blocked | review | done

Run 'sab help <command>' or 'sab <noun> help <verb>' for details.
Example: sab help task    sab task help add`);

// ── sab init ────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Initialize a new Saboteur workspace')
  .option('--config <path>', 'Initialize from an existing config file (machine migration)')
  .action((options) => runInit(options));

// ── sab status ───────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Print system state (read-only)')
  .option('--config <path>', 'Path to config file')
  .action((options) => runStatus(options));

// ── sab task ─────────────────────────────────────────────────────────────────
const task = program.command('task').description('Manage tasks').addHelpText('after', `
State machine:  backlog → active → review → done
                any non-done → blocked → active
                active → backlog

Enums:
  --priority  critical | high | normal | low   (default: normal)
  --energy    deep | shallow | admin
  --effort    xs | s | m | l | xl
  <state>     backlog | active | blocked | review | done`);

task
  .command('add <title>')
  .description('Create a new task')
  .option('--context <slug>', 'Context slug')
  .option('--priority <p>', 'Priority: critical | high | normal | low')
  .option('--energy <e>', 'Energy: deep | shallow | admin')
  .option('--effort <e>', 'Effort: xs | s | m | l | xl')
  .option('--repo <name>', 'Repository name (Phase 1 manual entry)')
  .option('--config <path>', 'Path to config file')
  .action((title, options) => runTaskAdd(title, options));

task
  .command('list')
  .description('List tasks')
  .option('--view <v>', 'today | active | backlog | blocked | review | deep-work | stale')
  .option('--context <slug>', 'Override active context')
  .option('--all', 'All contexts')
  .option('--config <path>', 'Path to config file')
  .action((options) => runTaskList(options));

task
  .command('view <id>')
  .description('Show full detail for a task')
  .option('--config <path>', 'Path to config file')
  .action((id, options) => runTaskView(id, options));

task
  .command('move <id> <state>')
  .description('Transition a task to a new state')
  .option('--config <path>', 'Path to config file')
  .action((id, state, options) => runTaskMove(id, state, options));

task
  .command('done <id>')
  .description('Shorthand for sab task move <id> done')
  .option('--config <path>', 'Path to config file')
  .action((id, options) => runTaskMove(id, 'done', options));

task
  .command('block <id>')
  .description('Shorthand for sab task move <id> blocked')
  .option('--config <path>', 'Path to config file')
  .action((id, options) => runTaskMove(id, 'blocked', options));

task
  .command('edit <id>')
  .description('Edit task fields in $EDITOR')
  .option('--config <path>', 'Path to config file')
  .action((id, options) => runTaskEdit(id, options));

task
  .command('link <id>')
  .description('Link a note (--note) or create a block dependency (--blocks)')
  .option('--note <note_id>', 'Link a note to this task')
  .option('--blocks <task_id>', 'This task blocks another task')
  .option('--config <path>', 'Path to config file')
  .action((id, options) => runTaskLink(id, options));

task
  .command('delete <id>')
  .description('Delete a task permanently')
  .option('--force', 'Delete even if task has dependency links')
  .option('--config <path>', 'Path to config file')
  .action((id, options) => runTaskDelete(id, options));

// ── sab context ──────────────────────────────────────────────────────────────
const context = program.command('context').description('Manage contexts').addHelpText('after', `
Notes:
  'inbox' is a reserved context — cannot be deleted or renamed.
  sab context delete requires --reassign <slug> or --force unless the context is empty.`);

context
  .command('new <slug>')
  .description('Create a new context')
  .option('--name <name>', 'Display name')
  .option('--description <desc>', 'Optional description')
  .option('--config <path>', 'Path to config file')
  .action((slug, options) => runContextNew(slug, options));

context
  .command('list')
  .description('List all contexts with counts')
  .option('--config <path>', 'Path to config file')
  .action((options) => runContextList(options));

context
  .command('use <slug>')
  .description('Set the active context (persists to config)')
  .option('--config <path>', 'Path to config file')
  .action((slug, options) => runContextUse(slug, options));

context
  .command('show')
  .description('Print the currently active context')
  .option('--config <path>', 'Path to config file')
  .action((options) => runContextShow(options));

context
  .command('delete <slug>')
  .description('Delete a context')
  .option('--reassign <slug>', 'Migrate all items to this context')
  .option('--force', 'Orphan all items to inbox')
  .option('--config <path>', 'Path to config file')
  .action((slug, options) => runContextDelete(slug, options));

const repos = context.command('repos').description('Manage repos linked to a context');

repos
  .command('list <slug>', { isDefault: true })
  .description('List repos linked to a context')
  .option('--config <path>', 'Path to config file')
  .action((slug, options) => runContextReposList(slug, options));

repos
  .command('add <slug> <repo...>')
  .description('Link one or more repos to a context (use --path for a monorepo sub-area)')
  .option('--path <glob>', 'Restrict a single repo to a sub-path glob (monorepo sub-context)')
  .option('--config <path>', 'Path to config file')
  .action((slug, repoArgs, options) => runContextReposAdd(slug, repoArgs, options));

repos
  .command('remove <slug> <repo...>')
  .description('Unlink one or more repos from a context')
  .option('--config <path>', 'Path to config file')
  .action((slug, repoArgs, options) => runContextReposRemove(slug, repoArgs, options));

// ── sab note ─────────────────────────────────────────────────────────────────
const note = program.command('note').description('Manage notes').addHelpText('after', `
Notes:
  The .md file is the source of truth — SQLite is a derived index.
  Wiki-links: [[note_id]] or [[title-slug]] — unresolved shows as [[broken: slug]].
  sab sync rebuilds the index; incremental sync runs automatically before note queries.`);

note
  .command('new <title>')
  .description('Create a new note in $EDITOR, or supply body directly with --body <text|@path>')
  .option('--context <slug>', 'Set context in frontmatter')
  .option('--task <id>', 'Pre-populate task_id in frontmatter')
  .option('--tag <tag>', 'Add a tag (repeatable)', (val, prev: string[]) => [...prev, val], [] as string[])
  .option('--body <text>', 'Set note body directly without opening editor; prefix with @ to read from a file path')
  .option('--config <path>', 'Path to config file')
  .action((title, options) => runNoteNew(title, options));

note
  .command('list')
  .description('List notes in the active context')
  .option('--view <v>', 'recent (last 7 days)')
  .option('--context <slug>', 'Override active context')
  .option('--all', 'All contexts')
  .option('--config <path>', 'Path to config file')
  .action((options) => runNoteList(options));

note
  .command('view <id>')
  .description('Print a note with resolved wiki-links')
  .option('--config <path>', 'Path to config file')
  .action((id, options) => runNoteView(id, options));

note
  .command('edit <id>')
  .description('Edit note in $EDITOR, or replace body directly with --body <text|@path>')
  .option('--body <text>', 'Replace note body directly without opening editor; prefix with @ to read from a file path')
  .option('--config <path>', 'Path to config file')
  .action((id, options) => runNoteEdit(id, options));

note
  .command('find')
  .description('Filter notes by tag or task')
  .option('--tag <tag>', 'Match notes containing this tag')
  .option('--task <id>', 'Match notes linked to this task')
  .option('--context <slug>', 'Override active context')
  .option('--all', 'All contexts')
  .option('--config <path>', 'Path to config file')
  .action((options) => runNoteFind(options));

// ── sab briefing ─────────────────────────────────────────────────────────────
program
  .command('briefing')
  .description('Run the daily briefing (read-only)')
  .option('--context <slug>', 'Run briefing for a different context')
  .option('--all', 'Show all repos under repos_dir, ignoring the context scope')
  .option('--weekly', 'Run the weekly briefing instead of the daily one')
  .option('--config <path>', 'Path to config file')
  .action((options) => runBriefing(options));

// ── sab standup ──────────────────────────────────────────────────────────────
program
  .command('standup')
  .description('Run a guided, slot-aware standup check-in')
  .option('--context <slug>', 'Override active context')
  .option('--slot <slot>', 'pre-work | wd-1 | wd-2 | wd-3 | post-work (overrides inference)')
  .option('--all', 'Not supported for standup — will error')
  .option('--config <path>', 'Path to config file')
  .action((options) => runStandup(options));

// ── sab retro ────────────────────────────────────────────────────────────────
program
  .command('retro')
  .description('Run a guided retro (project | feature | daily scope)')
  .option('--scope <scope>', 'project | feature | daily')
  .option('--task <id>', 'Task id (required for --scope feature)')
  .option('--context <slug>', 'Override active context')
  .option('--date <date>', 'YYYY-MM-DD (daily scope; defaults to today)')
  .option('--all', 'Not supported for retro — will error')
  .option('--config <path>', 'Path to config file')
  .action((options) => runRetro(options));

// ── sab git ──────────────────────────────────────────────────────────────────
const gitCmd = program.command('git').description('Inspect git state visible to Saboteur');

gitCmd
  .command('list')
  .description('List valid repos under repos_dir with their current branches')
  .option('--context <slug>', 'Mark repos scoped to a different context')
  .option('--config <path>', 'Path to config file')
  .action((options) => runGitList(options));

// ── sab sync ─────────────────────────────────────────────────────────────────
program
  .command('sync')
  .description('Rebuild the knowledge index from all enabled sources')
  .option('--config <path>', 'Path to config file')
  .action((options) => runSync(options));

// ── sab ui ───────────────────────────────────────────────────────────────────
const ui = program.command('ui').description('Manage the read-only UI server');

ui
  .command('start', { isDefault: true })
  .description('Start the UI server at http://127.0.0.1:9421')
  .action(() => runUi());

ui
  .command('stop')
  .description('Stop the UI server')
  .action(() => runUiStop());

program.parseAsync(process.argv);
