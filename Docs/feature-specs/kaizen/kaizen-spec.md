# Kaizen Command — Feature Spec

> Note: this spec runs past the usual 500-word target. The feature is a single
> command, but its template-fidelity and template-lifecycle requirements are the
> substance of it and don't compress well.

## Overview

`sab kaizen` is a guided weekly review. It walks the user through a fixed, user-owned markdown template (`kaizen.md`) section by section, captures an answer for each prompt, and saves the result as a dated note. Today the template is a file the user would have to open, copy, and hand-fill every week — including manually re-typing last week's intentions into this week's "did they hold?" table, and manually keeping its project list in step with the repos actually being worked on. `sab kaizen` removes that clerical work while guaranteeing the opposite of what a generator usually does: the template's structure and wording are never rewritten by a run. A review records answers, and nothing else.

## Goals

- Running `sab kaizen` produces one dated note per review, containing every prompt from the active template verbatim with the user's answers filled in, saved as an editable markdown note tagged `kaizen`.
- A Kaizen run never writes to the template file. Template changes happen only through an explicit, separate user action.
- Last week's Section 6 intentions appear pre-filled in this week's Section 2 table, so the user answers only "Outcome" and "Why".
- Section 3 and Section 5 cover the user's actual `sab` contexts rather than a hardcoded project list, so a new repo is reviewed without editing the template.
- Each note records which template version produced it, so a review's structure can be traced back to the template text that was active at the time.

## Non-goals

- No scheduling, reminders, or nudges to run the review weekly — the user invokes it explicitly.
- No posting or syncing to any external service; output is local markdown only.
- No aggregation, trend reporting, or scoring across multiple Kaizen notes.
- No task or note creation from Section 6 intentions or Section 3 "Next action" answers — captured as plain text only, with no logic wired to them.
- No changes to the task state machine, dependency logic, or briefing composition.
- No support for arbitrary user-authored templates with unknown section semantics — `sab kaizen` understands the seven-section Kaizen structure specifically.

## User stories

- As a `sab` user, I want to run one command and be walked through my weekly review, so I don't hand-fill a markdown file.
- As a `sab` user, I want last week's intentions already in front of me when I review whether they held, so I'm not re-typing them or reviewing from memory.
- As a `sab` user, I want the project sections to match the repos I actually have, so the review doesn't drift out of date as projects are added or dropped.
- As a `sab` user, I want to edit the template's wording, prompts, and framing myself, and be certain that running a review will never silently change it.
- As a `sab` user, I want to see what actually shipped in each project before I answer "what moved", so the snapshot reflects the record rather than my recall.

## Functional requirements

### Template resolution and immutability

1. `sab init` MUST seed a default `kaizen.md` at `~/saboteur/templates/kaizen.md` (resolved alongside `saboteur.config.json`), and MUST backfill it for existing installs that lack it. It MUST NOT overwrite an existing file at that path.
2. `sab kaizen` MUST read the template from that path, and MUST accept `--template <path>` to override for a single run.
3. `sab kaizen` MUST open the template read-only. No code path in a review run may write, truncate, reformat, or rewrite the template file.
4. Every prompt, heading, blockquote, and instructional sentence in the rendered note MUST be reproduced byte-for-byte from the template. The run inserts answers only; it MUST NOT reword, reorder, summarise, or drop template prose.
5. The created note's frontmatter MUST record `template_path`, `template_hash` (a content hash of the template as read), and `template_version` (from template frontmatter).
6. `sab kaizen --edit-template` MUST open the template in `$EDITOR` and exit without starting a review. Missing `$EDITOR` MUST produce the standard message.
7. `sab kaizen template edit` MUST open the template in `$EDITOR` for direct editing. It is the only command in this feature that writes the template, and it MUST NOT be invoked implicitly by a review run.
8. If a required section (1–7) is absent or unparseable in the template, `sab kaizen` MUST fail with a human-readable error naming the section, and MUST NOT attempt to repair the file.

### Template annotation contract

The template is both the human-facing prose and the machine-readable schema. Structure is carried by HTML-comment directives, which render invisibly in any markdown viewer, so the file stays readable as a document while being deterministically parseable.

9. `sab kaizen` MUST derive prompts, ordering, input types, and validation exclusively from `<!-- sab:* -->` directives. It MUST NOT infer structure from prose, heading text, or list formatting.
10. The template MUST carry frontmatter with `template: kaizen`, `template_version`, and `schema`. `sab kaizen` MUST reject a `schema` value it does not support with a human-readable error naming the supported version.
11. The parser MUST support these directives: `sab:section`, `sab:field`, `sab:followup`, `sab:table` with `sab:column` and `sab:fixed-rows`, `sab:repeat`/`sab:end-repeat`, `sab:extra`, and `sab:list`.
12. `sab:field` MUST support the types `scale` (with `min`/`max`), `word`, `text`, `longtext`, `enum` (with `values`), `percent`, `date`, and `duration`, and MUST validate input against the declared type, re-prompting on failure.
13. A directive carrying `required="true"` MUST re-prompt on empty input. A field without it MUST accept empty and render as unanswered.
14. A directive carrying `when="<expr>"` MUST be prompted only when the expression holds against already-collected answers in the same run (e.g. `matches_priorities!=Y`). Expression support is limited to equality, inequality, and numeric comparison on a single prior field, combined with `or`/`and`.
15. An unrecognised `sab:*` directive MUST be ignored with a warning to stderr and MUST NOT abort the run — consistent with the "never crash on malformed input" rule for note frontmatter.
16. Every `id` in a directive MUST be unique within its scope and MUST be used as the answer key in the note's structured output. Duplicate ids MUST fail with a human-readable error.
17. Per-context prompts MUST be declared with `<!-- sab:extra context="<slug>" -->` blocks whose fields are appended to that context's Section 3 subsection. An `sab:extra` block whose slug matches no current context MUST be ignored silently — retiring a project MUST NOT require a template edit or produce an error.

### Review flow

18. `sab kaizen` MUST run as a fully prompt-driven interactive flow (stdin/stdout), MUST NOT invoke `$EDITOR` for answers, and MUST prompt sections in template order (1 → 7).
19. `sab kaizen` MUST default `Week of` to the Monday of the current local week, prompting for it. `--week-of <YYYY-MM-DD>` MUST override it and MUST suppress the prompt — a value given on the command line has already been stated, and re-asking it invites a typo that silently contradicts the flag.
20. `sab kaizen` MUST measure elapsed wall-clock time for the run and offer it as the default for `Time spent on this review`, which the user may overwrite.
21. Section 2 MUST pre-fill the `Intention` column with the intentions recorded in the most recent prior Kaizen note in scope (`ORDER BY created_at DESC LIMIT 1`, keyed off `tags` containing `kaizen`), prompting only for `Outcome` and `Why it did/didn't happen` per row. When no prior Kaizen note exists, Section 2 MUST render the table's `empty-message` and be skipped.
22. Section 3 MUST generate one project subsection per non-`inbox` context, in stable order, rather than from headings in the template. Each subsection MUST use the `sab:repeat` block's field set, plus any `sab:extra` fields declared for that context slug (FR17).
23. Before prompting each Section 3 subsection, `sab kaizen` MUST display a read-only recap for that context, as declared by the `sab:repeat` `recap` attribute: tasks moved to `done` and commits linked to them since the review period start, and currently `blocked` tasks. No writes.
24. Section 3 MUST allow skipping a project, and a skip MUST require a one-line reason, which is recorded in place of the answers. A silently blank subsection MUST NOT be accepted.
25. Section 5's bandwidth table MUST list one row per non-`inbox` context followed by the template's `sab:fixed-rows` entries, preserving those rows' wording.
26. Section 5 MUST warn (not block) when the entered percentages do not sum to 100.
27. Section 6 MUST accept up to the `sab:list` `max` intentions and MUST reject an additional one with a human-readable message stating the cap.
28. `sab kaizen` MUST NOT mutate task state, dependency links, or any table holding user-authored data. Derived indexes — caches rebuildable from disk or from git, namely `knowledge_index` and `commits` — are exempt: FR23's recap calls `indexCommits` to show linked commits, exactly as `sab standup` does. The rule this states is that a review records the week, it does not change it; refreshing a cache changes nothing a later `sab sync` would not.

### Persistence

29. The result MUST be persisted via the same note-creation mechanism as `sab note new` — frontmatter plus markdown body, written to the source path and indexed into `knowledge_index` in a single transaction — with `type = 'note'`, consistent with `standup`/`retro` (see the standup-retro spec, FR14/FR21).
30. Frontmatter MUST include `tags: [kaizen]`, `week_of`, `template_path`, `template_hash`, `template_version`, and an `intentions` array holding the Section 6 answers verbatim, so FR21's pre-fill reads a structured field rather than re-parsing prose.
31. `sab note find --tag kaizen` MUST return these notes.
32. The note MUST be filed in `active_context`, overridable with `--context <slug>`. `--all` MUST be rejected with a clear error. Section 3 and Section 5 enumerate all contexts regardless of the filing context, since the review is cross-cutting by design.
33. Multiple Kaizen runs for the same week MUST be allowed, each written to a uniquely named file (e.g. `<week-of>-kaizen-<uuid>.md`) so an earlier note is never overwritten.
34. `sab kaizen` MUST print the created note ID and file path on success, matching `sab note new`'s convention.

## Open questions

None identified.

## Resolved decisions

- **Template location.** `~/saboteur/templates/kaizen.md`, seeded by `sab init`, user-owned and editable, `--template` override. See FR1, FR2.
- **Project list source.** Derived from `sab` contexts, not from headings in the template, for both Section 3 and Section 5. See FR22, FR25.
- **Structure carried by HTML-comment directives.** The template is the schema. `<!-- sab:* -->` comments carry section boundaries, field ids, input types, and validation; they render invisibly, so the file stays a readable document. Nothing is inferred from prose or heading text (FR9), which is what makes FR4's byte-for-byte prose reproduction achievable — the parser never needs to interpret the words it is preserving. See FR9–FR17.
- **Per-context extra prompts.** `<!-- sab:extra context="<slug>" -->` blocks, appended to that context's snapshot; unmatched slugs are ignored silently so retiring a project needs no template edit. See FR17.
- **Intentions carry-forward.** Section 6 answers pre-fill the *next* run's Section 2 `Intention` column via the `intentions` frontmatter array, declared by `carries-forward-to`. See FR21, FR30.
- **Immutability.** Read-only during a run, template hash and version recorded in the note, plus two explicit escape hatches (`--edit-template`, `sab kaizen template edit`). See FR3–FR7.
- **AI-guided template editing lives outside the CLI.** A conversational "tell me what to change, show me the diff, then write it" flow would require a model in the loop, which the local-first invariant forbids in a `sab` command. The CLI therefore ships only the `$EDITOR` path (FR6, FR7), and the guided flow is delivered by the `saboteur-kaizen-template` Claude Code skill, which reads the same file, honours the same annotation contract, and writes only on user approval. The CLI has no knowledge of the skill and MUST NOT depend on it — the skill is one more way to perform the edit that FR7 already permits, so `sab` remains fully functional with no model present (Invariant 3).
- **Note type.** Ordinary `type = 'note'` distinguished by `tags`, matching the standup/retro precedent — a distinct type would be unreachable via `sab note find`.

## Out of scope (deferred)

- AI-guided template editing inside the CLI itself — delivered by the `saboteur-kaizen-template` skill instead (see Resolved decisions).
- Aggregation or trend reporting across Kaizen notes (energy/focus over time, recurring blockers, intention hit rate).
- Auto-creating tasks from Section 6 intentions or Section 3 "Next action" answers.
- Deriving Section 5's time allocation automatically from commit or task activity instead of asking.
- Reminders or scheduled prompts to run the weekly review.
- Surfacing Kaizen notes in the Phase 2b read-only UI.
- A non-interactive/scripted mode (per-section flags or a bulk `--answers` input).
- Additional cadences (monthly, quarterly) built on the same template mechanism.
