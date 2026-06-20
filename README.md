# Saboteur POS

Personal Operating System — a CLI for task and note management with context scoping, dependency tracking, and a daily briefing.

## Getting `sab` on your system

### Step 1 — Install and build

```bash
cd ~/Repositories/saboteur-pos
npm install
npm run build        # compiles TypeScript → dist/
```

### Step 2 — Link the binary

```bash
npm link
```

This registers `sab` in your global npm bin directory (e.g. `~/.nvm/versions/node/<version>/bin/sab`) as a symlink back to this repo. Node resolves `node_modules` from the project, so native addons like `better-sqlite3` work correctly.

Verify:

```bash
which sab            # → ~/.nvm/.../bin/sab
sab --version
```

**After editing source**, re-run `npm run build` to pick up changes. No re-link needed.

To remove: run `npm unlink` from this directory.

---

### First-time setup

```bash
sab init
```

Creates:

- `~/saboteur/saboteur.db` — SQLite database
- `~/saboteur/notes/` — Markdown notes directory
- `~/saboteur/saboteur.config.json` — config
- `~/saboteur/saboteur.secrets.json` — credentials template (gitignored)

## Quick reference

```
sab --help                     Full command reference
sab help task                  Task commands
sab help context               Context commands
sab help note                  Note commands
sab task help add              Flags for a specific command
```

## Daily workflow

```bash
sab briefing                   Morning situational awareness
sab briefing --weekly          7-day shipped / stalled / repo-activity report
sab task list --view today     Active tasks sorted by priority + energy
sab task add "Fix the thing" --priority high --energy deep
sab task move <id> active
sab task done <id>
```

`sab task list --view today` ranks your active tasks by priority then energy:

```console
$ sab task list --view today
ID           STATE    PRI   ENERGY   TITLE
------------------------------------------
task_1175853b active   high  deep     wire up table toolbar (0d)
task_5afb60a0 active   norm  deep     split parser module (0d)
```

## Contexts

Every task and note belongs to a context. Switch with:

```bash
sab context use <slug>
sab context show               # print active context
sab task list                  # scoped to active context
sab task list --all            # all contexts
```

`inbox` is a reserved context — always available, cannot be deleted.

## State machine

```
backlog → active → review → done
active  → backlog              (park it)
review  → active              (kick back from review)
any non-done → blocked → active
```

`done` is terminal and reachable **only** from `review` — an `active` task cannot jump straight to `done`. `blocked` is reachable from any non-done state. Moving a blocking task to `done` automatically unblocks dependents.

## Notes

Notes are Markdown files with YAML frontmatter. The `.md` file is the source of truth; SQLite is a derived index.

```bash
sab note new "Auth Flow Thoughts" --tag auth --task <id>
sab note new "Auth Flow Thoughts" --body "Initial thoughts here."   # no editor
sab note new "Auth Flow Thoughts" --body @notes-draft.md            # body from file
sab note view <id>             # print note with resolved wiki-links
sab note edit <id>             # open in $EDITOR
sab note edit <id> --body "Updated body."                           # no editor
sab note edit <id> --body @revised.md                              # body from file
sab note find --tag auth
sab sync                       # full rebuild of the knowledge index
```

Wiki-links in note bodies (`[[note_id]]` or `[[title-slug]]`) resolve at read time.

## Git integration

Saboteur scans the immediate subdirectories of `repos_dir` for git repos. The daily briefing gains a **Repo State** section listing each repo's branch (or `detached @ <sha>`), a clean/dirty indicator, and recent commits scoped to the active context — those linked to a task in it (shown with a `→ task` arrow), plus, for a monorepo sub-context, commits whose changed files fall in that sub-area even when unlinked (shown without an arrow). Branches whose latest commit is older than `briefing.stale_branch_days` (default `14`) appear in a **Stale Branches** subsection. Bare repos and repos that fail to read are surfaced in a one-line skipped footer.

### Setting up `repos_dir`

`repos_dir` defaults to `~/code`. Each immediate subdirectory that is a git working tree is picked up automatically — no per-repo registration. Bare repos and broken `.git` dirs are reported in the skipped footer instead of being scanned.

To scan more than one root, add `repos_dirs` (a JSON array of paths); it is unioned with `repos_dir`. If a repo basename appears under more than one root, it is ambiguous and excluded from both, with a warning.

Point it at the directory that holds your repos by editing `~/saboteur/saboteur.config.json`:

```json
{
    "repos_dir": "~/work/repos",
    "briefing": {
        "stale_branch_days": 14
    }
}
```

Paths starting with `~/` are expanded to your home directory. A typical layout:

```
~/work/repos/
├── varsentry/        ← working repo, gets scanned
├── omoikane/         ← working repo, gets scanned
└── archive.git/      ← bare repo, listed under "Skipped"
```

`sab git list` shows exactly what is picked up (`*` marks repos in the active context's scope):

```console
$ sab git list
Active context: inbox  (no repo scope set; all repos visible)

  omoikane   main
  varsentry  main

Skipped:
  archive.git  (bare)
```

To scope which repos appear under a specific context, link them with:

```bash
sab context repos add <context> <repo>              # link a whole repo
sab context repos add <context> <repo> --path '<glob>'   # link a monorepo sub-area
sab context repos                                    # (per context) list what's linked
```

This is stored in the context's `repos` array (the SQLite `contexts.repos` column — **not** `saboteur.config.json`). Each entry is either a repo directory name or, for a monorepo sub-context, `{ "repo": <name>, "paths": ["<glob>", …] }`. If the array is empty (the default), every working repo under `repos_dir` shows up for that context. See [Monorepo sub-contexts](#monorepo-sub-contexts) below for what `--path` buys you.

### Linking commits to tasks

Include the full task ID in square brackets in any commit message:

```
fix(login): fix login redirect [task_a1b2c3d4]
```

The next `sab briefing` indexes the commit, exposes it under `sab task view <id>`, and auto-updates the task's `repo` / `branch` fields. Bare task IDs, conventional-commit scopes, and trailers are intentionally ignored — the bracketed form is canonical.

### Monorepo sub-contexts

When several areas of one repo are tracked as separate contexts, restrict a context to a sub-area with `--path`:

```bash
sab context repos add platform-web platform --path 'apps/web/**'
sab context repos add platform-api platform --path 'apps/api/**'
```

Now `sab briefing` attributes each commit to the sub-context its changed files fall in (the area with the most matched files wins), and surfaces it under that context's **Repo State** — including commits with **no** task link, shown without the `→ task` arrow. A repo with no `--path` rules behaves exactly as before: only bracket-linked commits are indexed. Globs support `*` (within a path segment), `**` (across segments), and `?`.

```console
$ sab context repos platform-web
platform  [apps/web/**]

$ sab briefing --context platform-web
── Active Context: platform-web (platform-web) ──────────────────

── Active Tasks ──────────────────────────────
  task_30b4bf67  keep header row on paste
    high / deep / -  (0d in state)

── Repo State ────────────────────────────────
  platform  (main)  ✓ clean
    f4b60ef  refactor(web): tidy table parser  2026-06-19
    ab48794  fix(web): keep header row on paste [task_30b4bf67]  2026-06-19  → keep header row on paste
```

Both commits touched `apps/web`, so both appear under `platform-web`. The linked one carries `→ keep header row on paste`; the `refactor` has no arrow — the cue that work landed here without being tracked.

All git reads are local — no network access.

## Config

`~/saboteur/saboteur.config.json` — paths, active context, stale task / stale branch thresholds, `repos_dir` (and optional `repos_dirs` for extra roots).
`~/saboteur/saboteur.secrets.json` — credentials only (gitignored, never in config).

## Tests

```bash
npm test          # run all integration tests
npm run test:watch
```

## Architecture

| Layer        | What                                                                                |
| ------------ | ----------------------------------------------------------------------------------- |
| SQLite       | Tasks, contexts, knowledge index (derived cache), commits (derived from git)        |
| Markdown     | Notes — source of truth                                                             |
| Git repos    | Source of truth for repo/branch state and commits; scanned locally from `repos_dir` |
| Config JSON  | Runtime config — paths, active context                                              |
| Secrets JSON | Plugin credentials — gitignored                                                     |

See `Docs/CoreSpec/` for the full behavioral spec (LOGIC.md, SCHEMA.md, CLI.md, PHASES.md).
