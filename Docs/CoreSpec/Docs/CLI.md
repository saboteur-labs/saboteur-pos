# Saboteur POS — CLI

> Complete command grammar and input/output contracts.
> Every command the system accepts is documented here with its flags, expected output, and error cases.
> For behavioral rules behind commands, see LOGIC.md. For data shapes, see SCHEMA.md.

---

## Grammar

```
sab <noun> <verb> [target] [flags]
```

Noun-first. `sab task <TAB>` surfaces all task operations. Grouping by noun keeps autocomplete useful as the command surface grows.

All commands exit `0` on success, non-zero on failure. Errors go to stderr. Output goes to stdout.

---

## Global Flags

These flags are valid on any command that reads data:

| Flag               | Behavior                                                         |
| ------------------ | ---------------------------------------------------------------- |
| `--context <slug>` | Override active context for this command only. Does not persist. |
| `--all`            | Bypass context filter. Returns results across all contexts.      |

---

## Task Commands

### `sab task add <title>`

Create a new task.

- `title` is required. Wrap in quotes if it contains spaces.
- Assigned to `active_context` unless `--context` is passed.
- `state` defaults to `backlog`.
- `priority` defaults to `normal`.
- `id` is generated as a UUID (short prefix form acceptable, e.g. `task_abc123`).
- Writes `created_at` and `updated_at` to current timestamp.
- Appends initial state to `state_history`: `{ "state": "backlog", "timestamp": "..." }`

**Flags:**
| Flag | Values | Default |
|---|---|---|
| `--context <slug>` | any valid context slug | active_context |
| `--priority <p>` | critical \| high \| normal \| low | normal |
| `--energy <e>` | deep \| shallow \| admin | null |
| `--effort <e>` | xs \| s \| m \| l \| xl | null |
| `--repo <name>` | string | null (Phase 1 manual entry) |

**Output:**

```
Created task task_abc123: "Fix auth bug"
```

**Errors:**

- Missing title → `"Title is required."`
- Unknown context → `"Context 'foo' does not exist. Run 'sab context list' to see available contexts."`

---

### `sab task list`

List tasks in the active context.

- Default view: all non-done tasks in active context, sorted by priority desc.
- Columns: ID (short), title, state, priority, energy, effort, days in current state.

**Flags:**
| Flag | Values |
|---|---|
| `--view <v>` | today \| active \| backlog \| blocked \| review \| deep-work \| stale |
| `--context <slug>` | override context |
| `--all` | all contexts |

**Output (tabular):**

```
ID          STATE     PRI     ENERGY   TITLE
task_abc1   active    high    deep     Fix auth bug                  (2d)
task_def2   backlog   normal  -        Write migration script        (5d)
```

---

### `sab task view <id>`

Show full detail for a single task.

**Output:**

```
task_abc123 — Fix auth bug
─────────────────────────────
State:    active (3 days)
Context:  varsentry
Priority: high
Energy:   deep
Effort:   m
Repo:     varsentry-api          (□ Phase 2a)
Branch:   feature/auth-rework    (□ Phase 2a)
Note:     note_xyz789 — Auth Flow Thoughts

Blocks:   task_ghi3 — Deploy to staging
Blocked by: (none)

State history:
  backlog    → 2026-03-20 09:00
  active     → 2026-03-22 10:15
```

---

### `sab task move <id> <state>`

Transition a task to a new state. Validates against the state machine.

- Appends to `state_history` on success.
- On move to `done`: triggers unblocking logic (see LOGIC.md §8).

**Valid states:** `backlog`, `active`, `blocked`, `review`, `done`

**Output:**

```
task_abc123: backlog → active
```

**Errors:**

- Invalid transition → `"Cannot move task from 'done' to 'active'. No transitions out of 'done'."`
- Unknown task → `"Task 'task_xyz' not found."`

---

### `sab task done <id>`

Shorthand for `sab task move <id> done`.

---

### `sab task block <id>`

Shorthand for `sab task move <id> blocked`.

---

### `sab task edit <id>`

Open task metadata in `$EDITOR` as a temporary YAML file. On save and close, parse and write back to the database.

**Editable fields:** `title`, `priority`, `energy`, `effort`, `repo`, `branch`
**Non-editable fields (shown but ignored if changed):** `id`, `state`, `context_id`, `created_at`, `state_history`

**Errors:**

- `$EDITOR` not set → `"No $EDITOR set. Export EDITOR=<your editor> and try again."`
- Validation failure on save → print error and re-open editor with the error at the top of the file

---

### `sab task link <id> --note <note_id>`

Link a note to a task.

- Sets `task.note_id = note_id`
- Sets `knowledge_index.task_id = task_id` for the note row
- A task can only be linked to one note directly. Additional notes can reference the task via their frontmatter `task_id`.

**Output:**

```
Linked note_xyz789 to task_abc123.
```

---

### `sab task link <id> --blocks <other_id>`

Create a block relationship: `<id>` blocks `<other_id>`.

- Appends `other_id` to `task.blocks`
- Appends `id` to `other_task.blocked_by`
- Checks for circular dependencies before writing (see LOGIC.md §8)

**Output:**

```
task_abc123 now blocks task_ghi456.
```

**Errors:**

- Circular dependency → `"Cannot create circular dependency: task_abc123 → task_ghi456 → ... → task_abc123."`

---

### `sab task delete <id>`

Permanently delete a task from the database.

- Safe by default: refuses if the task has any dependency links (`blocks` or `blocked_by` is non-empty).
- Deletion is allowed for tasks in any state, including `done`.
- All operations run in a single transaction — no partial state.

**Flags:**
| Flag | Behavior |
|---|---|
| `--force` | Delete even if task has dependency links |

**`--force` behavior:**
1. For each task in `blocked_by` (tasks blocking this one): removes this task from their `blocks` array.
2. For each task in `blocks` (tasks this one blocks): removes this task from their `blocked_by` array; if `blocked_by` becomes empty and that task's state is `blocked`, auto-transitions it to `active` (same logic as LOGIC.md §8).
3. If a note is linked (`note_id` is set): sets `knowledge_index.task_id = NULL` for that note. The note file itself is not deleted.
4. Deletes the task row.

**Output:**

```
Deleted task: Fix auth bug
```

**Errors:**

- Task not found → `"Task 'task_xyz' not found."`
- Has dependency links (no `--force`) → `"'Fix auth bug' has 2 outgoing and 1 incoming dependency links. Use --force to delete anyway."`

---

## Note Commands

### `sab note new <title>`

Create a new note.

- Generates a UUID for `id`
- Creates a `.md` file in the personal-notes source path
- Filename: slugified title + `.md`, e.g. `auth-flow-thoughts.md`
- Writes pre-populated frontmatter (see SCHEMA.md for format)
- Opens `$EDITOR` on the new file
- Indexes the note in `knowledge_index` after editor closes

**Flags:**
| Flag | Values |
|---|---|
| `--context <slug>` | set context in frontmatter |
| `--task <id>` | pre-populate `task_id` in frontmatter |
| `--tag <tag>` | add a tag (repeatable: `--tag auth --tag backend`) |

**Output:**

```
Created note_abc123: "Auth Flow Thoughts" → ~/saboteur/notes/auth-flow-thoughts.md
```

---

### `sab note list`

List notes in the active context.

- Queries `knowledge_index` where `context_id = active_context` and `type = 'note'`
- Columns: ID (short), title, tags, linked task, updated date

**Flags:**
| Flag | Values |
|---|---|
| `--view` | `recent` (last 7 days by updated_at) |
| `--context <slug>` | override context |
| `--all` | all contexts |

---

### `sab note view <id>`

Print the full note (frontmatter + body) to stdout.

- Resolves any `[[wiki-links]]` to titles for display
- Unresolved links shown as `[[broken: <slug>]]`

---

### `sab note edit <id>`

Open the note's `.md` file directly in `$EDITOR`.

- After close: re-parse frontmatter, update `updated_at`, re-index in `knowledge_index`

---

### `sab note find`

Filter notes by criteria. At least one flag required.

**Flags:**
| Flag | Behavior |
|---|---|
| `--tag <tag>` | Match notes where tags array contains `<tag>` |
| `--task <id>` | Match notes where `task_id = <id>` |
| `--context <slug>` | Override active context |
| `--all` | All contexts |

**Examples:**

```
sab note find --tag auth
sab note find --task task_abc123
sab note find --tag auth --context varsentry
```

---

## Context Commands

### `sab context list`

List all contexts with counts.

**Output:**

```
CONTEXT       TASKS   NOTES
inbox         3       1
varsentry     12      8
saboteur      4       2
```

---

### `sab context new <slug>`

Create a new context.

- `slug` must be lowercase, alphanumeric, hyphens allowed, no spaces
- `slug` must be unique
- `inbox` is reserved — reject if attempted

**Flags:**
| Flag | Values |
|---|---|
| `--name <name>` | Display name. Defaults to slug if not provided. |
| `--description <desc>` | Optional one-sentence description. |

**Output:**

```
Created context: varsentry
```

**Errors:**

- Slug already exists → `"Context 'varsentry' already exists."`
- Reserved slug → `"'inbox' is a reserved context name."`
- Invalid slug format → `"Slug must be lowercase alphanumeric with optional hyphens."`

---

### `sab context use <slug>`

Set the active context. Persists to `saboteur.config.json`.

**Output:**

```
Active context: varsentry
```

---

### `sab context show`

Print the currently active context.

**Output:**

```
varsentry
```

---

### `sab context delete <slug>`

Delete a context. See LOGIC.md §4 for full deletion behavior.

**Flags:**
| Flag | Behavior |
|---|---|
| `--reassign <slug>` | Migrate all items to `<slug>` before deleting |
| `--force` | Orphan all items to `inbox` before deleting |

**Errors:**

- Deleting `inbox` → `"inbox is a reserved context and cannot be deleted."`
- Items exist, no flag → `"<slug> has <N> tasks and <M> notes. Use --reassign <context> or --force."`
- `--reassign` target does not exist → `"Context '<target>' does not exist."`

---

### `sab context repos <slug>` · `add` · `remove`

Manage the repos a context owns (its `repos` array). The bare command lists them; `add`/`remove` link and unlink. A repo must be discoverable under `repos_dir` (see `sab git list`) to be linked.

```
sab context repos <slug>                      # list linked repos
sab context repos add <slug> <repo...>        # link one or more whole repos
sab context repos add <slug> <repo> --path <glob>   # link a monorepo sub-area
sab context repos remove <slug> <repo...>     # unlink
```

**`add` flags:**
| Flag | Behavior |
|---|---|
| `--path <glob>` | Restrict a **single** repo to a sub-path glob, making this context a monorepo **sub-context**. Stores `{ "repo": <repo>, "paths": [<glob>,…] }` and lifts an existing bare-string entry into that form. Repeatable to add more globs. Globs support `*` (within a segment), `**` (across segments), and `?`. |

With `--path`, commits whose changed files fall under `<glob>` are attributed to `<slug>` and surface in its briefing even without a task link (see SCHEMA.md `commits.sub_context`). Without it, the whole repo is linked as before.

**Errors:**

- Repo not under `repos_dir` → `"'<repo>' not found under repos_dir. Run 'sab git list' to see available repos."`
- `--path` with more than one repo → `"--path takes exactly one repo (got <N>)."`

---

## System Commands

### `sab briefing`

Run the daily briefing for the active context. Read-only. See LOGIC.md §7 for full composition rules.

**Flags:**
| Flag | Behavior |
|---|---|
| `--context <slug>` | Run briefing for a different context |

---

### `sab sync`

Rebuild the knowledge index from all enabled sources. See LOGIC.md §9.

**Output:**

```
Synced 42 entries from 1 source.
```

---

### `sab init`

Initialize a new Saboteur workspace. See LOGIC.md §1.

**Flags:**
| Flag | Behavior |
|---|---|
| `--config <path>` | Initialize from an existing config file. Used for machine migration. |

**Output:**

```
Initialized Saboteur workspace.
  DB:     ~/saboteur/saboteur.db
  Notes:  ~/saboteur/notes
  Config: ~/saboteur/saboteur.config.json
```

---

### `sab status`

Print system state. Read-only. See LOGIC.md §10.

---

### `sab ui`

Start the local React dashboard on port 9421. Phase 2b.

- Starts the server as a background process
- Prints confirmation with the URL and exits
- If port 9421 is already in use: print status and exit cleanly (idempotent)
- Does not manage the process lifecycle — that is the user's responsibility

**Output (success):**

```
Saboteur UI running at http://localhost:9421
```

**Output (already running):**

```
Saboteur UI already running at http://localhost:9421
```

---

### `sab plugin list` (Phase 2c)

List all registered plugins and their enabled status.

### `sab plugin enable <name>` (Phase 2c)

Enable a plugin. Plugin registers its sources and data slots.

### `sab plugin disable <name>` (Phase 2c)

Disable a plugin. Plugin deregisters its sources and data slots. Core data is unaffected.
