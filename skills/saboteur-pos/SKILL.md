---
name: saboteur-pos
description: >-
  Drive Saboteur POS (the `sab` CLI) for personal tasks, notes, and a daily
  briefing. Five capabilities are actively guided: (1) putting you in the RIGHT
  context — every `sab` action is context-scoped, so it maps the current git
  repository to its Saboteur context and switches to it; (2) running the daily
  briefing as an action hub — it scopes the briefing to the right context (or
  `--all` across every repo), reads the report, and offers the natural follow-ups
  it surfaces (stale tasks, blocked work, in-review work, unlinked commits, "what
  should I work on"); (3) linking git commits to tasks — before a commit it
  checks the task list and, with the user's OK, embeds the matching task ID in the
  message; and (4) capturing notes — when the user says "take a note" (capture it
  verbatim and confirm it back before saving) or "make a note" (draft it and show
  them first), AND proactively offering to note bugs, landmines, follow-up work,
  decisions, or insights that surface while working, linking a note to a task
  when it's relevant; and (5) managing tasks — creating them in the right
  context with sensible priority/energy, listing the view that answers the
  question asked, moving them through the state machine (it knows the legal
  transitions, e.g. that a task must pass through review before it can be done),
  and recording blocking dependencies, always offering before a state change
  rather than acting silently. Use this skill whenever you start working in a
  repository, are about to commit, want a briefing or to know what to work on,
  want to jot/save/capture/record a note, thought, or insight, want to add or
  create a task, move a task or mark it done/blocked/in review, see your backlog
  or what's active/blocked/stale, record a dependency between tasks, or whenever
  the user mentions sab, saboteur, their tasks, notes, briefing, backlog,
  standup, or "what should I work on" — even if they don't
  name the tool. This is the local Saboteur `sab` CLI — not Jira, Trello,
  Obsidian, or a repo's GitHub issues; don't engage for those. Also invoke it
  directly to switch or check context.
---

# Saboteur POS

Saboteur POS is a local CLI (`sab`) for tasks, notes, and a daily briefing.
Everything in it is **scoped to an active context** — `sab task list`,
`sab task add`, notes, briefing all read and write through whatever context is
currently active. So the single most important thing before doing any `sab`
work is being in the context that matches what the user is actually working on.

Repositories don't map cleanly to context names (e.g. the `getwrite` repo
belongs to the `getwrite-development` context), and some repo folder names even
collide across directories. So this skill keeps an explicit map and resolves it
deterministically with a script.

## Current scope

Five capabilities, all built on the same foundation — knowing which context the
current repo belongs to:

1. **Resolve the current repository to its context and switch to it** (below).
   Every other `sab` action depends on this running first.
2. **Run the daily briefing as an action hub** — scope it correctly, read the
   report *with* the user, and offer the follow-ups it surfaces (stale/blocked/
   in-review tasks, unlinked commits) by routing into the capabilities below
   ([Running the briefing](#running-the-briefing)).
3. **Link git commits to tasks** — when you're about to commit work, check
   whether it advances a tracked task and, with the user's OK, record the link
   in the commit message ([Linking commits to tasks](#linking-commits-to-tasks)).
4. **Capture notes** — write down what the user dictates, draft notes they ask
   you to compose, and proactively offer to note things worth keeping that
   surface while working ([Capturing notes](#capturing-notes)).
5. **Manage tasks** — create them in the right context, list the view that
   answers the question, move them through the state machine, and record
   blocking dependencies ([Managing tasks](#managing-tasks)).

### Not yet wired into this skill

The `sab` CLI does more than the five workflows above. The parts this skill does
**not** yet give a guided workflow for are: **retrieving** notes
(`sab note list` / `view` / `find --tag` / `edit` — capture is covered, search
and reading back aren't), **context administration** (`sab context new` /
`delete` / `repos`), and the read-only **dashboard** (`sab ui`), plus `sab sync`
and `sab git`. Don't quietly improvise a polished workflow for those or imply
it's a finished skill feature. When the user asks for one, be honest and helpful
in the same breath:

1. Say plainly that this part isn't wired into the skill yet (the skill covers
   context resolution, the briefing, commit-linking, note capture, and task
   management).
2. Because the underlying CLI already works, offer to run the relevant `sab`
   command directly — e.g. `sab note list --context "$SLUG"`,
   `sab context new "<slug>"` — and run it if they say yes. Pass the resolved
   `--context "$SLUG"` on context-scoped reads (see
   [Pass `--context <slug>` explicitly](#pass---context-slug-explicitly--dont-trust-the-global));
   omit it only for an unmapped repo, where the active context is the fallback.

(Resolving context first still applies, since these commands are context-scoped.)
These helpers will land as later increments and will assume context is already
resolved.

## How to use it

The logic lives in `scripts/resolve_context.py`. Always go through the script
rather than calling `sab context use` yourself — the script computes the repo's
stable identity (normalized git remote, falling back to repo path) and looks it
up in the map, which is what makes this work across repos with colliding names.

**At the start of working in a repo, or when asked to switch/check context:**

```bash
python3 "$CLAUDE_SKILL_DIR/scripts/resolve_context.py"
```

(`$CLAUDE_SKILL_DIR` is this skill's directory. If it isn't set, use the path
to this SKILL.md's folder.)

- **Mapped repo** → it runs `sab context use <slug>`, then prints the active
  context via `sab context show`. Report the context to the user briefly.
- **Unmapped repo** → it changes nothing, prints the active context unchanged,
  and lists available context slugs. Offer to add a mapping (below). Don't
  switch context behind the user's back.

## Adding a mapping

When the current repo is unmapped, pick the right context slug (the script
prints the available ones; `sab context list` shows them with task/note counts)
and record it:

```bash
python3 "$CLAUDE_SKILL_DIR/scripts/resolve_context.py" add <slug>
```

This writes the repo's identity → slug into `context-map.json` and then resolves
immediately. Confirm the chosen slug with the user before adding if it's at all
ambiguous — the mapping persists.

## Inspecting

```bash
python3 "$CLAUDE_SKILL_DIR/scripts/resolve_context.py" key    # how this repo is identified
python3 "$CLAUDE_SKILL_DIR/scripts/resolve_context.py" list   # all current mappings
```

## The map

`context-map.json` holds `{ "version": 1, "mappings": { "<repo-key>": "<slug>" } }`.
A repo-key is a normalized remote like `github.com/saboteur-works/getwrite`, or
an absolute path for repos without a remote. Edit by hand if needed, but `add`
is the safe path (it validates the slug against existing contexts).

### Monorepo sub-contexts

A mapping value is normally a bare slug string — the whole repo resolves to one
context. For a **monorepo** that holds several operating contexts in one git
repo, the value may instead be an object that resolves by sub-path:

```json
{
  "github.com/acme/platform": {
    "default": "platform-misc",
    "paths": [
      { "glob": "apps/web/**", "context": "platform-web" },
      { "glob": "apps/api/**", "context": "platform-api" },
      { "glob": "infra/**",    "context": "platform-infra" }
    ]
  }
}
```

The resolver matches the current directory's path *relative to the repo root*
against each `glob` **in order — first match wins** (so list specific rules
before broad ones), falling back to `default` (or unmapped if there's no
`default`). So `cd`-ing into `apps/web` resolves to `platform-web`, while the
repo root falls to `platform-misc`. Globs support `*` (within a path segment),
`**` (spans segments), and `?`. Add a path rule with:

```bash
python3 "$CLAUDE_SKILL_DIR/scripts/resolve_context.py" add <slug> --path "<glob>"
```

which lifts a bare-string mapping into object form and bumps the file to
`version: 2`. Bare-string mappings keep working unchanged.

This map governs **interactive** resolution (which context `cd`-ing into a
subtree switches to). The CLI now also attributes *commits* to sub-contexts on
its own side: declare the same sub-areas on the context with
`sab context repos add <ctx> <repo> --path "<glob>"`, and the briefing surfaces
commits that touched that subtree under the matching context — even unlinked
ones (shown without the `→ task` arrow). The two declarations are independent
today (skill map vs. `contexts.repos`); keep them in sync for a monorepo.

## Pass `--context <slug>` explicitly — don't trust the global

The active context is a **single global value** in `saboteur.config.json`, shared
by every `sab` process on the machine. The resolver sets it as a sane default,
but anything can move it out from under you between commands — a second Claude
session working a different repo, a stray `sab` in another terminal, a scheduled
job. If you depend on the persisted active context, a concurrent session can
silently redirect your reads and writes into the wrong context. That's exactly
the failure this skill exists to prevent (a commit linked under the wrong
context, a note misfiled), just harder to notice because nothing errors.

So for a **mapped** repo, capture the slug once and pass it on every scoped
command rather than relying on the switch persisting:

```bash
SLUG=$(python3 "$CLAUDE_SKILL_DIR/scripts/resolve_context.py" slug)
```

`slug` prints just the context slug for the current repo and exits 0. If the repo
is **unmapped** it prints nothing and exits non-zero — there's no slug to pass,
so fall back to the active context (notes already handle this; see
[Capturing notes](#capturing-notes)) and offer to add a mapping.

Then thread `--context "$SLUG"` through every context-scoped call:

```bash
sab task list --context "$SLUG"
sab task add "<title>" --context "$SLUG"
sab note new "<title>" --body "<text>" --context "$SLUG"
sab briefing --context "$SLUG"
```

This makes each operation correct no matter what another session did to the
global. Commands that act on a task **by ID** — `sab task view <id>`,
`sab task move/done/block <id>` — are unambiguous and take no `--context`; that's
fine, leave it off.

## Running the briefing

The briefing is the front door of the whole system — it's where the user finds
out what's moving, what's stuck, and what to pick up next. `sab briefing` is
**read-only and must stay that way**: it never modifies data, and neither does
running it. Its value is the at-a-glance picture, so most of the time the right
move is simply to run it correctly-scoped and let the user read it.

What makes the briefing worth a guided workflow rather than a bare command is
what it *surfaces*: a stale task, a commit that advanced nothing tracked, a
branch untouched for weeks. Each of those is a doorway into a capability this
skill already has — note capture, commit-linking, a task move. So treat the
briefing as a **hub**: present it, then offer the one or two follow-ups it
obviously calls for. The instinct to aim for is a chief-of-staff who hands you
the brief and flags the thing that's on fire — not one who makes you adjudicate
every line.

### Step 1 — scope it right

The briefing has two scopes, and picking the wrong one gives the user a
misleading picture:

- **Scoped to a context** (`sab briefing --context "$SLUG"`) — the default when
  the user is working in a repo or asks something repo-flavored ("what should I
  work on here," "where am I on this"). Resolve context first (run the resolver
  if you haven't this session), then pass the resolved `--context "$SLUG"` so the
  briefing reflects *this* repo's work regardless of what another session did to
  the shared global (see
  [Pass `--context <slug>` explicitly](#pass---context-slug-explicitly--dont-trust-the-global)).
  For an **unmapped** repo there's no slug — run plain `sab briefing` against the
  active context and say which context that was.

- **Across everything** (`sab briefing --all`) — the right call for a true
  morning/standup view: "what's going on everywhere," "give me the briefing,"
  "catch me up." This ignores context scope and walks every repo, so reach for it
  when the user wants the whole board rather than one lane.

There's also `sab briefing --weekly` (a 7-day shipped/stalled/repo-activity
report) — use it for "how did this week go," "what shipped this week," a weekly
review. One sharp edge: the weekly briefing is **single-context** — it reports
only one context, and `--weekly --all` silently ignores `--all` rather than
spanning everything. So for a weekly review across the board, don't trust a lone
`--weekly --all`; run `sab briefing --weekly --context <slug>` once per context
that actually holds work (the contexts with active tasks/recent commits — a quick
`sab context list` shows which) and stitch the picture together.

### Step 2 — read it back, don't just dump it

The raw output is several sections of dense text. Don't paste it and stop, and
don't ceremonially narrate all seven sections either. Read it and tell the user
what actually matters right now: what's active, the one or two things that need
attention, and — if they asked "what should I work on" — a concrete pick from
Active Tasks (factoring priority/energy), not a restatement of the list.

If the briefing prints **warnings** (e.g. repos skipped for a basename
collision, like two `prosepad` folders), those mean real repos are invisible to
Saboteur — worth surfacing once so the user can rename/disambiguate, but say it
in a line and don't repeat it every run.

### Step 3 — offer the follow-ups it surfaces

This is the hub part. After reading the briefing, the sections below each point
at an action already in this skill. Offer the ones that clearly apply, the same
calibrated way notes work — a light line, the user's call, never an action taken
silently or a march through every item:

- **Stale Tasks** (Section 4 — tasks that have sat untouched) are the strongest
  signal. A stale task is usually either done-but-not-marked, genuinely blocked,
  or something to consciously drop. Offer to move it (`done`/`block`/back to
  `backlog`) or to capture a note on *why* it stalled. Don't force a verdict —
  surfacing it is most of the value.
- **Blocked Tasks** — ask whether the blocker still holds; if it's cleared, offer
  to move the task out of `blocked`.
- **In Review** — if review's done, offer to mark it `done`.
- **Repo State commits** — the briefing shows recent commits with the task they
  linked to (a `→ task-name` arrow). A commit with no arrow that clearly advanced
  tracked work is a missed link; point it out and offer to handle it next commit
  (see [Linking commits to tasks](#linking-commits-to-tasks)). Note that on a
  *past* commit the link can't be added retroactively here — so this is mostly a
  heads-up plus a reminder for the next one.
- **Stale Branches** — a branch untouched for weeks is a decision waiting to
  happen (resume? abandon? merge?). Worth offering a note capturing the call.
- **Inbox** — unsorted tasks/notes; if the count is climbing, offer to help
  triage. Don't make this a chore every single briefing.

When you point at a task in any of these offers, name it by its **exact full ID**
from the briefing (`task_xxxxxxxx`), not just its title — the user's yes turns
straight into a move, and a by-name reference forces a second round-trip to
figure out which task you meant. Moves then act on a task **by ID**, so they take
no `--context` — `sab task move <id> <state>`, `sab task done <id>`,
`sab task block <id>` are unambiguous (see
[Pass `--context <slug>` explicitly](#pass---context-slug-explicitly--dont-trust-the-global)).
The full mechanics of those moves — including which transitions are legal — live
in [Managing tasks](#managing-tasks); the briefing is just one place they get
offered.

## Managing tasks

The task list is the spine of the system: it's what the briefing reads, what
commits link to, and what the user means by "what should I work on." This skill
drives the whole task lifecycle — create, list, move, depend, edit, delete —
through the `sab task` verbs. Two facts make this more than typing raw commands,
and most mistakes trace back to one of them:

- **The context split.** `sab task add` and `sab task list` are context-scoped,
  so they take `--context "$SLUG"` (resolve context first; see
  [Pass `--context <slug>` explicitly](#pass---context-slug-explicitly--dont-trust-the-global)).
  Everything that acts on a task **by ID** — `view`, `move`, `done`, `block`,
  `edit`, `link`, `delete` — is unambiguous and takes **no** `--context`. Mixing
  this up either misfiles a new task or makes a by-ID command look like it needs
  scoping when it doesn't.
- **The state machine is real and rejects illegal moves** (see
  [Moving tasks through states](#moving-tasks-through-states)). Proposing a move
  the machine forbids — most commonly marking an `active` task `done` — gets a
  hard error, so know the legal transitions *before* you offer one.

A standing rule for everything in this section: **state changes are the user's
call.** Creating a task they asked for is a direct action, but moving, blocking,
editing, deleting, or linking a task changes the record the user steers by — so
offer and act on a yes, don't do it silently. Always name a task by its **exact
full ID** (`task_xxxxxxxx`) from the list, never just its title: the user's yes
turns straight into the command, and a by-name reference forces a second
round-trip to figure out which task you meant.

### Creating tasks

```bash
sab task add "<concise title>" --context "$SLUG" --priority high --energy deep
```

New tasks land in `backlog`. The title becomes how the task reads everywhere, so
keep it short and specific (a few words, kebab-ish), not a whole sentence —
derive it from what the user said rather than pasting their sentence in. `add`
is non-interactive; never open `$EDITOR` for it.

The optional metadata isn't bookkeeping for its own sake — it's **what makes a
task findable later**, because the views and the briefing sort and filter on it:

- `--priority critical | high | normal | low` (defaults to `normal`) — drives
  ordering in the `today` view and the briefing.
- `--energy deep | shallow | admin` — `deep` is what lands a task in the
  `deep-work` view; without it the task can't surface there.
- `--effort xs | s | m | l | xl` — sizing, for the user's own triage.

Set the ones the user's words clearly imply ("fiddly, needs real focus" →
`--energy deep`; "quick cleanup" → `--energy admin`; "this is the priority" →
`--priority high`). Don't interrogate the user to fill every field — a task with
just a good title is fine, and they can refine later.

### Listing tasks — pick the view that answers the question

`sab task list --context "$SLUG"` shows the context's open tasks. The **view** is
how you answer a specific question instead of dumping everything — match it to
what the user actually asked:

| Question the user is asking | View |
| --- | --- |
| "what should I do now / today" | `--view today` (active, sorted by priority then energy) |
| "what's a good deep-focus task" | `--view deep-work` (active **and** `energy=deep` **and** unblocked) |
| "what's in flight" | `--view active` |
| "what's waiting / not started" | `--view backlog` |
| "what's stuck" | `--view blocked` |
| "what's waiting on review" | `--view review` |
| "what's gone stale" | `--view stale` (active, untouched past the staleness threshold — the same set as briefing Section 4) |

`--all` lists across every context (see the scoping note above). With no `--view`
you get the context's open tasks, newest-touched first. As with the briefing,
read the result back — surface the one or two that matter and, when asked what to
work on, make a concrete pick rather than restating the list.

### Moving tasks through states

A task moves with `sab task move <id> <state>`, with two shorthands:
`sab task done <id>` (→ `done`) and `sab task block <id>` (→ `blocked`). All act
by ID, so **no `--context`**. The legal transitions:

```
backlog  →  active, blocked
active   →  review, backlog, blocked          (NOT directly to done)
blocked  →  active                            (re-pick up where it was)
review   →  done, active, blocked
done     →  (terminal — nothing moves out of done)
```

The one that bites: **a task can't go straight from `active` to `done`.** It has
to pass through `review` first (`active → review → done`). So when the user says
"mark X done" and X is `active`, don't fire `sab task done` and eat the error —
say it needs to go through review and offer the two-step
(`sab task move <id> review`, then `sab task done <id>`) — but offer the move to
`review` on its own too, and let the user pick. `review` exists for a reason, and
"I just wrapped this up" often means *ready for a once-over*, not *close it
now*; defaulting to a forced two-step `done` skips the very beat the state is
there to provide. `blocked` is reachable from any non-done
state via `sab task block`. Moving a task to `done` **auto-unblocks** its
dependents (any task whose only remaining blocker was this one flips from
`blocked` back to `active`) — worth mentioning when it'll happen, since the user
may not expect another task to wake up.

### Recording dependencies

When one task can't proceed until another finishes, record it:

```bash
sab task link <blocker_id> --blocks <dependent_id>
```

Direction is the whole game and easy to flip: `link A --blocks B` means **A
blocks B** — A must finish first. So "the table work can't start until the LaTeX
integration is done" is `link <latex_id> --blocks <table_id>` (LaTeX is the
blocker). State it back in plain words before running so the user can catch a
reversal — *"so LaTeX integration blocks the table work — recording that?"* Both
sides of the relationship are kept in sync automatically, and a link that would
form a **cycle** is rejected with an error, so don't try to force one. This is a
write, so offer first.

Don't confuse `link --blocks` with `sab task block` — they sound alike and the
trap is easy to fall into. `sab task block <id>` only moves a task into the
`blocked` *state* and records **no relationship** between tasks; `link <blocker>
--blocks <dependent>` is the one that creates the actual dependency. When the
user describes one task waiting on another, you want `link --blocks`.

### Editing and deleting

`sab task edit <id>` opens the task's fields in `$EDITOR` — and unlike notes,
there is **no** `--body`-style non-interactive edit for tasks. So: change a
task's **state** with `move`/`done`/`block` (non-interactive, what you'll reach
for most); changing **metadata** (title, priority, energy, effort) means
`sab task edit`, which needs an editor. If `$EDITOR` isn't set, relay the
standard message rather than guessing
(`"No $EDITOR set. Export EDITOR=<your editor> and try again."`).

`sab task delete <id>` removes a task permanently — it doesn't move to `done`,
it's gone. Treat it as irreversible: confirm before running even if the user
sounded sure. If the task has dependency links, delete refuses unless you add
`--force` (which also tears down those links); surface that rather than reflexively
forcing, since the guard is usually catching something real.

## Linking commits to tasks

Saboteur links a commit to a task by **putting the task's full ID in square
brackets in the commit message** — e.g.
`fix(login): correct redirect [task_a1b2c3d4]`. That bracketed token *is* the
link: there's no separate command, and the next `sab briefing` indexes the
commit, surfaces it under `sab task view <id>`, and updates the task's
repo/branch automatically. So "linking a commit" just means writing the right
text into the commit message — nothing else to run afterward.

This matters because the task list is how the user keeps an eye on what's
actually moving. A commit that quietly advances a tracked task without the link
leaves that task looking stale. So whenever you're about to commit work, pause
before finalizing the message and check whether this commit belongs to a task.

**Step 1 — be in the right context.** If you haven't resolved context this
session, run the resolver (above) first, so `sab task list` is scoped to the
work at hand rather than some unrelated context.

**Step 2 — read the task list, scoped to this repo's context.**

```bash
sab task list --context "$SLUG"
```

(Pass the resolved `--context "$SLUG"` so the list reflects *this* repo's work
even if another session has moved the global active context — see
[Pass `--context <slug>` explicitly](#pass---context-slug-explicitly--dont-trust-the-global).
For an unmapped repo there's no slug; use plain `sab task list` against the
active context.)

**Step 3 — act on what you see. There are exactly three cases:**

- **A task clearly matches the work** — the diff is plainly an increment of
  something on the list. Name it and ask before linking, e.g. *"This looks like
  it advances `task_4bf73ace` finish-getwrite-v1 — want me to link this commit
  to it?"* Link only if the user confirms; they may be committing something
  tangential to what they consider that task, and the call is theirs.

- **Tasks exist but none clearly matches** — don't force a guess into a link.
  Surface the doubt: point at the closest one or two and ask whether any of them
  (or some other task) actually covers this work. If the user picks one, link
  it; if they say none, commit with no link.

- **The task list is empty** — say so plainly (e.g. *"No tasks in this context,
  so there's nothing to link this commit to."*) and just commit normally. Don't
  invent a task, switch contexts hunting for one, or take any other sab action.

**Linking = editing the message, not running a command.** Once the user
confirms a task, copy its **exact full ID** from `sab task list` and put it in
square brackets in the commit message, in the canonical `[task_xxxxxxxx]` form.
The indexer deliberately ignores bare IDs, conventional-commit scopes, and
trailers — the square brackets are what make the link real, so don't drop them
or abbreviate the ID.

**Example**

User confirms this commit advances `task_4bf73ace`:

```
feat(editor): wire up table insertion toolbar [task_4bf73ace]
```

## Capturing notes

Notes are how the user keeps the things that don't fit on the task list —
decisions, gotchas, stray insights. Write one non-interactively with `--body` —
you're composing or relaying the text, so there's no reason to open `$EDITOR`:

```bash
sab note new "<concise title>" --body "<body text>" --context "$SLUG"
```

For a **mapped** repo, pass the resolved `--context "$SLUG"` so the note is filed
into this repo's context regardless of the shared global (see
[Pass `--context <slug>` explicitly](#pass---context-slug-explicitly--dont-trust-the-global)).
For an **unmapped** repo there's no slug — omit `--context` and let it land in the
active context, exactly as described below.

The `.md` file is the source of truth and the title becomes its filename slug,
so keep titles short and specific (a few words), not a whole sentence.

**A note belongs to a context, but don't let context become a roadblock to
capturing one.** The whole value of a note is that it's cheap to jot down before
the thought evaporates; an unfiled thought is the real loss, and a note in a
slightly-off context that you *told* the user about is trivially moved later. So
unlike committing — where being in the wrong context silently breaks the link —
a note just needs a home, and the active context is a fine default:

- If you've resolved context already this session (the resolver switches a
  *mapped* repo to its context), the active context is right — just use it.
- If the repo is **unmapped**, don't stop to negotiate. File the note into the
  **currently active context**, then say in one line where it landed and offer to
  move or map it — e.g. *"Saved to `getwrite-development` (this repo isn't mapped
  to a context yet — want it somewhere else, or should I map the repo?)."* Let the
  user redirect if they care; don't make them answer before the note exists.

The one time to ask first is when the active context is *clearly* wrong for the
note's subject and getting it right matters to the user — then a quick "this
looks like X work; file it under `<slug>` instead of the active `<active>`?" is
worth it. Short of that, capture first, report context second.

Three ways a note gets created. The line between the first two is just: **did
the user hand you the words, or are you composing them?**

### 1. Verbatim — the user dictates

Triggers: *"take a note,"* *"jot this down,"* *"note that …,"* *"write down: …"*
— anywhere the user supplies the actual content.

The words are theirs, so capture them as given. Don't rephrase, summarize, or
"tidy up" the body — a verbatim note that you've reworded is no longer the thing
they wanted saved. Derive a short title, then **show the note back — the title
and the exact body you're about to save — and get a quick confirm before you
write it.** This isn't a wording review (they chose the words); it's their chance
to catch a dropped word or a transcription slip before it becomes the record,
since once written the `.md` is what persists. So keep the check light and don't
editorialize — you're just reflecting their words back for a yes:

> User: "Take a note: the staging DB resets every night at 2am, don't trust data older than that."
>
> You: "Saving this verbatim —
> **Title:** staging DB resets nightly at 2am
> **Body:** The staging DB resets every night at 2am, don't trust data older than that.
> Good to save as-is?"
>
> On a yes → `sab note new "staging DB resets nightly at 2am" --body "The staging DB resets every night at 2am, don't trust data older than that."`

If the note also belongs to a task, fold that question into the same check (see
[Linking a note to a task](#linking-a-note-to-a-task)) rather than asking twice —
the link has to go in at creation, so it's the same beat as the save-confirm.

### 2. Derived — you compose

Triggers: *"make a note about …,"* *"write up what we just figured out,"*
*"capture this"* — the user wants a note but is leaving the wording to you.

Because the words will be yours, **draft the note and show it — title and body —
before writing anything.** The user is the only one who knows whether you
captured it faithfully, and an unreviewed note that misstates things is worse
than no note. Present it plainly and wait for a yes:

> "Here's the note I'd file:
> **Title:** auth retries caused by clock skew
> **Body:** The login retry loop wasn't a token bug — the auth server's clock was
> ~40s ahead, so freshly-issued tokens read as not-yet-valid. Fixed by syncing
> NTP; worth checking clock drift first next time.
>
> Good to save, or want changes?"

Apply any edits they ask for, then write it with `--body`.

### 3. Proactive — you notice something worth keeping

While working, things surface that would quietly vanish once the conversation
scrolls past. When that happens, *offer* a note (never silently create one).
Worth offering:

- a bug, landmine, or surprising behavior uncovered mid-task,
- follow-up work that's now implied but out of scope ("we'll need to migrate the
  old rows before this ships"),
- a decision and its reasoning, or a non-obvious insight,
- a smaller observation or TODO worth not losing — a rough edge, a "huh, that's
  odd," a thing to come back to.

Keep the offer to one light line and keep working — *"Worth a note that the
importer chokes on empty CSVs? Easy to forget once we move on."* It's a
suggestion, not a checkpoint; don't block the real task on it. The instinct to
aim for is the colleague who says "you might want to write that down," not the
one who interrupts every few minutes. So if they pass, let it go — don't
re-pitch the same note, and if they say to stop suggesting notes, stop for the
rest of the session. On a yes, treat it as a derived note: show the draft, then
write.

### Linking a note to a task

A note can carry a task link in its frontmatter, set at creation time:

```bash
sab note new "<title>" --body "<text>" --task <task_id> --context "$SLUG"
```

This is worth doing whenever a note plainly belongs to tracked work — it's how
that note later surfaces under `sab task view <id>`. But the call is the user's,
just like commit-linking, so offer rather than assume.

**The link is set at creation, so settle it before the `sab note new` call** —
there's no clean way to bolt a link on afterward. In practice that means: as
you're about to file the note, glance at the task list (you likely already have
it from resolving context; if not, run `sab task list`) and:

1. **One task clearly relates** — name it and ask: *"This note's about the
   redirect bug — want me to link it to `task_a1b2c3d4` fix-login-redirect?"*
   Include `--task` with the **exact** ID from the list only if they say yes.
2. **Nothing clearly matches** — don't force it. File the note without a link
   rather than interrogating the user about every unrelated task.

For a **verbatim** note that plainly relates to a task, this is the one beat
worth pausing on before writing: you still don't review the wording, but a quick
"saving this — link it to `task_xxxx` too?" lets you fold the link into the same
create call. If they don't answer or wave it off, just file the note unlinked;
the capture shouldn't wait on the link.

## Notes for future increments

- The script is intentionally a standalone, side-effect-light entry point so it
  can also be wired to a SessionStart **hook** later for guaranteed auto-run on
  every Claude launch in a mapped repo (settings.json), independent of model
  triggering.
- New `sab` capabilities (tasks, notes, briefing) should be added as sibling
  scripts/sections here. They should assume context has been resolved **and**
  pass `--context "$SLUG"` explicitly (the resolver's `slug` subcommand emits it)
  rather than relying on the shared global active context, which a concurrent
  session can change between commands.
- A SessionStart hook can run `resolve_context.py` to set a sane default context
  per repo, but it is only a convenience: it does **not** make concurrent
  multi-repo work safe, because all sessions share one global active context.
  The `--context "$SLUG"` convention above is what actually keeps each operation
  in the right context; the hook does not replace it.
- Requires `sab` on PATH (`npm link` in the saboteur-pos repo) and `python3`.
