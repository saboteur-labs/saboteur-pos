# Briefing Merged Section — Feature Spec

> Tracked in POS as `task_32a7a6e8`. The section this spec adds is titled **Landed** in briefing output: it covers everything that reached a repo's default branch, not only merge commits.

## Overview

`sab briefing` surfaces no record of what reached a repo's default branch. Its Repo State section shows up to 5 indexed commits per repo, and `indexCommits` stores a commit only when its message carries a known `[task_xxxxxxxx]` ID or it is path-attributed to a monorepo sub-context. Merge commits (e.g. `Merge pull request #200 from saboteur-works/feat/trash-ui`) typically carry neither, so they are never stored.

Measured in `getwrite` on 2026-09-15, first-parent history of `origin/main` since 2026-09-01: 20 merge commits (PRs #183–#200 plus 3 `Merge branch '…'` merges) and 22 non-merge commits made directly on `main`. Over all history, 14 of 148 first-parent non-merge commits end in `(#N)`, the subject GitHub writes for a squash merge (latest 2026-07-22). The briefing showed 5 commits, all dated 2026-09-15. A section that lists merge commits alone would miss both the squash merges and the direct commits.

This feature adds a **Landed** section to `sab briefing` and `sab briefing --weekly`: every first-parent commit on each linked repo's default branch within a window, computed live from local git history.

It also makes two adjacent Repo State changes: the 5-commit cap becomes configurable, and branches matching a configurable worktree pattern are hidden unless requested.

## Goals

- A user can see, from `sab briefing` alone, everything that landed on each linked repo's default branch within a window, without leaving the terminal.
- Each row identifies what landed: its subject, its PR number where the subject carries one, and the titles of tasks it resolves to.
- The window defaults to a calendar week and can be set explicitly for any past range.
- Leftover agent-worktree branches no longer clutter Repo State by default, and remain one flag away.
- The feature stays read-only and local-only: no git writes, no fetches, no network calls.

## Non-goals

- Fetching from a remote to make more commits visible. Only history already present locally is shown; this is a known limitation, not a defect.
- Distinguishing a rebase-merged PR from commits pushed directly to the default branch. Local history carries no marker that separates them, so each such commit is its own row.
- Switching `sab briefing --weekly` from a rolling 7 days to calendar weeks. That is a separate spec; see FR-7 for how this feature coexists with the current rolling window.
- Persisting landed commits. They are computed on each run (FR-10).
- PR metadata not derivable from the commit itself (review state, CI status, labels). That is remote-aware data, deferred to Phase 3 per the local-git-core spec and PHASES.md Invariant 4.
- Changing which non-merge commits `indexCommits` stores.

## User stories

- US-1: As a POS user, I want to see what landed on a repo's default branch in my briefing so that I know what shipped without checking GitHub.
- US-2: As a POS user, I want to see the task titles a landed change resolves to so that I can connect what shipped to the work I tracked.
- US-3: As a POS user reviewing a past period, I want to give the briefing start and end dates so that I can see what landed in any range.
- US-4: As a POS user on a Monday, I want to see last week in the default window so that the section isn't empty when I most want it.
- US-5: As a POS user whose repos accumulate agent-worktree branches, I want to hide those from Repo State unless I ask so that the briefing reflects real branches.
- US-6: As a POS user, I want to tune how many rows the briefing shows so that busy repos don't truncate what I care about.

## Functional requirements

### Window

FR-1: The default window MUST be the current calendar week in local time, starting at 00:00 on the day named by `briefing.week_start` (`monday` through `sunday`, default `monday`) and ending seven days later. When the current local day is the week-start day, the default window MUST instead be the previous full calendar week. An unrecognised `week_start` value MUST be rejected with a human-readable error and non-zero exit. [US-1] [US-4]
FR-2: `sab briefing` MUST accept `--since <YYYY-MM-DD>` and `--until <YYYY-MM-DD>`, both inclusive and interpreted in local time, which override the default window. `--since` alone MUST run through the end of today; `--until` alone MUST be rejected with a human-readable error and non-zero exit. `--since` later than `--until` MUST be rejected the same way. [US-3]
FR-3: A window reaching further back than the commit index horizon (60 days) MUST still be fully served, since landed commits are read from git rather than the index (FR-10). [US-3]

### Default branch

FR-4: The default branch for a repo MUST be resolved, using local refs only, in this order: (1) `repos.<repo-name>.default_branch` in `saboteur.config.json`; (2) the target of `refs/remotes/origin/HEAD`; (3) the first of `main`, `master`, `development`, `develop` that exists locally. A configured branch that does not exist MUST produce a warning on stderr and fall through to (2). A repo where no step resolves MUST be listed as skipped with reason `no-default-branch`. [US-1]
FR-5: The per-repo setting MUST be keyed by repo name in config, not stored on a context, because a repo can be linked to more than one context. [US-1]

### Landed section

FR-6: The Landed section MUST be a top-level briefing section, separate from Repo State, listing for each repo linked to the context every commit on the default branch's first-parent history whose author date falls in the window, newest first. With `--all`, it MUST list every discovered working repo regardless of context links, matching Repo State's existing `--all` behavior. [US-1]
FR-7: `sab briefing --weekly` MUST include the Landed section. Until the weekly briefing moves to calendar weeks, it MUST use the weekly briefing's existing window, so every section of one weekly report covers the same period. `--since`/`--until` MUST apply to the Landed section in weekly mode. [US-1] [US-3]
FR-8: A row MUST show the short SHA, date, subject line, and PR number when one is parsed. For a merge commit, the PR number comes from a `Merge pull request #N` subject, and task IDs MUST be collected from every commit in `<merge>^1..<merge>^2`. For a non-merge commit, the PR number comes from a trailing `(#N)` in the subject, and task IDs MUST be collected from its own message. Task IDs MUST be resolved to titles of known tasks; a row with no resolvable task MUST still be shown. [US-1] [US-2]
FR-9: Each repo MUST show at most `briefing.landed_max_rows` rows (default 20). When rows are dropped, a final `+N more` line MUST state how many. The section MUST be omitted for a repo with no rows in the window, and omitted entirely when no repo has any. [US-6]
FR-10: Landed rows MUST be computed from git on each run and MUST NOT be written to the database. [US-3]
FR-11: Every git call MUST go through the existing per-repo timeout. A repo that times out MUST be skipped and reported the same way Repo State reports timeouts today. [US-1]
FR-12: The feature MUST NOT perform any git write, including fetch, and MUST NOT make any network call. [US-1]

### Repo State changes

FR-13: The Repo State per-repo commit limit MUST be read from `briefing.repo_state_max_commits` (default 5). [US-6]
FR-14: Local branches matching any glob in `git.worktree_branch_patterns` (default `["worktree-agent-*"]`) MUST be hidden from Repo State's commit list and Stale Branches unless `sab briefing --include-worktrees` is passed. Matching MUST be by branch name, because leftover agent branches outlive their worktrees: in `getwrite` on 2026-09-15, `git worktree list` showed only the main checkout while six `worktree-agent-<id>` branches remained. [US-5]
FR-15: The worktree filter MUST apply at display time only; `indexCommits` MUST continue to index commits on matching branches, so task-linked commits that exist only on an agent branch stay visible in `sab task view` and the standup recap. [US-5]
FR-16: Because `commits.branch` records only the first branch a commit was seen on, `indexCommits` MUST scan non-matching branches before matching ones, so that a commit reachable from both is recorded against the non-matching branch and is not hidden by FR-14. [US-5]
FR-17: `sab git list` MUST accept `--include-worktrees`. It lists one row per repo showing the checked-out branch and lists no other branches, so without the flag its output MUST be unchanged; with the flag, each repo row MUST be followed by that repo's local branches matching `git.worktree_branch_patterns`, so leftover agent branches can be found and cleaned up. [US-5]

## Open questions

- OQ-1: Is FR-17's reading of `sab git list --include-worktrees` (list matching branches under each repo) the intended behavior? The command shows only each repo's checked-out branch today, so there is nothing for the flag to un-hide. — Impact: FR-17.

## Out of scope (deferred)

- Calendar-week windows for the rest of `sab briefing --weekly` (separate spec).
- Remote-aware merge/PR data (review state, CI status, approvals) — Phase 3.
- Grouping the commits of a rebase-merged PR into one row.
- A UI surface for the Landed section.
- Near-duplicate rows in Repo State with identical messages and different SHAs. Observed 2026-09-15 in `getwrite`, one of each pair reachable only from a `worktree-agent-*` branch; FR-14 hides those branches by default, but why the pairs exist has not been established.
