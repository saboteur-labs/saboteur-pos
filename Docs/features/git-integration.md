# Git Integration

A guide to the Phase 2a Local Git Core feature: how Saboteur reads your local repos, links commits to tasks, and surfaces git state in the briefing.

---

## Contents

1. [What it is](#what-it-is)
2. [Setup](#setup)
3. [Linking commits to tasks](#linking-commits-to-tasks)
4. [What you see](#what-you-see)
5. [Performance and timeouts](#performance-and-timeouts)
6. [Privacy](#privacy)
7. [What it does NOT do](#what-it-does-not-do)
8. [Troubleshooting](#troubleshooting)
9. [Reference](#reference)

---

## What it is

Saboteur's git integration teaches the briefing about the repos you already work in. With no extra effort beyond writing a task ID into a commit message, you get:

- The current branch and dirty/clean state of every tracked repo, every morning.
- A list of commits associated with each task, viewable via `sab task view`.
- A weekly report of what shipped, what stalled, and where you spent commit time.
- A nudge for branches you haven't touched in a while.

It runs **entirely locally** — no network calls, no remote fetches, no GitHub or GitLab access. Everything is derived from your working copy of each repo.

---

## Setup

### 1. Choose your repos directory

Saboteur looks at the **immediate subdirectories** of a single path called `repos_dir`. Each subdirectory that is a git repo gets scanned; everything else is ignored. Repos are not registered individually — they are discovered.

A typical layout:

```
~/work/repos/
├── varsentry/         ← git working tree, scanned
├── omoikane/          ← git working tree, scanned
├── archive.git/       ← bare repo, surfaced in skipped footer
└── notes/             ← not a git repo, silently ignored
```

Subdirectories are classified as:

| Kind | Detection | Behaviour |
|---|---|---|
| `working` | Has a valid `.git/` directory | Scanned in full |
| `bare` | Has `HEAD`, `objects/`, `refs/` at the top level | Listed in skipped footer, reason `bare` |
| `broken` | `.git` exists but doesn't look right | Listed in skipped footer, reason `read-error` |
| Anything else | No git markers | Silently ignored |

Recursive walking is intentionally not done — if your repos live under `~/code/work/varsentry` and `~/code/personal/sideproj`, point `repos_dir` at one of those folders or flatten the layout. Saboteur will not walk into `~/code` and find both.

### 2. Configure `repos_dir`

`repos_dir` defaults to `~/code`. Edit `~/saboteur/saboteur.config.json`:

```json
{
  "version": "1",
  "repos_dir": "~/work/repos",
  "active_context": "inbox",
  "briefing": {
    "stale_task_days": 3,
    "stale_branch_days": 14,
    "provider_timeout_ms": 2000
  }
}
```

Paths starting with `~/` are expanded to your home directory. Absolute paths work too. There is no CLI helper for this — edit the JSON directly.

Verify it's seen:

```bash
sab briefing
```

If everything is set up, you'll see a `── Repo State ──` section near the bottom of the briefing.

For a quick standalone check, use:

```bash
sab git list
```

It prints every working repo Saboteur finds under `repos_dir` with its current branch (or `detached @ <sha>`), marks repos scoped to the active context with a `*`, and lists bare/broken repos in a Skipped section. This is the fastest way to confirm `repos_dir` points at the right place.

### 3. Tune the stale-branch threshold

`briefing.stale_branch_days` controls when a branch shows up in the **Stale Branches** subsection. Default is 14 days. Lower it if you want to be reminded sooner; raise it if you keep many long-lived branches around.

```json
"briefing": { "stale_branch_days": 30 }
```

### 4. Scope repos to a context (optional)

By default, every working repo under `repos_dir` shows up for every context's briefing. If you want a context to only show a subset of repos, set its `repos` array:

```sql
UPDATE contexts SET repos = '["varsentry", "omoikane"]' WHERE id = 'work';
```

Repo names match the **basename** of the directory under `repos_dir` (e.g. `varsentry`, not the absolute path). An empty array — the default — means "show all working repos."

There is no CLI command for this yet; edit the database directly with the `sqlite3` CLI or any DB tool.

---

## Linking commits to tasks

### The canonical form

Saboteur recognises one and only one form of task reference inside a commit message:

```
fix login redirect [task_a1b2c3d4]
```

- Literal square brackets `[` and `]`.
- The prefix `task_`.
- Exactly **8 lowercase hex characters** — this matches the full ID produced by `sab task add`.

That's it. Any position in the message works: subject line, body, even mid-sentence. The match is global, so multiple IDs in one message are all extracted.

### What does NOT match

These forms are intentionally rejected, even though they reference a valid task:

| Form | Why it's rejected |
|---|---|
| `task_a1b2c3d4` (no brackets) | Ambiguous in prose — too many false positives |
| `fix(task_a1b2c3d4):` | Couples the convention to conventional-commits style |
| `Task: task_a1b2c3d4` (git trailer) | Invisible in `git log --oneline`; users rarely write trailers by hand |
| `[task_a1b2]` (short prefix) | Ambiguity grows as task count grows; commits live forever |
| `[TASK_A1B2C3D4]` (uppercase) | IDs are always lowercase hex |
| `[task_a1b2c3d4e5]` (wrong length) | Must be exactly 8 hex chars |
| `[task_zzzzzzzz]` (non-hex) | Outside the hex alphabet |

Pick the canonical form and move on. The rejection list exists so that *only* deliberate references count — pasting a task ID into a commit body as discussion text won't accidentally link the commit.

### Getting the right ID into the message

The ID is printed every time you create or view a task:

```bash
$ sab task add "Fix login redirect"
Created task task_a1b2c3d4: "Fix login redirect"
```

Copy the bracketed form into your commit:

```bash
git commit -m "fix login redirect [task_a1b2c3d4]"
```

A common workflow:

```bash
$ sab task add "Refactor session cache" --priority high
Created task task_b7e91f00: "Refactor session cache"
# do the work, then:
$ git commit -m "extract session cache module [task_b7e91f00]"
```

### One commit, one task

If a commit message references multiple tasks, only the **first** one that resolves to an existing task gets linked. The commits table uses the sha as the primary key, so each commit row points at exactly one task. Unknown task IDs in the same message are silently dropped.

If you need a commit to "belong to" two tasks, link the tasks to each other instead (`sab task link <a> --blocks <b>`) and reference only one in the commit.

### What happens during indexing

Indexing runs **automatically** at the start of every `sab briefing` (daily or weekly). For each repo under `repos_dir`:

1. Enumerate local branches via `git for-each-ref refs/heads/`.
2. For each branch, read commits whose author timestamp falls within the indexing horizon (60 days by default).
3. Extract bracketed task IDs from each message.
4. For the **first** ID that matches a task in your DB, write a row in the `commits` table: `(sha, repo, branch, task_id, message, author_ts)`.
5. For each task that gained a new commit, update the task's `repo` and `branch` fields to match its newest linked commit.

Re-running the indexer is idempotent: existing rows are overwritten in place by `sha`, so the table never accumulates duplicates. Tasks that already have the correct `repo`/`branch` aren't re-written.

Commits older than the horizon (60 days) are not indexed. If you reference a task in a commit that's more than 60 days old, it won't appear under that task unless you bring it into the window (e.g., a rebase that brings forward the author date).

---

## What you see

### Daily briefing

`sab briefing` adds a section near the bottom:

```
── Repo State ────────────────────────────────
  varsentry  (main)  ✓ clean
    7a2b1f3  fix login redirect [task_a1b2c3d4]  2026-05-15  → Fix login redirect
    9c44e8a  add session refresh [task_b7e91f00]  2026-05-14  → Refactor session cache

  omoikane  (feat/auth)  ✘ dirty

  Stale Branches
    varsentry/feat/old-auth  (32d since last commit)

  Skipped 1 repo: archive.git (bare)
```

Each working repo gets a header line with branch and dirty flag, plus up to 5 of its most recent commits linked to tasks in the active context.

For detached HEADs:

```
  varsentry  (detached @ 7a2b1f3)  ✓ clean
```

### `sab task view`

Tasks with linked commits gain a "Recent commits" section under the state history:

```
$ sab task view task_a1b2c3d4
task_a1b2c3d4 — Fix login redirect
────────────────────────────────────────
State:    done (2 days)
...

State history:
  backlog    → 2026-05-12 09:14
  active     → 2026-05-13 10:02
  review     → 2026-05-15 14:33
  done       → 2026-05-15 16:01

Recent commits:
  9c44e8a  fix login redirect [task_a1b2c3d4]  2026-05-15
  7a2b1f3  add login telemetry [task_a1b2c3d4]  2026-05-14
```

### Weekly briefing

```bash
sab briefing --weekly
```

Renders a 7-day report scoped to the active context:

```
── Weekly Briefing — work (last 7 days) ─────────

Shipped
  task_a1b2c3d4  Fix login redirect
  task_b7e91f00  Refactor session cache

Stalled
  task_4f88a3e1  Unify error pages  (active, 12d idle)

Repo Activity
  varsentry             8 commits
  omoikane              3 commits
  saboteur-pos          1 commit
```

- **Shipped** — tasks whose `state_history` contains a `done` transition inside the window.
- **Stalled** — tasks in `active` or `blocked` whose most recent state transition is **older** than 7 days.
- **Repo Activity** — commit counts per repo across the window, regardless of context.

### Skipped footer

If any repo can't be read — bare, broken `.git`, or git timed out — it appears in a single footer line:

```
Skipped 3 repos: archive.git (bare), legacy (read-error), monorepo (timeout)
```

Reasons:
- `bare` — the directory is a bare git repo, which has no working tree to render.
- `read-error` — git refused or the layout is malformed.
- `timeout` — a git invocation exceeded the per-repo time budget (see below).

---

## Performance and timeouts

Each repo gets a wall-clock budget of **500ms** per git operation during indexing and during repo-state collection in the briefing. Any individual `git` call that exceeds it is killed; the repo is marked `timeout` in the skipped footer and the rest of the briefing continues.

The overall design target is < 2 seconds total for ~25 repos on a developer laptop. If you sit well above that, suspect:

- A monorepo with hundreds of thousands of commits in the 60-day window.
- A network-mounted `repos_dir` (NFS, SSHFS) — git ops are dramatically slower.
- A repo with a corrupted index that's making `git status` hang.

You can verify by running the same commands the briefing runs:

```bash
git -C ~/work/repos/<slow-repo> log --since="60 days ago" --format=%H | wc -l
git -C ~/work/repos/<slow-repo> status --porcelain
```

---

## Privacy

- No outbound network traffic is initiated by git integration. Every git call is local.
- Commit messages, branch names, repo paths, and shas are read from disk and stored in the local SQLite database.
- The `commits` table lives in `saboteur.db` alongside your tasks. It is **not** synced anywhere by Saboteur.

If you copy `saboteur.db` to another machine, the indexed `commits` rows travel with it, but they reference repo names (basenames) only — not absolute paths — so the index remains meaningful even if you reorganise `repos_dir`.

---

## What it does NOT do

The feature is deliberately narrow. These are out of scope:

- **No network anything.** No `git fetch`, no remote tracking, no PR data, no CI status, no GitHub/GitLab/Bitbucket integration. That's Phase 3 (Remote Plugins).
- **No git writes.** Saboteur never commits, fetches, pushes, branches, merges, or rewrites history on your behalf.
- **No recursive scanning.** Only the immediate children of `repos_dir` are inspected. Repos buried two levels deep are invisible.
- **No auto-discovery outside `repos_dir`.** Saboteur won't crawl `~`, `/Users`, or anywhere else looking for repos.
- **No retroactive deep history.** The indexing horizon is 60 days. Commits older than that are not surfaced even if their messages reference a task.
- **No multi-task linking per commit.** The commits table is keyed by sha; a commit links to exactly one task (the first known bracketed ID in the message). If you need a many-to-many relationship, you'll need a join table — not provided.
- **No fuzzy / partial ID matching.** `[task_a1b2]` does not match `task_a1b2c3d4`, even if the prefix is unique.
- **No support for non-canonical conventions.** Conventional-commit scopes, git trailers, JIRA-style keys, and bare IDs are all ignored.
- **No commit template installer.** Saboteur doesn't write to `.gitmessage` or hook itself into your `commit-msg` hook. You can do that yourself; the spec is just `[task_xxxxxxxx]`.
- **No commit message validation on `git commit`.** Saboteur is not in your commit path; if you typo a task ID, you'll find out at the next briefing when the commit doesn't appear under the task.
- **No automatic deletion of orphaned commit rows.** If you delete a task that has linked commits, the FK constraint will block the delete. Drop the commits first or use the task delete flags as documented elsewhere.
- **No submodule traversal.** Submodules and worktrees inside a repo aren't followed.
- **No bare-repo support.** Bare repos appear in the skipped footer because they have no working tree to report on.
- **No file-system watching.** Indexing runs synchronously at the start of every `sab briefing`. There is no daemon and no event-driven refresh.
- **No write UI.** This is Phase 2a (CLI only). Repo state is read-only.

---

## Troubleshooting

**The Repo State section doesn't appear.**

Either `repos_dir` doesn't exist, has no immediate subdirectories that are git repos, or your active context has `contexts.repos` set to names that don't match the discovered repos. Run:

```bash
sab git list
```

The preamble line tells you which mode you're in:

- "No repos found …" — `repos_dir` is wrong or empty.
- "no repo scope set; all repos visible" — `contexts.repos` is empty (default); every working repo will appear in the briefing.
- "* = in context" but no rows are marked — `contexts.repos` contains names that don't match the actual repo directories. Fix the names or clear the array.

**My commit is in the repo but doesn't show up under the task.**

Walk through the checklist:

1. Is the commit's author date within 60 days of now? Older commits aren't indexed.
2. Is the commit reachable from a local branch? `git log --branches` will tell you.
3. Does the message contain `[task_<8 hex>]` in exact form? `git log --grep='\[task_'`.
4. Does the task actually exist? `sab task view <id>` should not error.
5. Run `sab briefing` once — indexing is synchronous and lazy; nothing happens until a briefing runs.

**The same commit shows up under one task but not the other I expected.**

Only the first known task ID in a commit message is indexed. Pick one as the canonical owner.

**Indexing seems slow.**

A repo is probably timing out. Check the skipped footer for entries with reason `timeout`. Common causes: monorepo on slow disk, network-mounted repos, corrupted index.

**A branch I deleted is still listed as stale.**

Saboteur reads branches from `git for-each-ref refs/heads/`. If `git branch` shows it gone, run `sab briefing` again — the next render reads fresh state, it isn't cached beyond the single invocation.

---

## Reference

### Config fields

| Field | Default | Purpose |
|---|---|---|
| `repos_dir` | `~/code` | Directory whose immediate subdirectories are scanned for git repos |
| `briefing.stale_branch_days` | `14` | A branch with no commits within this window appears in Stale Branches |

### Schema

The `commits` table (defined in `Docs/CoreSpec/Docs/SCHEMA.md`):

```sql
CREATE TABLE commits (
  sha       TEXT PRIMARY KEY,
  repo      TEXT NOT NULL,
  branch    TEXT,
  task_id   TEXT REFERENCES tasks(id),
  message   TEXT NOT NULL,
  author_ts TEXT NOT NULL
);
```

`repo` is the basename of the repo under `repos_dir`, not an absolute path. The table is a **derived cache** — re-running indexing always produces the same rows for the same git state.

The Phase 1 stubs `tasks.repo` and `tasks.branch` are also wired by this feature: when a commit lands under a task, those columns are updated to reflect the commit's repo and branch.

### Indexing horizon

The default horizon is 60 days, set in `src/git/index-job.ts` as `DEFAULT_HORIZON_DAYS`. Not currently exposed via config — open an issue if you need a different window.

### Per-repo timeout

The default per-repo git call timeout is 500ms, set in `src/git/index-job.ts` as `DEFAULT_PER_REPO_TIMEOUT_MS` and in `src/commands/briefing.ts` as `BRIEFING_GIT_TIMEOUT_MS`. Not currently configurable.

### Related spec documents

- `Docs/feature-specs/local-git-core/local-git-core-spec.md` — the feature specification.
- `Docs/feature-specs/local-git-core/tasks.md` — the implementation task breakdown.
- `Docs/CoreSpec/Docs/PHASES.md` — Phase 2a definition and done signal.
- `Docs/CoreSpec/Docs/SCHEMA.md` — canonical schema reference.
