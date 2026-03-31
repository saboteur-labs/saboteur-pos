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
sab note find --tag auth
sab sync                       # full rebuild of the knowledge index
```

Wiki-links in note bodies (`[[note_id]]` or `[[title-slug]]`) resolve at read time.

## Config

`~/saboteur/saboteur.config.json` — paths, active context, stale task threshold.
`~/saboteur/saboteur.secrets.json` — credentials only (gitignored, never in config).

## Tests

```bash
npm test          # run all integration tests
npm run test:watch
```

## Architecture

| Layer | What |
|---|---|
| SQLite | Tasks, contexts, knowledge index (derived cache) |
| Markdown | Notes — source of truth |
| Config JSON | Runtime config — paths, active context |
| Secrets JSON | Plugin credentials — gitignored |

See `Docs/CoreSpec/` for the full behavioral spec (LOGIC.md, SCHEMA.md, CLI.md, PHASES.md).
