---
name: saboteur-pos
description: >-
  Drive Saboteur POS (the `sab` CLI) for personal tasks, notes, and a daily
  briefing. Three capabilities are actively guided: (1) putting you in the RIGHT
  context — every `sab` action is context-scoped, so it maps the current git
  repository to its Saboteur context and switches to it; (2) linking git commits
  to tasks — before a commit it checks the task list and, with the user's OK,
  embeds the matching task ID in the message; and (3) capturing notes — when the
  user says "take a note" (capture it verbatim and confirm it back before saving)
  or "make a note" (draft it and show them first), AND proactively offering to
  note bugs, landmines, follow-up work,
  decisions, or insights that surface while working, linking a note to a task
  when it's relevant. For the briefing and standalone task add/move/done it
  reports those aren't wired in yet and offers to run the raw `sab` command. Use
  this skill whenever you start working in a repository, are about to commit,
  want to jot/save/capture/record a note, thought, or insight, or whenever the
  user mentions sab, saboteur, their tasks, notes, briefing, backlog, or "what
  should I work on" — even if they don't name the tool. This is the local
  Saboteur `sab` CLI — not Jira, Trello, Obsidian, or a repo's GitHub issues;
  don't engage for those. Also invoke it directly to switch or check context.
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

Three capabilities, all built on the same foundation — knowing which context the
current repo belongs to:

1. **Resolve the current repository to its context and switch to it** (below).
   Every other `sab` action depends on this running first.
2. **Link git commits to tasks** — when you're about to commit work, check
   whether it advances a tracked task and, with the user's OK, record the link
   in the commit message ([Linking commits to tasks](#linking-commits-to-tasks)).
3. **Capture notes** — write down what the user dictates, draft notes they ask
   you to compose, and proactively offer to note things worth keeping that
   surface while working ([Capturing notes](#capturing-notes)).

### Not yet wired into this skill

The `sab` CLI does more than the three workflows above — the daily briefing
(`sab briefing`) and standalone task management (`sab task add` / `move` /
`done` and the list views). This skill does **not** yet provide guided workflows
for those, so don't quietly improvise one or imply it's a finished skill
feature. When the user asks for one of these areas, be honest and helpful in the
same breath:

1. Say plainly that this increment of the skill covers context resolution,
   commit-linking, and note capture, and that the briefing and standalone task
   management are planned but not wired in yet.
2. Because the underlying CLI already works, offer to run the relevant `sab`
   command directly — e.g. `sab briefing`, `sab task add "<title>"` — and run it
   if they say yes.

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

**Step 2 — read the task list.**

```bash
sab task list
```

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
sab note new "<concise title>" --body "<body text>"
```

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
sab note new "<title>" --body "<text>" --task <task_id>
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
  scripts/sections here, and should assume context has already been resolved.
- Requires `sab` on PATH (`npm link` in the saboteur-pos repo) and `python3`.
