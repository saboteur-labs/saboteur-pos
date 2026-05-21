# Saboteur POS — SCHEMA

> Single source of truth for all data structures.
> When a field name, type, or constraint appears anywhere else in the codebase, it must match this document exactly.
> Fields marked `□` are Phase 2+ stubs — create the column, leave it nullable, do not wire logic to it in Phase 1.

---

## Storage Overview

| Entity           | Storage                     | Notes                                                                    |
| ---------------- | --------------------------- | ------------------------------------------------------------------------ |
| Tasks            | SQLite (`saboteur.db`)      | Queryable, stateful, requires dependency resolution                      |
| Contexts         | SQLite (`saboteur.db`)      | Lightweight, frequently joined with tasks                                |
| Knowledge Index  | SQLite (`saboteur.db`)      | Multi-source index; personal notes only in Phase 1                       |
| Sources Registry | SQLite (`saboteur.db`)      | Tracks registered knowledge sources                                      |
| Notes            | Markdown + YAML frontmatter | Source of truth is the `.md` file; SQLite is a derived index             |
| Config           | `saboteur.config.json`      | Defines all paths; never contains credentials                            |
| Secrets          | `saboteur.secrets.json`     | Credentials only; explicitly gitignored; excluded from machine migration |

SQLite is a single file (`saboteur.db`). It is fully portable — copy it to resume on a new machine.

---

## SQLite Tables

### `tasks`

```sql
CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,         -- stable UUID, e.g. "task_abc123"
  title        TEXT NOT NULL,
  state        TEXT NOT NULL,            -- enum: backlog | active | blocked | review | done
  context_id   TEXT NOT NULL             -- FK → contexts.id; defaults to "inbox"
               REFERENCES contexts(id),
  priority     TEXT DEFAULT 'normal',    -- enum: critical | high | normal | low
  energy       TEXT DEFAULT NULL,        -- enum: deep | shallow | admin
  effort       TEXT DEFAULT NULL,        -- enum: xs | s | m | l | xl
  blocks       TEXT DEFAULT '[]',        -- JSON array of task UUIDs this task blocks
  blocked_by   TEXT DEFAULT '[]',        -- JSON array of task UUIDs blocking this task
  note_id      TEXT DEFAULT NULL,        -- FK → knowledge_index.id (optional)
  repo         TEXT DEFAULT NULL,        -- □ Phase 2a: set manually in P1, auto-detected later
  branch       TEXT DEFAULT NULL,        -- □ Phase 2a: same as repo
  state_history TEXT DEFAULT '[]',       -- JSON array of {state: string, timestamp: ISO8601}
  created_at   TEXT NOT NULL,            -- ISO8601
  updated_at   TEXT NOT NULL            -- ISO8601; updated on every state change
);
```

**Constraints:**

- `state` must be one of: `backlog`, `active`, `blocked`, `review`, `done`
- `priority` must be one of: `critical`, `high`, `normal`, `low`
- `energy` must be one of: `deep`, `shallow`, `admin`, or NULL
- `effort` must be one of: `xs`, `s`, `m`, `l`, `xl`, or NULL
- `blocks` and `blocked_by` are JSON arrays stored as TEXT — always parse before use
- `state_history` is append-only — never modify past entries, only push new ones
- `updated_at` must be updated atomically with every state transition

**Indexes:**

```sql
CREATE INDEX idx_tasks_context ON tasks(context_id);
CREATE INDEX idx_tasks_state   ON tasks(state);
CREATE INDEX idx_tasks_updated ON tasks(updated_at);
```

---

### `contexts`

```sql
CREATE TABLE contexts (
  id          TEXT PRIMARY KEY,    -- stable slug, e.g. "varsentry", "inbox"
  name        TEXT NOT NULL,       -- display name
  description TEXT DEFAULT NULL,   -- optional, one sentence
  repos       TEXT DEFAULT '[]',   -- □ Phase 2a: JSON array of repo name strings
  created_at  TEXT NOT NULL        -- ISO8601
);
```

**Reserved contexts:**

- `inbox` — created automatically on `sab init`. Cannot be deleted. Cannot be renamed. Is the default context for all tasks and notes created without an explicit `--context` flag.

---

### `knowledge_index`

> In Phase 1 this table contains only personal notes (`type = 'note'`).
> The schema is designed for multi-source expansion in Phase 2c — do not assume `type = 'note'` in query logic.

```sql
CREATE TABLE knowledge_index (
  id         TEXT PRIMARY KEY,   -- stable UUID matching frontmatter id
  source_id  TEXT NOT NULL       -- FK → sources.id, e.g. "personal-notes"
             REFERENCES sources(id),
  type       TEXT NOT NULL,      -- enum: note | omoikane (extensible by plugins)
  title      TEXT,               -- extracted from frontmatter
  tags       TEXT DEFAULT '[]',  -- JSON array, extracted from frontmatter
  task_id    TEXT DEFAULT NULL,  -- linked task UUID from frontmatter
  context_id TEXT DEFAULT NULL,  -- context slug from frontmatter or source default
  path       TEXT NOT NULL,      -- absolute path to the .md file on disk
  created_at TEXT,               -- from frontmatter
  updated_at TEXT                -- from frontmatter; used by briefing for "yesterday" filter
);
```

**Indexes:**

```sql
CREATE INDEX idx_ki_source  ON knowledge_index(source_id);
CREATE INDEX idx_ki_type    ON knowledge_index(type);
CREATE INDEX idx_ki_context ON knowledge_index(context_id);
CREATE INDEX idx_ki_task    ON knowledge_index(task_id);
CREATE INDEX idx_ki_updated ON knowledge_index(updated_at);
```

**Important:** The `.md` file is the source of truth. The knowledge index is a derived cache. On `sab sync`, delete all rows for a source and rebuild from disk.

---

### `commits`

> Phase 2a. Persists the commit → task link discovered by scanning repos under `repos_dir`. Source of truth is git itself; this table is a derived index, rebuilt by `indexCommits`.

```sql
CREATE TABLE commits (
  sha       TEXT PRIMARY KEY,   -- full commit sha
  repo      TEXT NOT NULL,      -- repo name (basename of the repo directory under repos_dir)
  branch    TEXT,               -- branch the commit was observed on; nullable for detached/orphan
  task_id   TEXT                -- FK → tasks.id; the task extracted from the message
            REFERENCES tasks(id),
  message   TEXT NOT NULL,      -- full commit message
  author_ts TEXT NOT NULL       -- ISO8601 author timestamp
);
```

**Indexes:**

```sql
CREATE INDEX idx_commits_task      ON commits(task_id);
CREATE INDEX idx_commits_repo      ON commits(repo);
CREATE INDEX idx_commits_author_ts ON commits(author_ts);
```

**Rules:**

- A commit is indexed only if its message contains a bracketed task ID matching `[task_xxxxxxxx]` and that task exists in `tasks`.
- Re-running `indexCommits` is idempotent — same sha replaces (upsert).
- `repo` is the basename relative to `repos_dir`, not an absolute path, so the index survives moving `repos_dir`.

---

### `sources`

```sql
CREATE TABLE sources (
  id         TEXT PRIMARY KEY,  -- unique slug, e.g. "personal-notes", "omoikane-auth"
  type       TEXT NOT NULL,     -- enum: note | omoikane (must match knowledge_index.type)
  path       TEXT NOT NULL,     -- absolute path to the source directory
  owner      TEXT NOT NULL,     -- enum: core | plugin
  context_id TEXT DEFAULT NULL, -- optional: scopes source to a context; NULL = global
  enabled    INTEGER DEFAULT 1  -- 0 = disabled; disabled sources are not scanned or queried
);
```

**Seeded on `sab init`:**

```sql
INSERT INTO sources VALUES (
  'personal-notes', 'note', '<resolved notes path>', 'core', NULL, 1
);
```

**Rules:**

- `owner = 'core'` rows cannot be deleted or disabled by plugins
- A source with `context_id = NULL` is global — visible in all contexts
- A source with a `context_id` is only scanned and queried when that context is active
- Plugins append rows on enable, remove their own rows on disable

---

## Config File: `saboteur.config.json`

```json
{
    "version": "1",
    "db_path": "~/saboteur/saboteur.db",
    "secrets_path": "~/saboteur/saboteur.secrets.json",
    "repos_dir": "~/code",
    "active_context": "inbox",
    "briefing": {
        "stale_task_days": 3,
        "provider_timeout_ms": 2000
    },
    "sources": [
        {
            "id": "personal-notes",
            "type": "note",
            "path": "~/saboteur/notes",
            "owner": "core",
            "enabled": true
        }
    ]
}
```

**Field notes:**

- `version` — reserved for future migration logic. Always `"1"` in Phase 1.
- `secrets_path` — path to the secrets file. Never copy this file during machine migration.
- `repos_dir` — defined now, unused in Phase 1. Phase 2a wires Git reads to this path.
- `active_context` — persisted here by `sab context use`. Defaults to `"inbox"` on init.
- `stale_task_days` — tasks in `active` state with `updated_at` older than this trigger the stale flag.
- `provider_timeout_ms` — Phase 2c+. Maximum wait per plugin data provider. Defined now for forward compatibility.
- `sources` — auto-managed. Core writes the `personal-notes` entry on init. Plugins append their own. Do not require users to edit this manually.

**Portability:** Copy `saboteur.config.json` + `saboteur.db` + notes directory to resume on a new machine. `secrets_path` is excluded — credentials must be recreated.

---

## Secrets File: `saboteur.secrets.json`

```json
{
    "plugins": {
        "github": { "token": "..." },
        "gcp": { "key_path": "..." }
    }
}
```

**Rules:**

- This file must be in `.gitignore` — enforce this on `sab init`.
- Never read credentials from `saboteur.config.json`.
- Plugins access secrets via the plugin API (`context.secrets.get('github.token')`), never by reading this file directly.
- macOS Keychain integration is a future stretch goal. Not in scope for any current phase.

---

## Note Frontmatter Schema

Each note is a `.md` file. The YAML frontmatter is the structured record. The body is freeform Markdown.

```yaml
---
id: note_abc123 # stable UUID — generated on creation, never changed
title: Auth Flow Thoughts
tags: [auth, backend]
task_id: task_xyz789 # optional: links this note to a task
context: varsentry # context slug; defaults to active context on creation
created_at: 2026-03-25
updated_at: 2026-03-25
---
# Body content here...
```

**Rules:**

- `id` is generated on creation and must never be changed after writing to disk.
- `updated_at` must be updated whenever the file body or frontmatter changes.
- `context` falls back to the active context at creation time if not explicitly set.
- `task_id` is optional. If set, it must reference a valid task `id`.
- The knowledge index row for this note is rebuilt from frontmatter on every `sab sync`.

---

## Derived View Definitions

Views are SQL queries — never manually curated lists. These are the canonical query definitions.

| View        | SQL WHERE clause                                                                           |
| ----------- | ------------------------------------------------------------------------------------------ |
| `today`     | `state = 'active' ORDER BY priority DESC, energy DESC`                                     |
| `active`    | `state = 'active'`                                                                         |
| `backlog`   | `state = 'backlog'`                                                                        |
| `blocked`   | `state = 'blocked'`                                                                        |
| `review`    | `state = 'review'`                                                                         |
| `deep-work` | `state = 'active' AND energy = 'deep' AND json_array_length(blocked_by) = 0`               |
| `stale`     | `state = 'active' AND updated_at < datetime('now', '-N days')` where N = `stale_task_days` |

All views are scoped to `context_id = active_context` unless `--all` is passed.

Priority sort order: `critical > high > normal > low` (map to integers for ORDER BY).
Energy sort order: `deep > shallow > admin`.
