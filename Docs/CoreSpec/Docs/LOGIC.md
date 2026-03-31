# Saboteur POS — LOGIC

> All behavioral rules for the system.
> This document answers "what does the system do" — not how commands are invoked (see CLI.md) and not how data is shaped (see SCHEMA.md).
> An implementing agent working on any feature should read this document in full before writing code.

---

## 1. Initialization (`sab init`)

On first run, `sab init` must:

1. Create the directory structure if it does not exist:
    - `db_path` parent directory
    - `notes` directory (from `sources[0].path`)
2. Create `saboteur.db` and run all `CREATE TABLE` statements from SCHEMA.md
3. Seed the `inbox` context:
    ```sql
    INSERT INTO contexts VALUES ('inbox', 'Inbox', 'Default context for unsorted items', '[]', <now>);
    ```
4. Seed the `personal-notes` source in the `sources` table
5. Write `saboteur.config.json` with defaults (see SCHEMA.md)
6. Create `saboteur.secrets.json` as an empty template and add it to `.gitignore` in the workspace root
7. Print a confirmation with the paths used

On `sab init --config <path>`, read the existing config and skip steps that are already satisfied. Do not overwrite existing data.

---

## 2. Task State Machine

The task lifecycle is a formal state machine. Any transition not listed here must be rejected with a clear error message.

```
backlog → active
active  → blocked
active  → review
active  → backlog
blocked → active
review  → done
review  → active
any     → blocked    (blocked can be set from any non-done state)
```

**Rules:**

- `done` is a terminal state. No transitions out of `done`.
- Setting `blocked` from any state is always valid (except `done`).
- Every successful transition must:
    1. Update `state` on the task row
    2. Update `updated_at` to the current timestamp
    3. Append `{ "state": "<new_state>", "timestamp": "<ISO8601>" }` to `state_history`
- Invalid transitions must fail with a human-readable message: `"Cannot move task from 'done' to 'active'. No transitions out of 'done'."`

---

## 3. Context Scoping

Context is the active lens for all read and write operations.

**Active context:**

- Stored in `saboteur.config.json` as `active_context`
- Set by `sab context use <slug>`
- All commands default to filtering by `active_context` unless overridden

**Scope override:**

- `--context <slug>` on any command overrides `active_context` for that command only. Does not persist.
- `--all` on any command bypasses context filtering entirely. Returns results across all contexts.

**On task/note creation:**

- If `--context` is not passed, the item is assigned to `active_context`
- If `active_context` is `inbox` and no `--context` is passed, the item lands in `inbox`

**inbox rules:**

- `inbox` is a reserved context created on `sab init`
- It cannot be deleted, renamed, or reassigned as a plugin-owned source
- It is always the fallback assignment context
- `inbox` items surface at the top of `sab briefing` regardless of the active context

---

## 4. Context Deletion

`sab context delete <slug>` follows a safe-by-default policy.

**Step 1 — Guard against reserved contexts:**

- If `slug == 'inbox'`, reject immediately: `"inbox is a reserved context and cannot be deleted."`

**Step 2 — Check for attached items:**

- Count tasks with `context_id = slug`
- Count knowledge_index rows with `context_id = slug`
- If either count > 0 and neither `--reassign` nor `--force` is passed:
    - Reject with: `"<slug> has <N> tasks and <M> notes. Use --reassign <context> to migrate them, or --force to orphan them to inbox."`

**Step 3a — `--reassign <target>`:**

- Validate `target` context exists
- Update all tasks: `SET context_id = target WHERE context_id = slug`
- Update all knowledge_index rows: `SET context_id = target WHERE context_id = slug`
- Delete the context row
- Print: `"Migrated <N> tasks and <M> notes to <target>. Deleted <slug>."`

**Step 3b — `--force`:**

- Update all tasks: `SET context_id = 'inbox' WHERE context_id = slug`
- Update all knowledge_index rows: `SET context_id = 'inbox' WHERE context_id = slug`
- Delete the context row
- Print: `"Orphaned <N> tasks and <M> notes to inbox. Deleted <slug>."`

---

## 5. Knowledge Index Sync

The knowledge index is a derived cache of all registered sources. The `.md` file is always the source of truth.

**When sync runs:**

- `sab sync` — explicit full rebuild
- Automatically before any `sab note` query command (incremental: check `updated_at` on disk vs index)

**Full sync algorithm (per source):**

1. For each enabled source in the `sources` table:
    1. List all `.md` files in `source.path` (recursive)
    2. Parse YAML frontmatter from each file
    3. Delete all existing `knowledge_index` rows where `source_id = source.id`
    4. Insert a new row for each file using frontmatter values
2. Print: `"Synced <N> entries from <M> sources."`

**Incremental sync algorithm:**

1. For each `.md` file in enabled sources:
    1. Compare file `mtime` to `knowledge_index.updated_at`
    2. If file is newer: delete the existing row and re-insert from frontmatter
    3. If file no longer exists: delete the row

**Frontmatter parsing rules:**

- If `id` is missing from frontmatter: generate a UUID, write it back to the file, then index
- If `context` is missing: use the source's `context_id` if set, otherwise use `active_context`
- If `tags` is missing: default to `[]`
- Malformed frontmatter: log a warning and skip the file — do not crash

---

## 6. Wiki-Style Note Linking

Notes support wiki-style links in their body content. The system must resolve these at read time.

**Link formats:**

- `[[note_abc123]]` — link by ID (preferred, stable)
- `[[auth-flow-thoughts]]` — link by title slug (resolved to ID at read time)

**Resolution:**

- Query `knowledge_index` for a matching `id` or slugified `title`
- If found: render as a reference to that note
- If not found: render as unresolved link with a visual indicator (e.g. `[[broken: auth-flow-thoughts]]`)

**Slug generation:** lowercase, replace spaces and special characters with hyphens, strip leading/trailing hyphens.

---

## 7. Daily Briefing Composition

`sab briefing` composes a read-only situational awareness report. It must never modify data.

**Output sections, in order:**

### Section 1 — Inbox

- Always rendered, even when a non-inbox context is active
- Query: `SELECT COUNT(*) FROM tasks WHERE context_id = 'inbox'`
- Query: `SELECT COUNT(*) FROM knowledge_index WHERE context_id = 'inbox'`
- Format: `"Inbox: <N> unsorted tasks, <M> unsorted notes"`
- If both counts are 0: omit this section entirely

### Section 2 — Active Context

- Print the active context slug and name

### Section 3 — Active Tasks

- Query: tasks where `state = 'active'` and `context_id = active_context`
- Sort: priority desc, energy desc (critical > high > normal > low; deep > shallow > admin)
- Show: title, priority, energy, effort, days in current state

### Section 4 — Stale Tasks

- Query: tasks where `state = 'active'` and `updated_at < now - stale_task_days` and `context_id = active_context`
- If count = 0: omit this section
- Show: title, days since last state change
- This is a subset of active tasks — do not double-list. Show stale tasks in this section, exclude them from Section 3.

### Section 5 — Blocked Tasks

- Query: tasks where `state = 'blocked'` and `context_id = active_context`
- For each blocked task: list the task IDs in `blocked_by`, resolve their titles
- If count = 0: omit this section

### Section 6 — In Review

- Query: tasks where `state = 'review'` and `context_id = active_context`
- If count = 0: omit this section

### Section 7 — Yesterday's Notes

- Query: `knowledge_index` where `updated_at >= datetime('now', '-1 day')` and `context_id = active_context`
- If count = 0: omit this section
- Show: title, type, linked task title if `task_id` is set

**Empty briefing:** If all sections after Section 2 are empty, print: `"Nothing active in <context>. Check your inbox or backlog."`

---

## 8. Dependency Logic

Tasks can block other tasks. The `blocks` and `blocked_by` arrays are managed in pairs — both sides of the relationship must always be kept in sync.

**When task A is linked to block task B (`sab task link A --blocks B`):**

1. Append `B` to `A.blocks`
2. Append `A` to `B.blocked_by`
3. Update `updated_at` on both tasks

**When task A is moved to `done`:**

1. For each task ID in `A.blocks`:
    - Remove `A` from that task's `blocked_by` array
    - If `blocked_by` is now empty and the task is in `blocked` state: automatically move it to `active` and note the reason in `state_history`: `{ "state": "active", "timestamp": "...", "reason": "unblocked by task_abc123" }`
2. Update `updated_at` on all affected tasks

**Cycle detection:** Before adding a block relationship, verify that B does not already (directly or transitively) block A. If a cycle is detected, reject with: `"Cannot create circular dependency: <A> → <B> → ... → <A>."`

---

## 9. `sab sync` Behavior

`sab sync` is a safe, idempotent operation. It can be run at any time without side effects on task data.

- Rebuilds the knowledge index from all enabled sources (see section 5)
- Does not modify tasks, contexts, or config
- Does not delete notes from disk
- Prints a summary on completion
- Should be fast enough to run automatically before note queries without user-perceivable delay

---

## 10. `sab status` Output

`sab status` prints system state for debugging and verification. It must never modify data.

Output must include:

- Config file path
- DB path
- Notes path (from sources registry)
- Active context
- Task counts by state (total, across all contexts)
- Number of indexed knowledge entries
- Number of registered sources

---

## 11. Error Handling Principles

- Every command must exit with a non-zero code on failure
- Every error must print a human-readable message to stderr
- Errors must never leave the database in a partial state — use transactions for multi-step writes
- If the config file is missing or malformed, print a clear message pointing to `sab init`
- If the DB is missing, print a clear message pointing to `sab init`
- If `$EDITOR` is not set when a note or task edit is triggered, print: `"No \$EDITOR set. Export EDITOR=<your editor> and try again."`
