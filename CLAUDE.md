# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

**Saboteur POS** (Personal Operating System) is a CLI tool (`sab`) for task and note management with context scoping, dependency tracking, and a daily briefing. It is currently in the specification phase — implementation has not begun.

The spec documents are authoritative:
- `Docs/CoreSpec/Docs/LOGIC.md` — behavioral rules (read in full before implementing any feature)
- `Docs/CoreSpec/Docs/PHASES.md` — build roadmap and done signals
- `Docs/CoreSpec/Docs/SCHEMA.md` — database schema (currently empty, to be filled)
- `Docs/CoreSpec/Docs/CLI.md` — command definitions (currently empty, to be filled)

## Build Commands

No implementation exists yet. When implementation begins, document build/lint/test commands here.

## Architecture

### Data Layer
- **SQLite** as the primary database (`saboteur.db`)
- **Markdown files** as the source of truth for notes — SQLite `knowledge_index` table is a derived cache only
- **`saboteur.config.json`** — runtime config (active context, paths, thresholds)
- **`saboteur.secrets.json`** — credentials for plugins only (never in config, always gitignored)

### Core Systems

**Task State Machine** (`LOGIC.md §2`)
- States: `backlog → active → blocked/review → done`
- `done` is terminal. `blocked` can be set from any non-done state.
- Every transition writes to `state_history` (append-only JSON array on the task row).
- Invalid transitions must be rejected with a human-readable message.

**Context Scoping** (`LOGIC.md §3`)
- `active_context` in config is the default lens for all read/write operations.
- `--context <slug>` overrides per-command. `--all` bypasses filtering entirely.
- `inbox` is a reserved context: created on init, cannot be deleted, is always the fallback.

**Knowledge Index Sync** (`LOGIC.md §5`)
- Full rebuild: `sab sync` — deletes and re-inserts all rows from disk.
- Incremental: auto-runs before any note query — compares file `mtime` to `updated_at`.
- Missing `id` in frontmatter: generate UUID and write it back to the file before indexing.
- Malformed frontmatter: log warning and skip — never crash.

**Dependency Logic** (`LOGIC.md §8`)
- `blocks`/`blocked_by` arrays are always kept in sync (both sides of the relationship).
- When a blocking task moves to `done`: auto-unblock any dependents whose `blocked_by` becomes empty.
- Cycle detection required before adding any block relationship.

**Daily Briefing** (`LOGIC.md §7`)
- 7 sections in order: Inbox, Active Context, Active Tasks, Stale Tasks, Blocked Tasks, In Review, Yesterday's Notes.
- Stale tasks appear in Section 4 only — exclude them from Section 3.
- Optional sections (1, 4, 5, 6, 7) are omitted when empty.
- `sab briefing` must never modify data.

**Standup / Retro Check-ins** (`Docs/feature-specs/standup-retro/standup-retro-spec.md`)
- `sab standup` — slot-aware daily check-in (`pre-work`/`wd-1`/`wd-2`/`wd-3`/`post-work`, inferred from `standup.slot_windows` in config or set via `--slot`). Recaps done-since-last-session tasks, linked commits, and blocked tasks before asking slot-specific questions.
- `sab retro` — scope-aware reflection (`--scope project|feature|daily`).
- Both write an editable note (`tags: ['standup']` / `tags: ['retro']`), discoverable via `sab note find --tag <tag>`.

### Phase Boundaries

**Phase 1 (Foundation):** CLI only. Build in layer order (Data Model → Tasks → Contexts → Views → Notes → Briefing). Do not implement Phase 2+ logic even if it seems easy — create stubs (nullable columns, config fields) but wire no logic to them.

**Phase 2 stubs to create in Phase 1:** `tasks.repo`, `tasks.branch`, `briefing.provider_timeout_ms` in config, `repos_dir` in config.

**Phase 2a:** Git repo awareness, commit-to-task linking.
**Phase 2b:** React dashboard on port `9421`, read-only.
**Phase 2c:** Plugin architecture — data provider model, `Promise.allSettled()`, `provider_timeout_ms` timeout.
**Phase 3+:** Remote plugins, write UI, Omoikane integration.

### Invariants (Never Violate)
1. CLI is always the primary control surface.
2. No schema migrations between phases — all future stubs are nullable columns created in Phase 1.
3. Plugins are always optional — system must work fully with all plugins disabled.
4. Local-first — network access is only ever a plugin concern.
5. Every write uses a transaction — no partial state ever.
6. `.md` file is source of truth for notes; SQLite index is derived.

## Error Handling Rules
- Non-zero exit on all failures.
- All errors to stderr, human-readable.
- Multi-step writes must use transactions.
- Missing config/DB → direct user to `sab init`.
- Missing `$EDITOR` → `"No $EDITOR set. Export EDITOR=<your editor> and try again."`
