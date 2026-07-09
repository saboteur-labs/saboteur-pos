# Standup & Retro Commands — Feature Spec

> Note: this spec covers two related commands (`sab standup` and `sab retro`)
> that share a persistence mechanism, so it runs longer than the usual
> 500-word target.

## Overview

`sab standup` and `sab retro` are guided, interactive check-in commands that ground the user's sense of their own work in what actually happened, rather than what they intended. Today, a user's only record of "what did I actually do" is scattered across task state and git history, with no space to reflect on friction, expectations, or lessons. These commands prompt a short, fixed question progression, pull in objective data the system already tracks (done tasks, blocked tasks, linked commits) so the user isn't reconstructing their day from memory, and save the result as a durable, user-editable note.

## Goals

- Running `sab standup` produces a dated note recording challenges, today's focus, and current blockers, tagged with a time slot, scoped to a context — with the specific questions asked adapting to that slot (planning framing pre-work, reconciliation post-work, a lightweight pulse mid-day).
- Running `sab retro` produces a note comparing expectations to reality and capturing a lesson, scoped to a user-selected span (project, feature, or daily) — with question depth scaled to that scope: a short, frictionless set for daily, the full deep set for project/feature.
- Both commands surface relevant existing data (recent done tasks, linked commits, currently blocked tasks) as a recap before or during the question progression, without requiring the user to re-derive it manually.
- Standup and retro notes are stored using the same markdown-plus-frontmatter mechanism as `sab note new`, so they are queryable via `sab note find` and editable by hand afterward.
- Neither command mutates task state, dependency links, or any table other than `knowledge_index`/note files.

## Non-goals

- No automatic scheduling, reminders, or nudges to run standup/retro at a given time — the user invokes both explicitly.
- No posting to Slack, email, or any external service — output is local markdown only.
- No analytics, trend charts, or aggregation across multiple standup/retro entries in this pass.
- No structured parsing or scoring of answers (e.g. sentiment, blocker-resolution tracking) — answers are captured as freeform text in the note body.
- No changes to the task state machine, dependency logic, or briefing composition.
- No automatic task or note creation from retro's "concrete next step" answer, and no energy-based task matching driven by standup's energy question — both are natural future extensions but are captured as plain text only in this pass, with no logic wired to them.

## User stories

- As a `sab` user, I want a quick guided standup so I record what I struggled with, what I'm doing today, and what's blocking me, without opening my task list and notes separately.
- As a `sab` user, I want my standup to already know what shipped since my last session, so I don't have to recall it myself.
- As a `sab` user, I want to run a retro at the end of a feature, project, or day and be asked a small set of comparison questions, so I capture lessons while they're fresh.
- As a `sab` user, I want my standups and retros saved as editable markdown, so I can correct or expand on them later like any other note.
- As a `sab` user, I want my morning standup to ask about my plan and my evening standup to check whether reality matched it, rather than repeating the same generic questions all day.
- As a `sab` user, I want a quick, light retro option for daily use so reflecting doesn't feel like a chore, while still getting the full deep question set when I close out a project or feature.

## Functional requirements

### Shared

1. Both commands MUST persist their result via the same note-creation mechanism as `sab note new` (frontmatter + markdown body, written to the source path, indexed into `knowledge_index` in the same transaction as the file write). Standup and retro notes MUST use the existing `knowledge_index.type = 'note'` — no new `type` value is introduced; they are distinguished purely by `tags` plus a `slot` (standup) or `scope`/`scope_ref` (retro) frontmatter field (see FR14, FR21).
2. Both commands MUST default to `active_context` and MUST accept `--context <slug>` to override, consistent with all other commands. `--all` is not meaningful for creation and MUST be rejected with a clear error if passed.
3. Both commands MUST run as a fully prompt-driven interactive flow (stdin/stdout Q&A) and MUST NOT invoke `$EDITOR`.
4. Every write MUST occur in a single transaction; a failure partway MUST leave neither a partial file nor a partial index row.
5. Both commands MUST print the created note ID and file path on success, matching `sab note new`'s output convention.

### `sab standup`

6. `sab standup` MUST compute a "since last session" cutoff and display, before prompting: tasks moved to `done` since the cutoff (via `state_history`), commits linked to those tasks since the cutoff, and currently `blocked` tasks in scope — all read-only, no writes.
7. `sab standup` MUST also look up the most recent prior standup note in scope (if any) and surface its "one thing that must get done today" / "what are you working on today" answers as part of the recap, giving the reconciliation question (FR8, `pre-work`→`post-work`) something concrete to check against. This lookup MUST key off `tags` (containing `standup`) and the `slot` frontmatter field — never off `type`, since standup notes share `type = 'note'` with everything else (see FR14). Because duplicate standups in the same slot/day/context are allowed (FR13), "most recent" MUST tie-break by `ORDER BY created_at DESC LIMIT 1`. When no prior standup exists in scope, the reconciliation question MUST still be asked but presented as an open-ended check-in rather than a comparison.
8. The question progression is slot-aware: `sab standup` MUST present the subset and order below for the resolved slot, out of the full standup question set. A shared spine — blockers are always asked, in the same list-then-free-text form — runs through every slot.

   | Slot | Framing | Questions asked, in order |
   |---|---|---|
   | `pre-work` | Intention / planning — plan the session ahead | 1. "What are you working on today?" 2. "What's the one thing that must get done today?" 3. "How much focused time do you realistically have today?" 4. "What's your energy/focus like right now?" 5. "Are there any blockers to clear?" |
   | `post-work` | Reconciliation — did reality match the pre-work plan | 1. "Did you do what you set out to do last session?" 2. "What challenges did you face yesterday (or on your last work session)?" 3. "What's carrying over unfinished?" 4. "Are there any blockers to clear?" |
   | `wd-1` / `wd-2` / `wd-3` | Lightweight mid-day pulse | 1. "What's the one thing that must get done today?" (on-track check — reconfirm or revise the day's anchor) 2. "Are there any blockers to clear?" |

   The energy/focus question (`pre-work` only) notes that `sab` already tags tasks with an energy level and this answer could later inform task matching, but this pass MUST NOT wire any such logic — the answer is captured as plain text only.
9. Regardless of slot, "Are there any blockers to clear?" MUST list currently blocked tasks in scope (same query as briefing Section 5) before accepting free-text input.
10. Each standup MUST be tagged with exactly one time slot from the ordered set: `pre-work`, `wd-1`, `wd-2`, `wd-3`, `post-work`.
11. `sab standup` MUST accept `--slot <value>` to set the slot explicitly, which always overrides inference. When omitted, `sab standup` MUST infer the slot by comparing the current time against the configured windows in `standup.slot_windows` (see FR12) and selecting the window the current time falls within.
12. `saboteur.config.json` MUST gain a `standup.slot_windows` field mapping each slot to a time-of-day window, mirroring the existing `briefing.stale_task_days` precedent (a defaulted, nullable-safe config addition — no schema migration, per the Phase-1 invariant). This is a Phase 1 work item. Sensible default, written on `sab init` and backfilled for existing configs missing the field (mirroring how `stale_branch_days` was backfilled):

    ```json
    "standup": {
      "slot_windows": {
        "pre-work": "00:00-09:00",
        "wd-1": "09:00-12:00",
        "wd-2": "12:00-15:00",
        "wd-3": "15:00-18:00",
        "post-work": "18:00-24:00"
      }
    }
    ```

    Windows are local time, contiguous, and cover the full 24 hours; the config value is user-editable.
13. `sab standup` MUST allow multiple standups to be created in the same slot/day/context — this is not an error. Each MUST be written to a uniquely named file (timestamp- or UUID-suffixed, e.g. `<date>-<slot>-<uuid>.md`) so that a later standup never overwrites an earlier one already on disk, preserving any hand-edits made to it.
14. The resulting note's frontmatter MUST include a `tags` entry of `standup` and a `slot` field with the chosen value, in addition to the standard note fields (`id`, `title`, `context`, `created_at`, `updated_at`). This is an ordinary `type = 'note'` entry — no new `knowledge_index.type` is introduced. `sab note find --tag standup` MUST return these entries (verified by the fact that `listKnowledgeEntries` filters on `type = 'note'` in both its plain and `--tag` query branches, so any other `type` value would make them unreachable via that command).

### `sab retro`

15. `sab retro` MUST require a `--scope <project|feature|daily>` flag with no default; omitting it MUST fail with a human-readable error rather than guessing.
16. `sab retro` MUST require a scope reference appropriate to the chosen scope: `--task <id>` for `feature` (identifying the feature's tracking task), `--context <slug>` for `project` (already available via the shared context flag), or `--date <YYYY-MM-DD>` for `daily` (defaults to today if omitted).
17. `sab retro` MUST recap objective data scoped accordingly before prompting: for `feature`, done tasks/commits linked to the given task; for `project`, done tasks/commits in the given context since a window of `retro.project_window_days` days (see FR18); for `daily`, the given day's done tasks and commits (mirroring standup's recap).
18. `saboteur.config.json` MUST gain a `retro.project_window_days` field giving the lookback window (in days) for `project`-scope recaps, mirroring the existing `briefing.stale_task_days` precedent. This is a Phase 1 work item — a defaulted, nullable-safe config addition, no schema migration. Default: `14` (mirroring `briefing.stale_branch_days`'s default), backfilled for existing configs missing the field. Users may edit the value directly in config; no flag override is introduced in this pass.
19. Question depth varies by scope. For `project` and `feature` scope, `sab retro` MUST prompt the full progression, in order: (a) "What did you expect going in?", (b) "What actually happened?", (c) "How did actual effort compare to your estimate?", (d) "What went well that you want to repeat?", (e) "What surprised you?", (f) "What slowed you down more than once?", (g) "What would you do differently?", (h) "What decision are you unsure about?", (i) "What's the one lesson to carry forward?", (j) "What's the concrete next step or follow-up?". Question (c) is conceptually tied to `sab`'s task complexity estimates but this pass MUST NOT read or write any complexity field. Question (j)'s answer is a natural candidate to later spawn a linked task or note automatically, but this pass MUST NOT wire up any such creation — the next step is captured as plain text only.
20. For `daily` scope, `sab retro` MUST prompt only the shorter subset, in order: (a) "What actually happened?", (b) "What surprised you?", (c) "What's the concrete next step or follow-up?" — kept deliberately short so the daily retro stays frictionless enough to run every day. This subset is fixed in the implementation and is not configurable via `saboteur.config.json` in this pass.
21. The resulting note's frontmatter MUST include `tags: [retro]`, a `scope` field (`project`/`feature`/`daily`), and a `scope_ref` field holding the task ID, context slug, or date used, so `sab note find` can filter retros by scope later. This is an ordinary `type = 'note'` entry — no new `knowledge_index.type` is introduced, for the same reason given in FR14: `listKnowledgeEntries` hardcodes `type = 'note'`, so `sab note find --tag retro` only works if retros keep that type.

## Resolved decisions

All open questions from the prior draft have been resolved. None remain outstanding.

- **Tag vs. type convention.** Standup/retro notes stay `type = 'note'`, distinguished only by `tags` (`standup`/`retro`) plus `slot`/`scope`+`scope_ref` frontmatter — no new `knowledge_index.type`. Confirmed against `src/db/knowledge.ts`: `listKnowledgeEntries` hardcodes `type = 'note'` in both its plain and `--tag` query branches, so a distinct type would silently break `sab note find --tag standup`/`--tag retro`. See FR14, FR21.
- **Briefing surfacing.** No changes to `sab briefing`. Standup/retro notes are reachable only via `sab note find --tag standup` / `--tag retro`, consistent with the non-goal of not touching briefing composition.
- **Standup slot inference.** Config-defined time windows. `sab standup` infers the slot from the current time against `standup.slot_windows` in `saboteur.config.json` when `--slot` is omitted; `--slot` always overrides. See FR11, FR12.
- **Duplicate standup handling.** Duplicates are allowed. Multiple standups in the same slot/day/context each get a unique (timestamp- or UUID-suffixed) filename so an earlier one is never overwritten. The "most recent prior standup" lookup (FR7) ties-break with `ORDER BY created_at DESC LIMIT 1` and keys off `tags`/`slot`, not `type`. See FR7, FR13.
- **Daily retro question subset.** Fixed as specified (FR20) — not configurable in this pass.
- **Retro project-scope lookback window.** New config field `retro.project_window_days`, default `14`, mirroring `briefing.stale_task_days`. See FR17, FR18.
- **Phase 2b read-only UI surfacing.** Deferred — out of scope for this feature; handed off as a TODO to the read-only-ui spec (see "Out of scope (deferred)" below).
- **Non-interactive/scripted mode.** Out of scope for this pass; FR3 stands (fully interactive only). A scripting escape hatch mirroring `note new --body` may be revisited later (see "Out of scope (deferred)" below).

## Out of scope (deferred)

- Aggregating or trend-reporting across multiple standup/retro entries (e.g. "challenges you keep repeating").
- Reminders or scheduled prompts to run standup/retro at particular times.
- Any external integration (Slack, calendar, etc.) for delivering standup/retro content.
- Structured/semantic parsing of free-text answers.
- Retro scopes beyond project/feature/daily (e.g. a "quarter" or "sprint" scope).
- Surfacing standup/retro notes in the Phase 2b read-only UI (as a distinct filter/note type or otherwise) — deferred as a handoff item to the read-only-ui spec.
- A non-interactive/scripted mode for either command (per-question flags or a bulk `--answers` input), mirroring `note new --body` — may be revisited later if scripting demand emerges.
