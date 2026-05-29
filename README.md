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
any non-done → blocked → active
active → backlog
```

`done` is terminal. Moving a blocking task to `done` automatically unblocks dependents.

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

Saboteur scans the immediate subdirectories of `repos_dir` for git repos. The daily briefing gains a **Repo State** section listing each repo's branch (or `detached @ <sha>`), a clean/dirty indicator, and recent task-linked commits scoped to the active context. Branches whose latest commit is older than `briefing.stale_branch_days` (default `14`) appear in a **Stale Branches** subsection. Bare repos and repos that fail to read are surfaced in a one-line skipped footer.

### Setting up `repos_dir`

`repos_dir` defaults to `~/code`. Each immediate subdirectory that is a git working tree is picked up automatically — no per-repo registration. Bare repos and broken `.git` dirs are reported in the skipped footer instead of being scanned.

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

To scope which repos appear under a specific context, set `contexts.repos` for that context (a JSON array of repo directory names) by editing `saboteur.config.json` or the SQLite `contexts.repos` column. If the array is empty (the default), every working repo under `repos_dir` shows up for that context.

### Linking commits to tasks

Include the full task ID in square brackets in any commit message:

```
fix login redirect [task_a1b2c3d4]
```

The next `sab briefing` indexes the commit, exposes it under `sab task view <id>`, and auto-updates the task's `repo` / `branch` fields. Bare task IDs, conventional-commit scopes, and trailers are intentionally ignored — the bracketed form is canonical.

All git reads are local — no network access.

## Config

`~/saboteur/saboteur.config.json` — paths, active context, stale task / stale branch thresholds, `repos_dir`.
`~/saboteur/saboteur.secrets.json` — credentials only (gitignored, never in config).

## Tests

```bash
npm test          # run all integration tests
npm run test:watch
```

## Architecture

| Layer | What |
|---|---|
| SQLite | Tasks, contexts, knowledge index (derived cache), commits (derived from git) |
| Markdown | Notes — source of truth |
| Git repos | Source of truth for repo/branch state and commits; scanned locally from `repos_dir` |
| Config JSON | Runtime config — paths, active context |
| Secrets JSON | Plugin credentials — gitignored |

See `Docs/CoreSpec/` for the full behavioral spec (LOGIC.md, SCHEMA.md, CLI.md, PHASES.md).
