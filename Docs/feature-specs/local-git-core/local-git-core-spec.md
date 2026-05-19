# Local Git Core — Feature Spec

## Overview

Local Git Core teaches Saboteur POS to read the git repositories the user already works in and surface that activity inside the daily briefing. Today, a user must context-switch to a terminal or IDE to remember which branch they were on, whether changes are uncommitted, and what recent commits relate to which task. This feature collapses that scan into the existing briefing flow, with no network or hosted services involved.

## Goals

- `sab briefing` reflects current branch, uncommitted-change presence, and recent commits for every repo under the configured `repos_dir`, scoped to the active context.
- Commits whose messages reference a task ID are linked to that task and visible from `sab task view`.
- Stale branches (no commits within a configurable threshold) are surfaced in the briefing without the user opening any repo.
- `sab briefing --weekly` reports what shipped, time allocation by repo, and what stalled, derived from `state_history` plus git activity over the prior 7 days.
- All git reads remain local: no network calls, no remote fetches required for the briefing to render.

## Non-goals

- Performing git writes of any kind (no commits, fetches, pushes, branch creation, merges).
- Repo discovery outside `repos_dir` (no recursive scanning of `$HOME`).
- Plugin-based or remote git providers (GitHub/GitLab PR data is Phase 3).
- UI rendering of repo state (read-only UI git panels are a separate feature).
- Resolving commit-to-task links retroactively across repos the user later removes from `repos_dir`.

## User stories

- As a POS user, I want my morning briefing to tell me which branch I left each repo on so I can resume without re-orienting.
- As a POS user, I want commits that mention a task ID to attach to that task automatically so my work and my notes stay in sync.
- As a POS user, I want stale branches flagged in the briefing so I notice work I abandoned.
- As a POS user, I want a weekly briefing that shows what I shipped and where my time went, without me tagging anything manually.

## Functional requirements

1. The system MUST read `repos_dir` from config and treat each immediate subdirectory containing a `.git` folder as a tracked repo.
2. For every tracked repo, the system MUST read current branch name, uncommitted-change presence, and the N most recent commits (N configurable, default 5) without invoking the network.
3. Commit messages MUST be parsed for task IDs in the form `[task_xxxxxxxx]` (literal square brackets, full 8-hex-character ID). Bare IDs, conventional-commit scopes, and git trailers MUST NOT be treated as links.
4. Only the canonical full task ID MUST be accepted; partial-prefix matches MUST NOT link commits to tasks.
5. Matched commits MUST be linked to the referenced task and exposed via `sab task view`; unmatched or unknown IDs MUST be ignored without error.
6. `sab briefing` MUST include a repo state section listing tracked repos with branch, dirty-state indicator, and recent task-linked commits for the active context.
7. Detached-HEAD repos MUST render as a first-class state (e.g. `detached @ <short-sha>`) in the repo state section.
8. Bare repos and repos that fail to read MUST be skipped and reported in a single footer line of the briefing listing the skipped repo paths and reason.
9. Branches whose latest commit is older than `stale_branch_days` (new config field, default `14`, global, no per-repo override) MUST appear in a dedicated stale-branch subsection of the briefing.
10. `sab briefing --weekly` MUST aggregate `state_history` transitions and git commit timestamps over a 7-day window and report shipped tasks, per-repo activity, and tasks that entered `blocked` or stayed `active` without movement.
11. All git reads MUST occur via local filesystem access or local git invocation; no command in this feature may make outbound network requests.
12. Repo scanning MUST complete within 2 seconds for up to 25 tracked repos on a developer laptop; otherwise the briefing must degrade gracefully and report which repos were skipped.
13. `tasks.repo` and `tasks.branch` columns (existing Phase 1 stubs) MUST be the canonical fields wired by this feature; no schema migration is permitted.

## Open questions

None identified.

## Out of scope (deferred)

- Remote-aware data (PRs, CI status, fetch state) — Phase 3.
- UI surface for repo state — handled by a future write-UI iteration.
- Auto-creating tasks from commits or branches.
- Cross-repo merge or release coordination.
- Historical backfill of commit-to-task links beyond the configured recent-commit window.
