# Tighten Git Integration — Feature Spec

## Overview

Git integration discovers every git repository under a single `repos_dir` and, by default, surfaces all of them in every context's briefing. For a `repos_dir` holding many unrelated repos, this floods each briefing with noise. The `contexts.repos` column already exists to scope repos per context, but there is no command to populate it (the docs instruct users to edit SQLite by hand) and an empty scope means "show all." This feature adds a CLI surface to link repos to a context and flips the empty-scope default so that briefing shows only the repos a user has deliberately linked.

## Goals

- Each context's briefing Repo State section shows only the repos explicitly linked to that context.
- Users can link, unlink, and list a context's repos entirely from the CLI, never by editing the database.
- A context with no linked repos produces a clear, empty Repo State section instead of every discovered repo.
- Repo links are validated at link time, so a context never accumulates names that don't exist under `repos_dir`.

## Non-goals

- Supporting repos located outside `repos_dir` or across multiple repo directories.
- Recursive repo discovery beyond the immediate children of `repos_dir`.
- Any network, remote, or commit-to-task linking changes (the `[task_xxxxxxxx]` convention is unchanged).
- Auto-assigning repos to contexts by name heuristics.

## User stories

- As a developer whose `repos_dir` holds many unrelated repos, I want briefing to show only the repos tied to my active context, so my briefing isn't flooded.
- As a user, I want to link and unlink repos to a context from the CLI, so I never have to hand-edit `saboteur.db`.
- As a user, I want to list a context's linked repos, so I can verify my scoping.

## Functional requirements

1. `sab context repos <slug>` MUST print the repo basenames linked to that context, or a "no repos linked" message when the list is empty.
2. `sab context repos add <slug> <repo>...` MUST append each repo basename to that context's `repos` array, de-duplicated, in a single transaction.
3. `sab context repos remove <slug> <repo>...` MUST remove each named repo from the array; removing an absent name MUST be a no-op for that name.
4. `add` MUST reject any `<repo>` not currently discovered as a working repo under `repos_dir`, exit non-zero, and write nothing: `"'<repo>' not found under repos_dir. Run 'sab git list' to see available repos."`
5. Repo names MUST be stored and matched as basenames relative to `repos_dir`, never absolute paths.
6. The briefing Repo State section MUST render only repos in `active_context.repos`.
7. When `active_context.repos` is empty, the Repo State section MUST show `"(no repos linked to '<slug>')"` plus the link hint, and MUST NOT list any discovered repo.
8. `sab briefing --all` MUST bypass repo scoping and show all discovered working repos.
9. Any `sab context repos` subcommand targeting a nonexistent context MUST exit non-zero: `"Context '<slug>' does not exist."`
10. `sab git list` MUST continue to mark repos linked to the active context with `*`.

## Open questions

None identified.

## Out of scope (deferred)

- Discovering repos across multiple repo directories (`repos_dirs`) or nested subdirectories — deferred to its own follow-on spec. This feature's per-context scoping is independent of how repos are discovered and works unchanged once multi-dir lands, provided basename repo identity is preserved.
- Pruning `contexts.repos` entries whose repo directory is later deleted or renamed.
- Linking a single repo to multiple contexts via a bulk/interactive command.
- Per-repo overrides (e.g. branch filters) beyond simple membership.
- Config-driven empty-scope default (`git.scope_default`).
