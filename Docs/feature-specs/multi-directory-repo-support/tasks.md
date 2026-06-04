# Multi Directory Repo Support — Implementation Tasks

### Task 1: Add `repos_dirs` config field and a `getReposDirs` resolver

**What:** Extend the config type with an optional `repos_dirs` array and add a helper that resolves the effective list of repo roots.
**Files:** `src/config.ts`, `src/config.test.ts` (new)
**Done when:** `repos_dirs?: string[]` is on the `Config` interface, and `getReposDirs(config)` returns the tilde/absolute-expanded, de-duplicated union of `repos_dir` (when present) and `repos_dirs` (when present): only `repos_dir` → `[that]` (FR-3); only `repos_dirs` → those (FR-2); both → union with `repos_dir` as one extra root (FR-4); identical entries collapse to one (FR-6); each entry passed through `resolvePath` (FR-1).
**Depends on:** none
**Estimate:** 2
**Notes:** Do NOT filter out nonexistent directories here — FR-5 is satisfied downstream (`discoverRepos` already returns `[]` for a missing dir). De-dup AFTER `resolvePath` so `~/code` and an absolute equivalent collapse. `makeDefaultConfig` keeps emitting `repos_dir` only — no default `repos_dirs`.
**Done:** [ ]

---

### Task 2: Multi-root discovery with the basename-collision guard

**What:** Add `discoverAllRepos(roots)` that unions per-root discovery and excludes working repos whose basename collides across roots.
**Files:** `src/git/discover.ts`, `src/git/discover.test.ts`
**Done when:**
- `discoverAllRepos(roots: string[])` returns `{ repos: DiscoveredRepo[]; collisions: Array<{ name: string; dirs: string[] }> }`.
- Unions immediate-child discovery across every root (FR-2); a missing root contributes nothing and throws nothing (FR-5).
- When ≥2 roots each contain a **working** repo with the same basename, ALL of those repos are excluded from `repos`, each surfaced instead with `kind: 'collision'`, and the basename + its directories appear once in `collisions` (FR-9).
- A `collisionWarning(collisions)` helper returns the human-readable warning string.
- Single-root input produces the same repos as `discoverRepos` (regression guard).
**Depends on:** none
**Estimate:** 3
**Notes:** Add `'collision'` to `RepoKind`/`DiscoveredRepo` so the existing caller pattern (`kind !== 'working'` → skipped) routes collisions to the footer automatically. Leave `discoverRepos` (single-root) untouched. Collisions are detected among unioned `working` repos only; within a single root basenames are already unique. Keep the function pure — return `collisions`, let callers print the warning.
**Done:** [ ]

---

### Task 3: Wire the briefing to multi-root discovery + render collisions

**What:** Make `collectRepoState` discover across all roots and surface `name-collision` in the skipped footer with a warning.
**Files:** `src/commands/briefing.ts`, `tests/layer6-briefing.test.ts`
**Done when:** `collectRepoState` uses `getReposDirs(config)` + `discoverAllRepos(...)` instead of `discoverRepos(resolvePath(config.repos_dir))`; `'name-collision'` is added to the `SkippedRepo` reason union; `kind: 'collision'` maps to that reason in the footer; when collisions exist the warning is written to **stderr** (not stdout); a repo present under one root still renders, and existing scoping / `*` / hint behaviour is unchanged (FR-7, FR-9).
**Depends on:** Task 1, Task 2
**Estimate:** 3
**Notes:** Repos still flow through the context `repos` scope filter after discovery — multi-root only changes the candidate set (FR-8 names stay basenames). Test with a config carrying `repos_dirs` (post-edit the JSON as the stale-branch test already does).
**Done:** [ ]

---

### 🚦 Gate A: Collision & multi-root briefing review (manual)

**Type:** Manual UX review — no code, no story points.
**Reviewer:** human, eyeballing real `sab briefing` output (rebuild `dist/` first — `npx tsc`).
**Verify by hand:**
- With two `repos_dirs` configured, the briefing shows working repos from both roots under the active context's scope.
- **The disappearing-repo case:** introduce a same-basename working repo under a second root, then confirm BOTH vanish from the repo list and appear as `name-collision` in the skipped footer. Confirm this reads as a deliberate, explained exclusion — not as a repo silently going missing or the briefing looking broken.
- The collision warning lands on **stderr** (does not pollute the briefing body on stdout) and names the basename + its directories clearly enough to act on.
- A single-`repos_dir` config produces output unchanged from before this feature.
**Pass criteria:** the collision exclusion is understandable at a glance and a user can tell exactly which directories to fix; nothing about multi-root discovery surprises an existing single-dir user.
**On fail:** loop back to Task 2 (collision detection/return shape) or Task 3 (footer/warning rendering).
**Blocks:** Task 6.
**Depends on:** Task 3.
**Done:** [ ]

---

### Task 4: Wire `sab git list` to multi-root discovery + render collisions

**What:** Make `git list` enumerate across all roots and list collisions in its skipped section.
**Files:** `src/commands/git/list.ts`, `tests/git-list.test.ts`
**Done when:** `runGitList` uses `getReposDirs` + `discoverAllRepos`; working repos from every root are listed with `*` marking unchanged (FR-7); `kind: 'collision'` renders in the Skipped section as `name-collision`; the collision warning prints to stderr; the "No repos found" empty state holds only when every root is empty/missing.
**Depends on:** Task 1, Task 2
**Estimate:** 2
**Notes:** `git/list.ts` builds its own skipped reason inline (`bare ? 'bare' : 'read-error'`) — extend that mapping to handle `'collision'`. Preamble wording is unchanged by this feature.
**Done:** [ ]

---

### Task 5: Wire `context repos add` validation to the multi-root working set

**What:** Validate linkable repo names against working repos discovered across all roots, excluding collisions.
**Files:** `src/commands/context/repos.ts`, `tests/context-repos.test.ts`
**Done when:** `runContextReposAdd` builds its working-name set from `getReposDirs` + `discoverAllRepos` (so a repo under any configured root is linkable); a basename excluded as a collision is NOT linkable and yields the existing FR-4 not-found error; basename matching is unchanged (FR-8); single-`repos_dir` behaviour is identical to today.
**Depends on:** Task 1, Task 2
**Estimate:** 2
**Notes:** Reuse the same `.filter(r => r.kind === 'working')` shape on the unioned result. A colliding name is intentionally unlinkable — it has no unambiguous identity.
**Done:** [ ]

---

### Task 6: End-to-end + back-compat integration tests

**What:** Cross-cutting tests for the union, the collision lifecycle, and single-`repos_dir` back-compat through the real CLI.
**Files:** `tests/multi-repos-dir.test.ts` (new)
**Done when:**
- A config with two `repos_dirs` shows repos from both in `sab git list` and `sab briefing` (FR-2).
- A config with only the legacy `repos_dir` behaves exactly as before (FR-3) — assert against the existing single-dir expectations.
- Introducing a same-basename working repo under a second root removes BOTH from the rendered repo list, lists each as `name-collision` in the skipped footer, and emits the stderr warning (FR-9) — including the regression case where a previously-visible repo disappears.
- A nonexistent directory in `repos_dirs` is skipped while other roots still render (FR-5).
- Full suite passes.
**Depends on:** Task 3, Task 4, Task 5
**Estimate:** 3
**Notes:** Reuse the `makeRepo`/`git init` helpers from the existing briefing and context-repos tests. Multi-dir tests must post-edit the config JSON to add `repos_dirs` (the `createTestEnv` helper only writes `repos_dir`).
**Done:** [ ]

---

## Summary

- Total tasks: 6 (15 story points) + 1 manual review gate (unpointed)
- Total estimated effort: 15 story points; the gate adds wall-clock review time, not points.
- Critical path: Tasks 2 → 3 → **Gate A** → 6 (with Task 1 a shared prerequisite of 3/4/5, and Tasks 4/5 parallel to 3)
- Manual gate: **Gate A** (after Task 3) — reviews the collision exclusion and the disappearing-repo behaviour in the briefing, the highest-UX-risk surface; blocks the integration-test task.
- Risks:
  - **Task 2** — the collision guard is the conceptual core; getting "exclude *all* colliding repos" right (not first-wins) and keeping `discoverRepos` untouched is the main correctness risk. The new `'collision'` kind ripples into every caller's skipped-reason mapping (Tasks 3–4).
  - **Task 3** — FR-9 means a repo that rendered under a single root can *vanish* once a second root introduces a colliding basename. That behaviour-visible surprise is the highest-UX-risk item; Task 6 must assert it explicitly.
  - **Back-compat** — every wiring task (3/4/5) must prove single-`repos_dir` output is byte-for-byte unchanged, since `getReposDirs` collapsing to one root is what guarantees no regression.
