# Briefing Merged Section — Follow-up work

### FU-1: Merge rows can carry dozens of task titles

**What:** A row's task list is printed in full on one line. Measured against the
real `getwrite` repo on 2026-09-15, PR #200's row resolved to 26 task titles and
PR #199's to 23, producing lines several hundred characters wide. The section is
hard to read at exactly the moment it has the most to report.
**Why deferred:** FR-8 requires the resolved titles and sets no cap; a per-row
task cap, a count (`→ 26 tasks`), or wrapping is a display decision the spec does
not make.
**Context:** `renderLanded` in `src/commands/briefing.ts` builds the row; rows
come from `computeLandedRows` in `src/git/landed.ts`. `briefing.landed_max_rows`
caps rows, not tasks per row.
**Relates to:** Task 8
**Raised:** 2026-09-15
**Resolved:** [ ]
**Resolved on:**

### FU-2: The window filters on author date, not landing date

**What:** FR-6 defines the window over author dates. A commit authored before the
window but merged or rebased onto the default branch inside it does not appear;
one authored inside the window but landed later does. Committer date would track
"when it landed" more closely for rebase and squash merges.
**Why deferred:** The spec says author date, and changing it would alter which
rows appear for every user.
**Context:** `getFirstParentLog` in `src/git/read.ts` filters on `%aI`; the
merge-vs-direct classification is unaffected. Switching would mean reading `%cI`
too and deciding which one the window uses.
**Relates to:** Task 4
**Raised:** 2026-09-15
**Resolved:** [ ]
**Resolved on:**

### FU-3: First-parent scans stop after 1000 commits

**What:** `getFirstParentLog` walks at most `FIRST_PARENT_SCAN_LIMIT` (1000)
first-parent commits. A `--since` window further back than 1000 landings on a
busy repo silently reports nothing from beyond that point.
**Why deferred:** The limit replaced `--since`, which pruned the walk at the
first commit older than the bound and so dropped in-window commits sitting behind
a backdated head (the regression test in `src/git/read.test.ts` covers that). A
correct unbounded scan needs paging or a cheaper pre-pass.
**Context:** `src/git/read.ts`. `getwrite` has 333 first-parent commits in its
whole history, so the limit is not reachable there today.
**Relates to:** Task 4
**Raised:** 2026-09-15
**Resolved:** [ ]
**Resolved on:**

### FU-4: The Landed timeout path has no test

**What:** `computeLandedRows` translates `GitTimeoutError` into a
`{ kind: 'skipped', reason: 'timeout' }` result, which the briefing prints in the
Landed skipped footer. No test exercises it.
**Why deferred:** Forcing a real git timeout needs either a repo slow enough to
exceed the budget or a fake clock; both make the suite flaky or require injecting
a git runner, which the existing git tests do not do.
**Context:** `src/git/landed.ts`; `src/git/read.ts` owns `withGitTimeout`. The
equivalent path in `collectRepoState` is likewise untested.
**Relates to:** Task 7
**Raised:** 2026-09-15
**Resolved:** [ ]
**Resolved on:**
