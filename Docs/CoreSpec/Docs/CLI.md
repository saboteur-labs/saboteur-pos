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

### `sab standup`

Run a guided, slot-aware standup check-in for the active context (or `--context`). Always writes to a single context — `--all` is rejected.

- Slot is inferred from the current local time via `standup.slot_windows` in config, unless `--slot` is passed explicitly.
- Recaps (read-only) tasks moved to `done` since the last standup in this context, their linked commits, currently blocked tasks, and the answers to the prior standup's "working on" / "must get done" questions.
- Asks a slot-specific question set, then writes the answers as a note (`tags: ['standup']`, frontmatter `slot: <slot>`).

**Slots:** `pre-work` | `wd-1` | `wd-2` | `wd-3` | `post-work`

**Flags:**
| Flag | Values | Default |
|---|---|---|
| `--context <slug>` | any valid context slug | active_context |
| `--slot <slot>` | pre-work \| wd-1 \| wd-2 \| wd-3 \| post-work | inferred from `standup.slot_windows` |
| `--config <path>` | path to config file | default config path |

**Output:**

```
Created note_abc123: "Standup — wd-1 — 2026-07-09" → ~/saboteur/notes/2026-07-09-standup-a1b2c3d4.md
```

Filename is `<date>-<primary tag>-<random suffix>.md` (not the slugified-title form `sab note new` uses) so repeated same-day check-ins never collide. Discoverable later via `sab note find --tag standup`.

**Errors:**

- `--all` passed → `"--all is not meaningful for sab standup — it always writes to a single context. Use --context <slug> instead."`
- Unknown context → `"Context '<slug>' does not exist."`
- Invalid `--slot` → `"Invalid slot '<slot>'. Valid slots: pre-work, wd-1, wd-2, wd-3, post-work."`
- No `--slot` given and no configured window contains the current time → `"No configured standup.slot_windows window contains the current time (HH:MM)."`

---

### `sab retro`

Run a guided, scope-aware retro. Always writes to a single context — `--all` is rejected.

- `--scope` is required: `project`, `feature`, or `daily`.
  - `feature` requires `--task <id>`; the task id is the `scope_ref`.
  - `project` scopes to the active context (or `--context`); the context slug is the `scope_ref`. Recap window defaults to `retro.project_window_days` (14 days).
  - `daily` scopes to a date (`--date YYYY-MM-DD`, defaults to today); the date is the `scope_ref`.
- Recaps (read-only) shipped tasks and linked commits for the scope.
- Asks the full 10-question set for `project`/`feature`, or a fixed 3-question set for `daily`.
- Writes the answers as a note (`tags: ['retro']`, frontmatter `scope: <scope>`, `scope_ref: <ref>`).

**Flags:**
| Flag | Values | Default |
|---|---|---|
| `--scope <scope>` | project \| feature \| daily | required |
| `--task <id>` | task id | required for `--scope feature` |
| `--context <slug>` | any valid context slug | active_context |
| `--date <date>` | YYYY-MM-DD | today (daily scope only) |
| `--config <path>` | path to config file | default config path |

**Output:**

```
Created note_def456: "Retro — project — varsentry — 2026-07-09" → ~/saboteur/notes/2026-07-09-retro-b2c3d4e5.md
```

Filename is `<date>-<primary tag>-<random suffix>.md` (not the slugified-title form `sab note new` uses) so repeated same-day check-ins never collide. Discoverable later via `sab note find --tag retro`.

**Errors:**

- `--all` passed → `"--all is not meaningful for sab retro — it always writes to a single context. Use --context <slug> instead."`
- Missing/invalid `--scope` → `"--scope is required and must be one of: project, feature, daily."`
- `--scope feature` without `--task` → `"--task <id> is required for --scope feature."`
- Unknown task → `"Task '<id>' not found."`
- Unknown context → `"Context '<slug>' does not exist."`
- Invalid `--date` → `"Invalid --date '<date>'. Expected format: YYYY-MM-DD."`

---

### `sab kaizen`

Run the guided weekly Kaizen review, driven by the user-owned template at `~/saboteur/templates/kaizen.md`. Always writes to a single context — `--all` is rejected.

- The template is opened **read-only**. A review never writes it; the only CLI path that does is `sab kaizen template edit`.
- Section 3's project snapshots and section 5's bandwidth rows are generated from your `sab` contexts (excluding `inbox`), not from headings in the template — adding or retiring a repo needs no template edit.
- Before each project snapshot, recaps (read-only) that context's tasks moved to `done` since the start of the week, their linked commits, and currently blocked tasks.
- Section 2 is prefilled with the intentions recorded by the previous Kaizen note in this context; you answer only the outcome and why.
- Writes the answers as a note (`tags: ['kaizen']`, frontmatter `week_of`, `template_path`, `template_hash`, `template_version`, `intentions`).

**Flags:**
| Flag | Values | Default |
|---|---|---|
| `--context <slug>` | any valid context slug | active_context |
| `--week-of <date>` | YYYY-MM-DD | Monday of the current week |
| `--template <path>` | path to an alternate template | `<config dir>/templates/kaizen.md` |
| `--edit-template` | — | opens `$EDITOR` and exits without running a review |
| `--config <path>` | path to config file | default config path |

**Question order.** Questions are asked in template order, sections 1 → 7, with two deliberate exceptions:

- `time_spent` is asked **last** and rendered in its template position — it measures the review, so asking it second (where the template places it) would offer a default of zero.
- A field carrying `when="..."` is asked only when its condition holds against answers already collected.

**Output:**

```
Kaizen review saved.
  note_af26e297
  ~/saboteur/notes/2026-08-03-kaizen-a9e8dc6a.md
```

Filename is `<week-of>-kaizen-<random suffix>.md` — dated by the week under review rather than the day written, with a random suffix so repeating a week never overwrites the earlier note. Discoverable via `sab note find --tag kaizen`.

**Errors:**

- `--all` passed → `"--all is not meaningful for sab kaizen — it always writes to a single context. Sections 3 and 5 already cover every context. Use --context <slug> instead."`
- Invalid `--week-of` → `"--week-of must be a date as YYYY-MM-DD."`
- Unknown context → `"Context '<slug>' does not exist."`
- No template at the resolved path → `"No Kaizen template found at <path>. Run 'sab init' to create one."`
- Template declares an unsupported `schema` → names the supported version, and whether to upgrade `sab` or update the template.
- Template missing a required section → names the section, and fails **before the first question**.

---

### `sab kaizen template edit`

Open the Kaizen template in `$EDITOR`. This and `sab kaizen --edit-template` are the only CLI paths that write the template.

**Errors:**

- No `$EDITOR` → `"No $EDITOR set. Export EDITOR=<your editor> and try again."`
- No template at the resolved path → `"No Kaizen template found at <path>. Run 'sab init' to create one."`

---

## The Kaizen Template Annotation Contract

The Kaizen template is both a human document and a machine schema. Structure is carried entirely by `<!-- sab:* -->` HTML comments, which are invisible in rendered markdown. **Nothing is inferred from prose, heading text, or list formatting** — which is what lets a review reproduce the template's prose byte-for-byte into the note, since the parser never has to interpret the words it preserves.

The file must open with frontmatter carrying `template: kaizen`, `template_version`, and `schema`.

### Directives

| Directive | Purpose | Key attributes |
|---|---|---|
| `sab:section` | Section boundary | `id`, `title`, `minutes` |
| `sab:field` | One answerable prompt | `id`, `type`, `required`, `when`, `default` |
| `sab:followup` | Conditional extra prompt | `when`, `field`, `type` |
| `sab:table` | Tabular answers | `id`, `rows`, `exclude`, `empty-message`, `warn-unless-sums-to` |
| `sab:column` | Column within a table | `id`, `type`, `values`, `source`, `prompt` |
| `sab:fixed-rows` | Literal rows appended to a generated table | quoted row labels |
| `sab:repeat` / `sab:end-repeat` | Block repeated per source item | `id`, `source`, `exclude`, `order`, `skippable`, `skip-reason`, `recap` |
| `sab:extra` | Fields appended to one context's snapshot | `context` (slug) |
| `sab:list` | Bounded list of answers | `id`, `type`, `min`, `max`, `carries-forward-to` |

A directive sits on its own line, immediately above the prose it governs.

### Field types

`scale` (needs `min`/`max`), `word`, `text`, `longtext`, `enum` (needs `values`, pipe-separated), `percent`, `date`, `duration`.

`longtext` reads lines until a blank one; every other type takes a single line.

### `when` expressions

Equality, inequality, and numeric comparison against a **single earlier field**, joined by `and` / `or` — e.g. `energy<=2 or focus<=2`, `matches_priorities!=Y`. `and` binds tighter than `or`. A field that has not been answered makes its comparison false, whatever the operator.

### Validation

Checked at load time, before the first question is asked:

- All seven sections present (`pulse-check`, `intentions-review`, `project-snapshots`, `kaizen-question`, `bandwidth`, `next-intentions`, `honest-note`).
- Ids unique within their scope. An `sab:extra` field is checked against the repeat it extends, since both feed the same per-item answer namespace.
- `enum` has `values`; `scale` has numeric `min` below `max`.
- Every `when` parses and references a field prompted **earlier** — a condition on a later answer could never hold, so it would silently suppress its own prompt.
- `carries-forward-to` names a table that exists.

An **unrecognised** `sab:*` directive is a warning on stderr, not an error — the run continues without it. An `sab:extra` whose slug matches no current context is ignored silently, so retiring a project needs no template edit.

### Placeholders

Two constructs in the template are replaced rather than reproduced: a markdown table block following a `sab:table` (its header row is kept, its empty body rows replaced), and an empty numbered list following a `sab:list`. `{{ context.name }}` and `{{ context.slug }}` are substituted inside a `sab:repeat`.

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
