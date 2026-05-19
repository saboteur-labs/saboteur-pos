# Local Git Core — Implementation Tasks

### Task 1: Add `stale_branch_days` config field

**What:** Extend the `Config` / `BriefingConfig` shape with a `stale_branch_days` field defaulted to `14`, written by `makeDefaultConfig`.
**Files:** `src/config.ts`
**Done when:** A fresh `sab init` writes `briefing.stale_branch_days: 14` into `saboteur.config.json`. The TypeScript build passes with the new field referenced as `config.briefing.stale_branch_days`. Existing configs without the field still load (treated as `14`).
**Depends on:** none
**Estimate:** 1
**Notes:** Satisfies spec FR #9. Mirrors the existing `stale_task_days` pattern.
**Done:** [x]

### Task 2: Add `commits` table to schema

**What:** Add a new `commits` table to `CREATE_TABLES` with columns `sha TEXT PRIMARY KEY`, `repo TEXT NOT NULL`, `branch TEXT`, `task_id TEXT REFERENCES tasks(id)`, `message TEXT NOT NULL`, `author_ts TEXT NOT NULL`, plus indexes on `task_id`, `repo`, and `author_ts`.
**Files:** `src/db/schema.ts`, `Docs/CoreSpec/Docs/SCHEMA.md`
**Done when:** `sab init` on a fresh directory produces a `saboteur.db` containing the `commits` table with the listed columns and indexes (verified via `sqlite3 ... .schema commits`). SCHEMA.md documents the new table.
**Depends on:** none
**Estimate:** 1
**Notes:** Spec FR #5 requires persistent commit→task links; a new table is the lightest fit.
**Done:** [x]

### Task 3: Repo discovery module

**What:** Pure module that, given a `repos_dir` path, returns `{ path, name, kind: 'working' | 'bare' | 'broken' }` for each immediate subdirectory containing a `.git` entry or being a bare repo.
**Files:** `src/git/discover.ts`, `src/git/discover.test.ts`
**Done when:** Unit tests pass against a fixture tree with one working repo, one bare repo, and one non-repo directory — the function returns exactly three entries with correct `kind` classification.
**Depends on:** none
**Estimate:** 2
**Notes:** Satisfies spec FR #1.
**Done:** [x]

### Task 4: Git read primitives

**What:** Module exposing `getBranch(repoPath)`, `isDirty(repoPath)`, `getRecentCommits(repoPath, n)`, and `getHeadState(repoPath)` (returns `{ kind: 'branch', name } | { kind: 'detached', sha }`), implemented by spawning local `git` and parsing output. No network calls.
**Files:** `src/git/read.ts`, `src/git/read.test.ts`
**Done when:** Unit tests against fixture repos confirm: a clean repo on `main` returns `{ branch: 'main', dirty: false }`; a detached HEAD returns `{ kind: 'detached', sha: <7-char> }`; `getRecentCommits(repo, 3)` returns three entries with `{ sha, message, author_ts }` newest-first. No test touches the network.
**Depends on:** 3
**Estimate:** 3
**Notes:** Satisfies spec FR #2, FR #7 (detached HEAD), FR #11 (local-only). Use `git -C <path> ...` for isolation.
**Done:** [x]

### Task 5: Commit-message task-ID parser

**What:** Pure function `extractTaskIds(message: string): string[]` that returns full IDs matched by `\[task_[0-9a-f]{8}\]`. Bare IDs, conventional-commit scopes, and trailers MUST NOT match.
**Files:** `src/git/parse.ts`, `src/git/parse.test.ts`
**Done when:** Unit tests cover: bracketed match (`fix [task_a1b2c3d4]` → `['task_a1b2c3d4']`), multiple matches, no match for bare ID `task_a1b2c3d4`, no match for `fix(task_a1b2c3d4):`, no match for shorter hex prefix `[task_a1b2]`, no match for trailer `Task: task_a1b2c3d4`.
**Depends on:** none
**Estimate:** 1
**Notes:** Satisfies spec FR #3 and FR #4.
**Done:** [x]

### Task 6: Commits DB layer

**What:** CRUD helpers around the `commits` table: `upsertCommit({ sha, repo, branch, task_id, message, author_ts })`, `listCommitsForTask(task_id)`, `listCommitsForRepoSince(repo, isoTimestamp)`. All writes inside a transaction.
**Files:** `src/db/commits.ts`, `src/db/commits.test.ts`
**Done when:** Unit tests on an in-memory DB confirm: upsert with same sha overwrites once, `listCommitsForTask` returns commits newest-first, `listCommitsForRepoSince` honours the cutoff. Calling upsert in a loop is wrapped in a single transaction.
**Depends on:** 2
**Estimate:** 2
**Notes:** Satisfies the persistence half of spec FR #5.
**Done:** [x]

### Task 7: Commit indexing job

**What:** Function `indexCommits(config, db)` that walks discovered repos, reads recent commits per branch (configurable horizon, default 60 days), parses each message for task IDs, looks up matching tasks, and upserts a `commits` row per match. Unknown IDs are silently dropped. Idempotent on re-run.
**Files:** `src/git/index-job.ts`, `src/git/index-job.test.ts`
**Done when:** Integration test: fixture repos contain commits with bracketed IDs (some matching seeded tasks, some not); running `indexCommits` populates `commits` rows only for valid task IDs; a second run produces zero new rows.
**Depends on:** 3, 4, 5, 6
**Estimate:** 3
**Notes:** Satisfies spec FR #5 (linking) and FR #11 (local-only). This is the integration hub for the git primitives.
**Done:** [x]

### Task 8: Auto-update `tasks.repo` and `tasks.branch`

**What:** During indexing, when a task's most recent linked commit's repo/branch differs from the row's current values, update `tasks.repo` and `tasks.branch` in the same transaction.
**Files:** `src/git/index-job.ts`, `src/db/tasks.ts`
**Done when:** Integration test: seeded task with `repo = null, branch = null`; after `indexCommits` runs over a fixture containing `[task_xxxxxxxx]` in repo `foo` branch `feat/x`, the task row reads `repo = 'foo', branch = 'feat/x'`.
**Depends on:** 7
**Estimate:** 2
**Notes:** Satisfies spec FR #13 — wires the existing Phase 1 stubs.
**Done:** [x]

### Task 9: Repo state section in `sab briefing`

**What:** Add a "Repo State" section to `runBriefing` rendering, for each tracked repo associated with the active context (or all repos if `contexts.repos` is empty): branch (or `detached @ <sha>`), dirty indicator, and the most recent task-linked commits for the active context.
**Files:** `src/commands/briefing.ts`
**Done when:** A briefing run on a fixture with two repos prints a repo state section showing branch + dirty flag for each, with linked-commit lines under the relevant tasks. A repo with detached HEAD renders as `detached @ <sha>`. No repo state appears if `repos_dir` is empty.
**Depends on:** 4, 7
**Estimate:** 3
**Notes:** Satisfies spec FR #6 and FR #7. The empty-`contexts.repos` fallback is an assumption — flag for review if scope expands.

### Task 10: Stale-branch subsection in briefing

**What:** Inside the repo state section, list branches whose latest commit `author_ts` is older than `briefing.stale_branch_days` in a distinct "Stale Branches" subsection.
**Files:** `src/commands/briefing.ts`
**Done when:** Fixture repos with a branch last-committed 20 days ago appear in the stale subsection at default `stale_branch_days = 14`; branches inside the threshold do not. Subsection is omitted when empty.
**Depends on:** 9
**Estimate:** 2
**Notes:** Satisfies spec FR #9.

### Task 11: Bare/broken repo footer reporting

**What:** When indexing or briefing encounters bare repos or repos that fail to read, collect them and render a single footer line in the briefing listing the paths and a one-word reason.
**Files:** `src/git/index-job.ts`, `src/commands/briefing.ts`
**Done when:** Fixture with one working repo + one bare repo + one repo with a corrupt `.git`: the briefing renders the working repo normally and prints a footer like `Skipped 2 repos: foo (bare), bar (read-error)`. No crash, exit 0.
**Depends on:** 9
**Estimate:** 2
**Notes:** Satisfies spec FR #8.

### Task 12: Show linked commits in `sab task view`

**What:** Extend `runTaskView` to query `commits` for the task and render a "Recent Commits" section under state history with `<short-sha>  <message-first-line>  <author-date>`.
**Files:** `src/commands/task/view.ts`
**Done when:** `sab task view <id>` for a task with three linked commits prints all three, newest first, each one line; a task with no commits omits the section entirely.
**Depends on:** 6
**Estimate:** 1
**Notes:** Satisfies the `sab task view` exposure part of spec FR #5.

### Task 13: Scan budget + degradation

**What:** Wrap per-repo indexing with a wall-clock budget so the full scan finishes within 2s across 25 repos on a developer laptop; repos that exceed their slice are skipped and added to the footer list with reason `timeout`.
**Files:** `src/git/index-job.ts`, `src/git/index-job.test.ts`
**Done when:** Benchmark test against 25 fixture repos completes in under 2000ms; a fixture repo with an artificially slowed `git` call appears in the skipped list with reason `timeout`, and the briefing still renders.
**Depends on:** 7, 11
**Estimate:** 2
**Notes:** Satisfies spec FR #12. Use `child_process.spawn` with a per-call timeout.

### Task 14: Weekly briefing

**What:** Implement `sab briefing --weekly`: aggregate `state_history` over the last 7 days (tasks that entered `done` = shipped; tasks still in `active`/`blocked` with no transition in window = stalled) and `commits.author_ts` over the same window (commit count per repo = activity).
**Files:** `src/commands/briefing.ts`, `src/commands/briefing.test.ts`
**Done when:** Fixture: 3 tasks moved to `done` in window, 2 stalled, 4 repos with mixed commit counts. Running `sab briefing --weekly` prints a "Shipped" list (3 titles), a "Stalled" list (2 titles), and a "Repo Activity" table with commit counts per repo, all bounded to the 7-day window. Daily briefing is unaffected.
**Depends on:** 7, 9
**Estimate:** 5
**Notes:** Satisfies spec FR #10. PHASES.md explicitly flags this as more complex than it appears — budget for state-history parsing and timestamp aggregation.

---

## Summary

- **Total tasks:** 14
- **Total estimated effort:** 30 story points
- **Critical path:** Tasks 1+2 → 3 → 4 → 7 → 9 → 14 (≈ 18 points). Indexing (7) is the integration hub; briefing (9) and weekly (14) sit downstream of it.
- **Risks:**
  - **Task 14 (Weekly briefing, 5 pts)** — PHASES.md flags this as deceptively complex. State-history parsing across many tasks and per-repo timestamp aggregation are both larger than they look.
  - **Task 13 (Scan budget, 2 pts)** — the 2s/25-repo target is empirical; if `git` subprocess spawn overhead dominates, the budget may force parallelism or libgit2 bindings, expanding scope.
  - **Task 9 (Repo state section, 3 pts)** — context-to-repo association is under-specified; the empty-`contexts.repos` fallback is an assumption that may need follow-up CLI surface if users want explicit scoping.
