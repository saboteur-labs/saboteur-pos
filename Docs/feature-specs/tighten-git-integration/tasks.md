# Tighten Git Integration — Implementation Tasks

### Task 1: Add repo-array mutators to the contexts DB layer

**What:** Add `addContextRepos` and `removeContextRepos` to manage a context's `repos` JSON array.
**Files:** `src/db/contexts.ts`
**Done when:** `addContextRepos(db, slug, ['a','b'])` appends both names to `contexts.repos`, de-duplicates against existing entries, and persists as a JSON array; `removeContextRepos(db, slug, ['a'])` removes `a` and is a no-op for names not present; both run inside a single `db.transaction` and return the updated `Context`.
**Depends on:** none
**Estimate:** 2
**Notes:** Read the current array via the existing `getContext().repos` (already `JSON.parse`d), mutate in memory, write back with `UPDATE contexts SET repos = ? WHERE id = ?`. No repos_dir validation here — that needs config/discovery and belongs in the command layer (Task 2).
**Done:** [x] — `addContextRepos`/`removeContextRepos` + shared `persistRepos` in `src/db/contexts.ts`; unit tests in `src/db/contexts.test.ts` (5 passing). `tsc --noEmit` clean.

---

### Task 2: Implement `context repos` list/add/remove command runners

**What:** Create the run functions for `sab context repos <slug>`, `... add`, and `... remove`, including validation.
**Files:** `src/commands/context/repos.ts` (new)
**Done when:**

- `runContextReposList(slug)` prints each linked repo basename, or `"(no repos linked)"` when the array is empty (FR-1).
- `runContextReposAdd(slug, repos)` rejects any repo not present as a `working` repo from `discoverRepos(resolvePath(config.repos_dir))`, exiting non-zero with `"'<repo>' not found under repos_dir. Run 'sab git list' to see available repos."` and writing nothing (FR-4); on success calls `addContextRepos` (FR-2).
- `runContextReposRemove(slug, repos)` calls `removeContextRepos`; removing an absent name is a silent no-op (FR-3).
- All three exit non-zero with `"Context '<slug>' does not exist."` when `getContext` returns null (FR-9).
- Stored/matched names are basenames, never absolute paths (FR-5).
  **Depends on:** Task 1
  **Estimate:** 3
  **Notes:** Mirror the structure of `src/commands/context/new.ts` (config load → `getDb` → checks → `db.close()`). Validate ALL names before any write so a bad name in a multi-repo add aborts the whole add (transactional intent of FR-2). Reuse `discoverRepos` + `r.kind === 'working'` exactly as `git/list.ts` does.
  **Done:** [x] — `runContextReposList/Add/Remove` in `src/commands/context/repos.ts`; FR-1/3/4/5/9 covered. `tsc --noEmit` clean. Behavioural (CLI) tests deferred to Task 3, the first point the commands are invokable via `sabConfig` (runners call `process.exit`, so the subprocess harness is the only viable seam).

---

### Task 3: Register the `context repos` command group in the CLI

**What:** Wire `repos` (list), `repos add`, and `repos remove` under the `context` command and update help text.
**Files:** `src/index.ts`
**Done when:** `sab context repos <slug>`, `sab context repos add <slug> <repo...>`, and `sab context repos remove <slug> <repo...>` all parse and dispatch to the Task 2 runners with variadic repo args; the `context` help block lists the three new commands.
**Depends on:** Task 2
**Estimate:** 2
**Notes:** Commander caveat — a `repos` command that both takes a bare `<slug>` action AND has `add`/`remove` subcommands is awkward. Cleanest: `const repos = context.command('repos <slug>')` with `.action(list)` for the bare form, plus `repos.command('add <slug> <repo...>')` / `repos.command('remove <slug> <repo...>')`. Verify the bare-action + subcommand combo resolves correctly; if it conflicts, make `list` an explicit `repos list <slug>` and keep bare `repos <slug>` as an alias.
**Done:** [x] — registered in `src/index.ts` using a `{ isDefault: true }` `list <slug>` subcommand, which gives BOTH `context repos <slug>` and explicit `context repos list <slug>` (the resilient form the note anticipated). Top-level + `context` help updated. Integration tests in `tests/context-repos.test.ts` (8 passing) cover FR-1/2/3/4/9 and default-routing; this also retroactively verifies the Task 2 runners. Adjacent suites (layer3, git-list) green; `tsc` clean.

---

### 🚦 Gate A: CLI ergonomics review (manual)

**Type:** Manual UX review — no code, no story points.
**Reviewer:** human, at a real terminal against a seeded DB.
**Verify by hand:**

- `sab context repos <slug>` on an empty context and a populated one — output is readable and the empty message is clear.
- `add` with a valid repo, multiple repos at once, a duplicate (no double entry), and an unknown name — the unknown-name error matches FR-4 verbatim, exits non-zero, and writes nothing.
- `remove` of a linked repo and of an absent name (silent no-op).
- Every subcommand against a nonexistent context prints the FR-9 error.
- No stack traces leak; exit codes are 0 on success and non-zero on every error path.
  **Pass criteria:** wording, alignment, and exit codes feel right to a human before tests lock them in.
  **On fail:** loop back to Task 2 (messages/validation) or Task 3 (parsing/help).
  **Blocks:** Task 6, Task 7.
  **Depends on:** Task 3.
  **Done:** [x]

---

### Task 4: Flip empty-scope to "show none" and render the link hint in briefing

**What:** Change Repo State so an empty `contexts.repos` shows no repos plus an opt-in hint, instead of showing every discovered repo.
**Files:** `src/commands/briefing.ts`
**Done when:**

- In `collectRepoState`, an active context whose `repos` array is empty yields zero rendered repos (replaces the `briefing.ts:260` `ctx.repos.length > 0 ? set : null` fall-through that currently shows all) (FR-6).
- When the active context's scope is empty, the Repo State section is still emitted and shows `"(no repos linked to '<slug>')"` followed by a hint line `"Link with: sab context repos add <slug> <repo>"`, rather than `renderRepoState` returning `[]` and the section being omitted (FR-7).
- A context WITH linked repos renders exactly its linked working repos as before.
  **Depends on:** none
  **Estimate:** 3
  **Notes:** Two coupled changes: the filter in `collectRepoState` (empty array → empty set, not `null`) and the omit-guard in `renderRepoState` (currently returns `[]` when no repos/skipped). Thread an "is scope empty" signal out of `collectRepoState` so the renderer can choose the hint vs the normal omit. This is a deliberate behaviour change to existing briefing output — see Task 7 for the test fallout.
  **Done:** [ ]

---

### Task 5: Make `sab briefing --all` bypass repo scoping

**What:** Have `--all` on briefing show every discovered working repo, ignoring the context's `repos` scope.
**Files:** `src/index.ts`, `src/commands/briefing.ts`
**Done when:** `sab briefing --all` renders all `working` repos under `repos_dir` regardless of `active_context.repos`, and does NOT show the Task 4 "no repos linked" hint; `sab briefing` without `--all` keeps the scoped behaviour from Task 4 (FR-8).
**Depends on:** Task 4
**Estimate:** 2
**Notes:** Confirm whether the `briefing` command already accepts `--all`; the registration around `src/index.ts:40` shows only `[--context]`. If absent, add `.option('--all', ...)` and thread a flag into `runBriefing` → `collectRepoState` that forces the unscoped (all working repos) path.
**Done:** [ ]

---

### 🚦 Gate B: Briefing output review (manual) — highest UX risk

**Type:** Manual UX review — no code, no story points.
**Reviewer:** human, eyeballing real `sab briefing` output.
**Verify by hand, in all three states:**

- **Empty-scope context:** the `── Repo State ──` section appears with `(no repos linked to '<slug>')` and the `Link with: sab context repos add <slug> <repo>` hint. Confirm it reads as _guidance_, not as a crash or an error, and that a brand-new user wouldn't think the briefing broke.
- **Scoped context:** only the linked repos render; headers, dirty/clean flags, per-repo commits, Stale Branches, and the Skipped footer all still format correctly.
- **`sab briefing --all`:** every working repo renders and the "no repos linked" hint does NOT appear.
- Blank-line spacing between sections is unchanged from before the flip; the empty-briefing fallback message is unaffected.
  **Pass criteria:** the behaviour change does not surprise or alarm an existing user; the empty state guides them to the fix. Consider whether a one-line changelog/release note is warranted for the changed default.
  **On fail:** loop back to Task 4 (filter/renderer coupling) or Task 5 (`--all` path).
  **Blocks:** Task 7.
  **Depends on:** Task 5.
  **Done:** [ ]

---

### Task 6: Confirm `sab git list` continues to mark in-context repos

**What:** Verify the `*` marker on `sab git list` still flags repos linked to the active context after the new linking flow.
**Files:** `tests/git-list.test.ts` (assertion only; `src/commands/git/list.ts` should need no change)
**Done when:** A test links a repo via `runContextReposAdd` (or seeded `contexts.repos`) and asserts `sab git list` prints `*` next to that repo and a space next to unlinked ones (FR-10); `git/list.ts` is confirmed unchanged.
**Depends on:** Task 3
**Estimate:** 1
**Notes:** `git/list.ts:31` already implements the marking via `ctx.repos`. Its empty-scope message ("no repo scope set; all repos visible") now reads slightly inconsistently with briefing's opt-in default, but git list is an inventory tool and the spec does not ask to change it — leave as-is, or note for a follow-up.
**Done:** [ ]

---

### Task 7: Update and extend tests for the empty-scope behaviour change

**What:** Fix existing tests that assumed "empty scope shows all repos" and add coverage for the new command surface and opt-in default.
**Files:** `tests/layer6-briefing.test.ts`, `tests/layer3-contexts.test.ts`
**Done when:**

- Briefing tests asserting that an unscoped context shows all repos are updated to expect zero repos + the "no repos linked" hint (FR-6/7), and `--all` is covered as showing all (FR-8).
- New context tests cover: add de-dupes and persists (FR-2), remove no-ops on absent names (FR-3), add rejects an unknown repo with the exact FR-4 message and writes nothing, list prints the empty message (FR-1), and all subcommands error on a nonexistent context (FR-9).
- The full test suite passes.
  **Depends on:** Task 3, Task 4
  **Estimate:** 3
  **Notes:** The flip in Task 4 will break any existing assertion that relied on the show-all default — grep the briefing test for Repo State expectations first.
  **Done:** [ ]

---

### 🚦 Gate C: End-to-end UX sign-off (manual)

**Type:** Manual UX review — no code, no story points.
**Reviewer:** human, on a realistic `repos_dir` that mirrors the motivating scenario (e.g. an app repo + its landing-page repo plus several unrelated repos).
**Verify by hand:**

- The original complaint is actually solved: before linking, an unrelated-repo-heavy briefing is no longer flooded; after `sab context repos add`, exactly the intended repos appear.
- The full opt-in flow feels natural end to end: discover (`sab git list`) → link (`sab context repos add`) → see them in `sab briefing` → unlink → they disappear.
- Switching `active_context` shows the correct per-context repo set with no leakage between contexts.
  **Pass criteria:** a user hitting the original problem would consider it fixed, and the workflow is discoverable without reading the spec.
  **On fail:** file follow-up tasks for the specific rough edges found.
  **Depends on:** Task 7.
  **Done:** [ ]

---

## Summary

- Total tasks: 7 (16 story points) + 3 manual review gates (unpointed)
- Total estimated effort: 16 story points of implementation; the gates add wall-clock review time, not points.
- Critical path: Tasks 1 → 2 → 3 → **Gate A** → 7 → **Gate C** (with Task 4 → Task 5 → **Gate B** a prerequisite branch feeding Task 7, runnable in parallel with 1–3)
- Manual gates:
    - **Gate A** (after Task 3) — CLI ergonomics; blocks the test tasks so assertions don't lock in awkward wording.
    - **Gate B** (after Task 5) — briefing output; the highest-UX-risk checkpoint, since the empty-scope flip changes existing behaviour.
    - **Gate C** (after Task 7) — end-to-end sign-off against the motivating scenario.
- Risks:
    - **Task 3** — Commander's bare-action-plus-subcommand pattern for `repos <slug>` is the main implementation unknown; have the `repos list <slug>` fallback ready.
    - **Task 4** — behaviour change to existing briefing output; underestimating the renderer/omit-guard coupling (not just the filter) is the likely trap, and it cascades into Task 7's test updates and Gate B.
    - **Task 5** — depends on whether `briefing` already parses `--all`; small but unverified.
