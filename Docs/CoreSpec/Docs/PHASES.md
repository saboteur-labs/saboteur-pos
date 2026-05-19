# Saboteur POS — PHASES

> Build sequence, done signals, and phase boundaries.
> An implementing agent working on Phase 1 should implement only what is listed under Phase 1.
> Stubs for future phases must be created (columns, config fields, etc.) but must not have logic wired to them.

---

## How to Read This Document

Each phase has:

- **Goal** — the user-facing outcome
- **Done signal** — the single condition that proves the phase is complete
- **Layers** — the ordered build sequence within the phase. Each layer depends on the previous.
- **Explicitly out of scope** — what must not be built yet, even if it seems easy

---

## Phase 1 — Foundation

**Goal:** A working task and note system with context scoping, culminating in a daily briefing that replaces the habit of opening multiple apps each morning.

**Done signal:** `sab briefing` runs each morning and accurately reflects the state of active work across all contexts. The inbox section, stale tasks, and blocked tasks are all correctly populated.

---

### Layer 1 — Data Model + Config

**Build this first. Everything else depends on it.**

- [x] Define and run all `CREATE TABLE` statements from SCHEMA.md
- [x] Implement `sab init` per LOGIC.md §1
    - Create directory structure
    - Seed `inbox` context
    - Seed `personal-notes` source
    - Write `saboteur.config.json` with defaults
    - Create empty `saboteur.secrets.json` and add to `.gitignore`
- [x] Implement config read/write — all commands load config on start
- [x] Implement `sab init --config <path>` for machine migration
- [x] Implement `sab status` per LOGIC.md §10

**Done when:** `sab init` completes without error, `sab status` prints correct paths and counts, `saboteur.secrets.json` is gitignored.

---

### Layer 2 — Tasks (CRUD + State Machine)

- [x] Implement `sab task add` with all flags
- [x] Implement `sab task list` with tabular output and `--view` flag
- [x] Implement `sab task view` with full detail output including state history
- [x] Implement `sab task move` with state machine validation per LOGIC.md §2
- [x] Implement `sab task done` and `sab task block` shorthands
- [x] Implement `sab task edit` with `$EDITOR` round-trip
- [x] All state transitions must write to `state_history`
- [x] All writes must use transactions

**Phase 2 stubs (create column, wire no logic):**

- `tasks.repo` — nullable TEXT, settable via `sab task add --repo` and `sab task edit`
- `tasks.branch` — nullable TEXT, settable via `sab task edit`
- `briefing.provider_timeout_ms` in config — write the field, read it nowhere in Phase 1
- `repos_dir` in config — write the field, read it nowhere in Phase 1

**Done when:** Can create, list, view, and transition tasks. State machine rejects all invalid transitions. `state_history` is appended correctly on every transition.

---

### Layer 3 — Contexts

- [x] Implement `sab context new`
- [x] Implement `sab context list` with task and note counts
- [x] Implement `sab context use` — persists to config
- [x] Implement `sab context show`
- [x] Implement `sab context delete` with full safe-deletion logic per LOGIC.md §4:
    - Refuse if items exist (no flag)
    - `--reassign <slug>` migrates and deletes
    - `--force` orphans to inbox and deletes
    - `inbox` cannot be deleted under any circumstances
- [x] All task commands must respect active context by default
- [x] `--context <slug>` flag overrides per-command
- [x] `--all` flag bypasses context filter

**Done when:** Can create and switch contexts. All task list/view commands scope correctly. Deletion behaves safely in all three cases.

---

### Layer 4 — Derived Task Views

- [x] Implement all views from SCHEMA.md view definitions:
    - `today` — active, sorted priority desc + energy desc
    - `active`
    - `backlog`
    - `blocked`
    - `review`
    - `deep-work` — active + deep energy + no blocked_by
    - `stale` — active + updated_at older than `stale_task_days`
- [x] `--view <name>` flag on `sab task list`
- [x] Priority and energy sort orders must be correct (see SCHEMA.md)

**Done when:** All seven views return correct filtered and sorted results. `deep-work` correctly excludes tasks with non-empty `blocked_by`. `stale` respects the config value.

---

### Layer 5 — Notes (CRUD + Linking)

- [x] Implement knowledge index sync (`sab sync`) per LOGIC.md §5
    - Full rebuild on `sab sync`
    - Incremental sync before note queries
    - Frontmatter fallbacks per LOGIC.md §5
- [x] Implement `sab note new` — generate frontmatter, open `$EDITOR`, index after close
- [x] Implement `sab note list` with tabular output
- [x] Implement `sab note view` — render with resolved wiki-links
- [x] Implement `sab note edit` — open `.md` file in `$EDITOR`, re-index after close
- [x] Implement `sab note find --tag` and `sab note find --task`
- [x] Implement `sab task link <id> --note <note_id>`
- [x] Implement `sab task link <id> --blocks <other_id>` with cycle detection per LOGIC.md §8
    - Auto-unblock dependent tasks when blocking task moves to `done`
- [x] Implement wiki-link resolution per LOGIC.md §6

**Done when:** Can create, view, edit, and find notes. Frontmatter is correctly parsed and indexed. Wiki-links resolve correctly. Task-note linking is bidirectional. Dependency unblocking works automatically on task completion.

---

### Layer 6 — Daily Briefing

**This is the Phase 1 done signal.**

- [x] Implement `sab briefing` per LOGIC.md §7:
    - Section 1: Inbox count (omit if empty)
    - Section 2: Active context
    - Section 3: Active tasks (sorted, stale tasks excluded here)
    - Section 4: Stale tasks (omit if none)
    - Section 5: Blocked tasks with dependency titles (omit if none)
    - Section 6: In review (omit if none)
    - Section 7: Yesterday's notes (omit if none)
- [x] Empty briefing message when all optional sections are empty
- [x] `--context` flag to run briefing for a different context

**Done when:** `sab briefing` is run on a populated system and all sections render correctly. Stale tasks appear in Section 4 and not Section 3. Blocked task dependencies are titled, not just IDs. Yesterday's notes show linked task title when `task_id` is set.

---

## Phase 2a — Local Git Core

**Goal:** Wire Git into the data model. Briefing gains repo and commit awareness. No network required.

**Done signal:** `sab briefing` includes accurate repo state data for the active context.

**Builds on:** Phase 1 complete. `tasks.repo` and `tasks.branch` stubs are already in the schema.

Key work:

- Scan `repos_dir` from config for git repositories
- Read branch state, uncommitted changes, recent commits per repo
- Parse commit messages for task IDs (`[task_abc123]` or similar convention — decide format before implementing)
- Auto-link commits to tasks
- Stale branch detection (configurable threshold)
- Add repo/commit sections to `sab briefing`
- Weekly briefing: derives from `state_history` + git activity aggregation

**Implementation warning:** The weekly briefing is more complex than it appears. `state_history` makes "what shipped" answerable. "Time allocation by repo" requires aggregating git timestamps over a window. "What stalled" requires two-point-in-time state comparison. Budget accordingly.

---

## Phase 2b — Read-Only UI

**Goal:** A local React dashboard that renders briefing, tasks, and notes. Morning newspaper — no mutations.

**Done signal:** `sab ui` starts the server on port 9421 and the dashboard renders all three views accurately with auto-refresh.

**Builds on:** Phase 1 complete.

Key decisions already made:

- [x] Port: `9421` (fixed)
- [x] Data source: reads directly from SQLite and notes directory (not CLI parsing)
- [x] Read-only: no mutations through the UI in Phase 2
- [x] `sab ui` starts and confirms, then exits — process lifecycle is the user's responsibility
- [x] `sab ui` is idempotent: if port is already in use, report and exit cleanly
- [x] Views: Briefing (default), Tasks (with view filters), Notes (click to read)

---

## Phase 2c — Plugin Architecture + Local Plugins

**Goal:** Plugin system is live. Local AI summarization and Omoikane read integration ship as the first two plugins.

**Done signal:** Plugin system operational. At least two local plugins registered and rendering data in briefing.

**Builds on:** Phase 2a or 2b complete (either order is acceptable).

Key decisions already made:

- Data provider model (not event hooks) — see full spec §8
- Plugin contract: async `fetch(context)`, respects `provider_timeout_ms`, returns null on failure
- Briefing uses `Promise.allSettled()` — never blocks on a slow provider
- Local plugins first: LM Studio AI summarization, Omoikane knowledge read
- Plugin credentials via `saboteur.secrets.json` only — never from config

---

## Phase 3 — Remote Plugins + Write UI

**Goal:** Briefing includes remote data. UI supports mutations.

**Done signal:** At least one remote plugin operational. UI supports task state transitions.

Planned plugins: GitHub/GitLab PR data, npm insights, GCP service health, hosted AI summarization.

UI write additions: task creation, state transitions, note editing, context switching, plugin panels.

---

## Phase 4 — Omoikane Command Integration + Polish

**Goal:** POS can issue research tasks to Omoikane and surface results.

**Done signal:** `sab omoikane query <topic>` returns results linked as notes.

Also: OSS readiness review — documentation, onboarding, config generalization for non-Saboteur users.

---

## What Stays Constant Across All Phases

These invariants must never be violated regardless of which phase is being implemented:

1. **The CLI is always the primary control surface.** UI breakage is never a system failure.
2. **No schema migrations between phases.** All Phase 2+ stubs are created in Phase 1 as nullable columns. Future phases wire logic to them.
3. **Plugins are always optional.** The system must be fully functional with all plugins disabled.
4. **Local-first guarantee.** Core functionality never requires network access. Anything requiring network is a plugin.
5. **Every write uses a transaction.** No partial state.
6. **The `.md` file is always the source of truth for notes.** The SQLite index is always a derived cache.
