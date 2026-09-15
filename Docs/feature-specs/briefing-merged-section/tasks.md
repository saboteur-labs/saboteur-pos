# Briefing Merged Section — Implementation Tasks

Source spec: `Docs/feature-specs/briefing-merged-section/briefing-merged-section-spec.md`
(tracked as `task_32a7a6e8`). Spec is final except OQ-1; FR-17 is planned as written
per lead direction.

### Task 1: Config additions for Landed + worktree filtering

**What:** Extend `Config` with `repos.<name>.default_branch` (a new `repos` record keyed by repo name), `briefing.landed_max_rows` (default 20), `briefing.repo_state_max_commits` (default 5), `briefing.week_start` (default `'monday'`), and `git.worktree_branch_patterns` (default `["worktree-agent-*"]`), written by `makeDefaultConfig` and back-filled in `loadConfig` for existing config files (mirroring the existing `stale_branch_days` back-fill).
**Files:** `src/config.ts`, `src/config.test.ts`
**Done when:** A fresh `sab init` writes all five fields (`repos: {}`, `briefing.landed_max_rows: 20`, `briefing.repo_state_max_commits: 5`, `briefing.week_start: 'monday'`, `git.worktree_branch_patterns: ["worktree-agent-*"]`) into `saboteur.config.json`. Loading a pre-existing config JSON missing any subset of these fields back-fills each to its default without mutating fields that are already present. `tsc --noEmit` passes with the new shape referenced as `config.repos['x']?.default_branch`, `config.briefing.landed_max_rows`, `config.briefing.repo_state_max_commits`, `config.briefing.week_start`, `config.git.worktree_branch_patterns`.
**Depends on:** none
**Estimate:** 2
**Notes:** Satisfies FR-4, FR-5, FR-9, FR-13, FR-14. `repos` is new top-level config, not nested under `briefing` or `git`, per FR-5 ("keyed by repo name in config, not stored on a context").
**POS:** task_46dc6012
**Done:** [x]

### Task 2: Briefing window computation (pure)

**What:** A pure module computing the default Landed window from `week_start` and "now" (calendar week starting at 00:00 local on the configured start day; on the start day itself, use the *previous* full week instead), and a pure validator/parser for `--since`/`--until` flags.
**Files:** `src/briefing/window.ts`, `src/briefing/window.test.ts`
**Done when:** Unit tests cover: `week_start='monday'`, "now" = a Wednesday → window is Mon 00:00 through the following Mon 00:00; "now" = the configured start day → window is the *previous* calendar week; an unrecognised `week_start` value throws with a human-readable message; `--since` alone runs through end of today; `--until` alone throws; `--since` later than `--until` throws; both given and valid returns an inclusive `[since, until]` range in local time. No test touches git or the DB.
**Depends on:** none
**Estimate:** 2
**Notes:** Satisfies FR-1, FR-2. Keep this free of `Date.now()` calls without an injectable clock so tests are deterministic (accept `now: Date` as a parameter).
**POS:** task_9aedc869
**Done:** [x]

### Task 3: Default-branch resolution (pure over injected refs)

**What:** A pure function `resolveDefaultBranch(repoName, config, { originHeadTarget, localBranches })` implementing the FR-4 resolution order — configured `repos.<repo>.default_branch` (warn + fall through if it doesn't exist locally), then `refs/remotes/origin/HEAD` target, then the first of `main`/`master`/`development`/`develop` present locally — returning either the resolved branch name or a `no-default-branch` skip reason.
**Files:** `src/git/default-branch.ts`, `src/git/default-branch.test.ts`
**Done when:** Unit tests cover all four resolution paths, the configured-but-missing-branch warning-and-fallthrough case, and the fully-unresolved `no-default-branch` case, all driven by literal `originHeadTarget`/`localBranches` inputs with no subprocess calls.
**Depends on:** Task 1
**Estimate:** 2
**Notes:** Satisfies FR-4, FR-5. Keeping this pure (no `gitRun`) lets Task 7 unit-test the git-facing wiring separately from the resolution logic.
**POS:** task_a82b123a
**Done:** [x]

### Task 4: Git read additions for landed commits

**What:** Extend `src/git/read.ts` with `getOriginHeadTarget(repoPath)` (parses `refs/remotes/origin/HEAD`'s target branch name), `getFirstParentLog(repoPath, ref, sinceIso, untilIso)` (first-parent log with parent-count field for merge detection: sha, author date, subject, parent count), and `getMergeRangeBodies(repoPath, mergeSha)` (commit messages in `<merge>^1..<merge>^2`, for FR-8 task-ID collection). All go through the existing `gitRun`/`withGitTimeout` machinery — no new subprocess path bypasses the timeout.
**Files:** `src/git/read.ts`, `src/git/read.test.ts`
**Done when:** Unit tests against fixture repos confirm: `getOriginHeadTarget` returns the branch name when `origin/HEAD` is set and `null` when it isn't; `getFirstParentLog` returns entries newest-first bounded by the given window and correctly flags merge vs. non-merge commits by parent count; `getMergeRangeBodies` returns the commit messages reachable only via a merge's second parent. Every call honours `currentTimeoutMs` (reuses `gitRun`).
**Depends on:** none
**Estimate:** 3
**Notes:** Satisfies FR-8, FR-10, FR-11, FR-12 (local-only, no fetch — confirm no call here adds `--all`/network flags).
**POS:** task_bbb78924
**Done:** [x]

### Task 5: Subject parsing for PR numbers (pure)

**What:** Pure functions `parseMergePrNumber(subject: string): number | null` (matches `Merge pull request #N`) and `parseSquashPrNumber(subject: string): number | null` (matches a trailing `(#N)`).
**Files:** `src/git/parse.ts`, `src/git/parse.test.ts`
**Done when:** Unit tests cover a real `Merge pull request #200 from saboteur-works/feat/trash-ui` subject, a `Merge branch '…'` subject (no match), a squash subject ending `(#183)` (match), a subject with `(#183)` mid-string (no match — must be trailing), and a plain subject (no match for either).
**Depends on:** none
**Estimate:** 1
**Notes:** Satisfies the PR-number half of FR-8.
**POS:** task_6cb128c8
**Done:** [x]

### Task 6: Worktree branch-name matcher

**What:** A function `isWorktreeBranch(branch: string, patterns: string[]): boolean` that reuses the existing glob-to-regex engine in `src/git/globs.ts` against a bare branch name (no path segments) rather than a file path.
**Files:** `src/git/globs.ts`, `src/git/globs.test.ts`
**Done when:** Unit tests confirm `worktree-agent-a1b2c3` matches pattern `worktree-agent-*`, `main` and `feat/x` do not, and matching is exact-anchor (`worktree-agent-x-extra` does not match a pattern lacking a trailing `*`).
**Depends on:** none
**Estimate:** 1
**Notes:** Satisfies the matching half of FR-14. Reuses `globToRe` directly — `pathMatches`'s directory-glob special-casing doesn't apply to flat branch names, so call `globToRe(pattern).test(branch)` rather than `pathMatches`.
**POS:** task_9ebc1cca
**Done:** [x]

### Task 7: Landed-rows orchestration module

**What:** A module `computeLandedRows(repoPath, repoName, config, window)` that resolves the default branch (Task 3, fed with live `getOriginHeadTarget`/`listBranches` from Task 4), reads first-parent history in the window (Task 4), classifies each entry merge vs. non-merge, parses PR numbers (Task 5) and collects task IDs per FR-8 (own message for non-merge, `^1..^2` range bodies for merge), resolves task IDs to titles, and caps output at `briefing.landed_max_rows` with a `droppedCount`. Returns `{ rows, droppedCount, defaultBranch }` or a skip reason (`no-default-branch` / `timeout`).
**Files:** `src/git/landed.ts`, `src/git/landed.test.ts`
**Done when:** Integration test against a fixture repo with a mix of direct commits, a `Merge pull request #N` merge (with task IDs only in the merged-in commits), and a squash commit ending `(#N)` (with a task ID in its own message) produces rows matching FR-8 exactly: correct short SHA/date/subject/PR number per row, task titles resolved for known IDs, unresolvable-task rows still shown, newest-first, capped at a small `landed_max_rows` in the test with a correct `droppedCount`.
**Depends on:** Task 2, Task 3, Task 4, Task 5
**Estimate:** 5
**Notes:** Satisfies FR-6 (per-repo commit list), FR-8, FR-9 (cap + dropped count), FR-10 (computed live, nothing written), FR-11 (timeout handling — wrap the whole per-repo computation in `withGitTimeout` and translate `GitTimeoutError` to a skip), FR-12 (no fetch/write — audit every git call added here for that).
**POS:** task_8c3f2199
**Done:** [x]

### Task 8: Wire the Landed section into the daily briefing

**What:** In `runBriefing`, compute the window (Task 2, from `--since`/`--until` or the FR-1 default), call `computeLandedRows` (Task 7) for each repo in the same scope Repo State already uses (respecting `--all` per FR-6), and render a new "Landed" section immediately after Repo State — the placement chosen to avoid renumbering the fixed Section 1–7 order in LOGIC.md §7, since Repo State itself already sits after Section 7 undocumented. Per repo: rows newest-first, a trailing `+N more` line when rows are dropped; per FR-9, omit a repo with zero rows and omit the whole section when no repo has any.
**Files:** `src/commands/briefing.ts`, `src/index.ts` (register `--since <YYYY-MM-DD>` / `--until <YYYY-MM-DD>` on `briefing`), `tests/layer6-briefing.test.ts`
**Done when:** A fixture briefing run with two linked repos, one with landed commits in the default window and one with none, shows a "Landed" section for only the first, with rows formatted per FR-8. `--since`/`--until` override the window and are validated per Task 2's rejection rules (non-zero exit, message on stderr). `--all` shows every discovered working repo's landed rows regardless of context scope. A repo whose landed computation times out is reported the same way Repo State reports a timeout (added to the existing skipped-repo footer, not a silent drop).
**Depends on:** Task 1, Task 2, Task 7
**Estimate:** 3
**Notes:** Satisfies FR-1, FR-2, FR-3, FR-6, FR-9, FR-11.
**POS:** task_30322ba2
**Done:** [x]

### Task 9: Wire the Landed section into the weekly briefing

**What:** Make `runWeeklyBriefing` include the Landed section using the weekly briefing's existing rolling window (not the FR-1 calendar-week default), with `--since`/`--until` applying the same as in daily mode when passed.
**Files:** `src/commands/briefing.ts`, `tests/layer6-briefing.test.ts`
**Done when:** `sab briefing --weekly` on a fixture with landed commits in the rolling 7-day window renders the same Landed section shape as daily mode, bounded to that window; passing `--since`/`--until` on `--weekly` overrides the window for the Landed section only, per FR-7, and the other weekly sections keep their rolling window.
**Depends on:** Task 7, Task 8
**Estimate:** 2
**Notes:** Satisfies FR-7. Explicitly out of scope: switching the weekly briefing itself to calendar weeks (deferred spec, per spec's Non-goals).
**POS:** task_87641c11
**Done:** [x]

### Task 10: Configurable Repo State commit cap

**What:** Replace the hardcoded `LIMIT 5` in `collectRepoState`'s commit query with `briefing.repo_state_max_commits`.
**Files:** `src/commands/briefing.ts`, `tests/layer6-briefing.test.ts`
**Done when:** A fixture with `briefing.repo_state_max_commits` set to 2 and a repo with 4 qualifying commits shows exactly 2 in Repo State; the default (5) reproduces today's existing behaviour and passes the existing Repo State commit-count tests unchanged.
**Depends on:** Task 1
**Estimate:** 1
**Notes:** Satisfies FR-13.
**POS:** task_1d776baf
**Done:** [x]

### Task 11: Hide worktree branches from Repo State by default

**What:** Filter `git.worktree_branch_patterns`-matching branches (Task 6) out of Repo State's Stale Branches subsection and out of the per-repo commit list (by `commits.branch`), unless `sab briefing --include-worktrees` is passed.
**Files:** `src/commands/briefing.ts`, `src/index.ts` (register `--include-worktrees` on `briefing`), `tests/layer6-briefing.test.ts`
**Done when:** A fixture repo with a `worktree-agent-<id>` branch carrying a stale, task-linked commit: default `sab briefing` shows neither the branch in Stale Branches nor its commit in the repo's commit list; `sab briefing --include-worktrees` shows both. A commit on a non-matching branch is unaffected either way. The `commits` query gains a branch filter that is a no-op when `--include-worktrees` is set.
**Depends on:** Task 1, Task 6
**Estimate:** 3
**Notes:** Satisfies FR-14. FR-15 (the filter is display-only; `indexCommits` keeps indexing matching branches) is verified here by asserting `sab task view` / the commit still exists in the DB even while hidden from the briefing — add that assertion in this task rather than a separate one, since it's a one-line check once the filter exists.
**POS:** task_030c59b4
**Done:** [x]

### Task 12: Fix `indexCommits` branch-scan order (FR-16)

**What:** In `indexCommits`, scan non-matching (`git.worktree_branch_patterns`) branches before matching ones, so a commit reachable from both a regular branch and a worktree-agent branch is recorded (via the existing "first branch seen wins" `commits.branch` semantics) against the non-matching branch.
**Files:** `src/git/index-job.ts`, `src/git/index-job.test.ts`
**Done when:** A new test proves the exact scenario FR-16 exists for: a fixture with a commit reachable from both `main` and `worktree-agent-x` (e.g. the worktree branch was cut from `main` after the commit) — after `indexCommits` runs, the `commits` row for that SHA has `branch = 'main'`, not `branch = 'worktree-agent-x'`, regardless of `listBranches`' natural return order. A commit reachable only from a worktree branch still gets `branch = 'worktree-agent-x'`.
**Depends on:** Task 1, Task 6
**Estimate:** 2
**Notes:** Satisfies FR-16. Without this, a commit on both a regular branch and a worktree-agent branch could be recorded against the worktree branch and wrongly hidden by Task 11's display-time filter (FR-14/FR-15).
**POS:** task_0601fd08
**Done:** [x]

### Task 13: `sab git list --include-worktrees`

**What:** Add `--include-worktrees` to `sab git list`. Without the flag, output is unchanged (each repo row shows only its checked-out branch, as today). With the flag, each repo row is followed by that repo's local branches matching `git.worktree_branch_patterns` (Task 6), so leftover agent branches can be found and cleaned up.
**Files:** `src/commands/git/list.ts`, `src/index.ts`, `tests/git-list.test.ts`
**Done when:** `sab git list` output is byte-identical before and after this change on a fixture with worktree-pattern branches present. `sab git list --include-worktrees` on the same fixture lists each matching branch indented under its repo's row; a repo with no matching branches shows no extra lines.
**Depends on:** Task 1, Task 6
**Estimate:** 2
**Notes:** Satisfies FR-17 as specified (OQ-1 unresolved: whether this is the intended reading of the flag; planned as written per lead direction — flag any UX friction found during implementation back to the spec's open question rather than resolving it here).
**POS:** task_21a0bafc
**Done:** [x]

### Task 14: Update CLI.md, LOGIC.md, and config docs

**What:** Document the new briefing flags (`--since`, `--until`, `--include-worktrees`) and the `git list --include-worktrees` flag in CLI.md; add the Landed section (and, since it's currently undocumented, the existing Repo State section) to LOGIC.md §7 in their actual rendered order; document the five new config fields from Task 1 wherever `stale_branch_days`/`provider_timeout_ms` are already documented.
**Files:** `Docs/CoreSpec/Docs/CLI.md`, `Docs/CoreSpec/Docs/LOGIC.md`, `Docs/features/git-integration.md`, `README.md`
**Done when:** CLI.md's `sab briefing` flag table lists `--since`, `--until`, `--all`, `--weekly`, `--include-worktrees`; CLI.md's `sab git list` entry documents `--include-worktrees`; LOGIC.md §7 lists Repo State and Landed as sections in the order they actually render, with the FR-1/FR-9 window and cap rules stated; the new config fields appear alongside the existing `briefing`/`git` config documentation with their defaults.
**Depends on:** Task 8, Task 9, Task 10, Task 11, Task 12, Task 13
**Estimate:** 2
**Notes:** No code changes in this task.
**POS:** task_081b52f4
**Done:** [x]

### Task 15: End-to-end verification against a temp git repo fixture

**What:** A single end-to-end test (or small suite) exercising the full feature against a real temp git repo: default-window computation, `--since`/`--until` override, a merge commit with PR number and task IDs from its merge range, a squash commit with a trailing `(#N)` and its own task ID, worktree-branch hiding in both Repo State and `git list`, and `--all` bypassing context scope.
**Files:** `tests/briefing-landed-e2e.test.ts`
**Done when:** The suite builds a temp repo with `git init`, seeds direct commits, a real merge commit (`git merge --no-ff`) whose second-parent range carries a `[task_xxxxxxxx]` message, a squash-style commit ending `(#N)`, and a `worktree-agent-*` branch; runs `sab briefing`, `sab briefing --since ... --until ...`, `sab briefing --include-worktrees`, `sab briefing --all`, and `sab git list --include-worktrees` via the existing subprocess test harness (`sabConfig`); every assertion in the spec's FR-1 through FR-17 is exercised at least once across the suite; full `npm test` passes.
**Depends on:** Task 8, Task 9, Task 10, Task 11, Task 12, Task 13
**Estimate:** 3
**Notes:** This is the FR-by-FR net; keep a comment mapping each `it()` block to the FR(s) it covers so a future spec change can find the corresponding test fast.
**POS:** task_8732240f
**Done:** [x]

---

## Summary

- **Total tasks:** 15
- **Total estimated effort:** 34 story points
- **Critical path:** Tasks 2 + 3 + 4 + 5 → 7 → 8 → 9 → 14/15 (≈ 17 points on the Landed-section spine; Tasks 1, 6, 10, 11, 12, 13 branch off Task 1/6 in parallel and converge at 14/15).
- **Risks:**
  - **Task 7 (Landed orchestration, 5 pts)** — the highest-complexity task: merges four upstream modules (window, default-branch, git reads, parsing) and owns the FR-8 merge-vs-non-merge branching plus FR-11 timeout wrapping. Most likely to reveal a gap in the Task 4 git-read primitives once real fixture history is exercised.
  - **Task 12 (indexCommits scan order, FR-16)** — changes existing indexing behaviour (branch-scan order affects which branch a shared commit is attributed to); needs the exact reachable-from-both fixture to prove, not just a positive/negative pattern-match test.
  - **Task 11 (worktree hiding in Repo State)** — two coupled filters (Stale Branches list + commit-list branch filter) plus the FR-15 "still indexed, only hidden at display time" invariant; easy to accidentally filter at the wrong layer (index vs. render), which Task 12 depends on being correct.
  - **OQ-1 (FR-17 reading)** — Task 13 implements the spec's literal reading of `--include-worktrees` on `git list`, but the open question about whether that's the intended UX is still unresolved; a later answer to OQ-1 could require reworking Task 13's output shape.
