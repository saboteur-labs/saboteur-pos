---
name: saboteur-kaizen-template
description: >-
  Edit the Saboteur Kaizen weekly-review template (`~/saboteur/templates/kaizen.md`)
  through a guided conversation: work out what the user actually wants changed, draft
  the edit against the template's `sab:*` annotation contract, show them a diff, and
  only write the file once they approve. Use this skill whenever the user wants to
  change their Kaizen review itself rather than answer it — adding, removing, or
  reordering a section; changing what a section asks; adding a per-project prompt for
  one repo; changing a field's input type, options, or validation; adjusting the
  intentions cap; or reacting to a review that felt wrong ("the kaizen asks too much",
  "I never answer section 5", "add a question about sleep", "the bandwidth table is
  missing a row"). Also use it to check or explain the template's structure. This is
  the ONLY path that writes the template — `sab kaizen` runs are strictly read-only,
  so never hand-edit the file mid-review. Not for filling in a review (that's
  `sab kaizen`), and not for the standup or retro question sets, which are fixed in
  code rather than template-driven.
---

# Editing the Kaizen template

The Kaizen template is a single markdown file that is simultaneously a human
document and a machine schema. `sab kaizen` reads it, walks the user through it,
and writes their answers to a note — **it never writes the template**. That
guarantee is the point of the design: a review can't quietly reshape the
instrument that measures the week.

So every template change flows through here, deliberately, with the user seeing
the diff before it lands.

## Locate the template

In order of precedence:

1. An explicit path the user names.
2. `kaizen.template_path` in `~/saboteur/saboteur.config.json`, if present.
3. The default: `~/saboteur/templates/kaizen.md`.

Read the whole file before proposing anything. Never edit from memory of a
previous session — the user may have hand-edited it since.

## Hard rules

- **Never edit while a review is running.** If `sab kaizen` is mid-flight, stop
  and tell the user to finish or abort the review first. Editing underneath a
  running review invalidates the `template_hash` that review will record.
- **Never reword the user's prose unasked.** The framing sentences, the Kaizen
  quotes, the "shame generator" line — those are their voice. Change wording only
  when explicitly asked, and quote the before/after when you do.
- **Never change an existing `id`.** Ids are the answer keys in every note ever
  written from this template. Renaming `intentions` to `weekly_intentions` breaks
  the section 6 → section 2 carry-forward and silently orphans historical answers.
  Add new ids freely; rename none.
- **Bump `template_version` on every write.** Notes record the version they were
  produced from; an unbumped edit makes two different structures indistinguishable.
  Leave `schema` alone unless the directive vocabulary itself changed.
- **Show a diff and get approval before writing.** Never write first and report after.
- **Keep section numbering contiguous.** If you insert or delete a numbered
  section, renumber the headings and say so — the numbers appear in the prose.

## The annotation contract

Structure comes only from `<!-- sab:* -->` HTML comments. Nothing is inferred from
prose or heading text, which is exactly why the prose can be reproduced verbatim
into every note. Any edit must keep that true: if a change isn't expressible in
directives, the parser won't see it.

| Directive | Purpose | Key attributes |
|---|---|---|
| `sab:section` | Section boundary | `id`, `title`, `minutes` |
| `sab:field` | One answerable prompt | `id`, `type`, `required`, `when`, `default` |
| `sab:followup` | Conditional extra prompt | `when`, `field`, `type` |
| `sab:table` | Tabular answers | `id`, `rows`, `exclude`, `empty-message`, `warn-unless-sums-to` |
| `sab:column` | Column within a table | `id`, `type`, `values`, `source`, `prompt` |
| `sab:fixed-rows` | Literal rows appended to a generated table | quoted row labels |
| `sab:repeat` / `sab:end-repeat` | Block repeated per source item | `id`, `source`, `exclude`, `order`, `skippable`, `skip-reason`, `recap` |
| `sab:extra` | Fields appended for one context | `context` (slug) |
| `sab:list` | Bounded list of answers | `id`, `type`, `min`, `max`, `carries-forward-to` |

**Field types:** `scale` (needs `min`/`max`), `word`, `text`, `longtext`, `enum`
(needs `values`, pipe-separated), `percent`, `date`, `duration`.

**`when` expressions** support equality, inequality, and numeric comparison against
a single prior field in the same run, combined with `or` / `and` — e.g.
`energy<=2 or focus<=2`, `matches_priorities!=Y`. Anything more complex than that
won't evaluate; simplify the condition or make the field unconditional.

A directive sits on its own line immediately **above** the prose it governs.

## Workflow

1. **Read the template** and orient — which sections exist, what each asks.
2. **Clarify intent before drafting.** Vague asks ("this is too long") need one
   round of questions: which sections earn their keep, which get skipped every
   week, is the goal fewer prompts or shorter ones. Don't guess at surgery.
3. **Check whether it's actually a template change.** Two common misfires:
   - Wanting a project added or removed → that's `sab context`, not the template.
     Section 3 and the bandwidth table generate from contexts.
   - Wanting a *project-specific* metric → that IS a template change: a
     `sab:extra` block keyed by context slug.
4. **Draft the edit**, matching surrounding directive style and prose voice.
5. **Show the diff** — the changed hunks, not the whole file — plus a one-line
   note on what it changes about the review experience.
6. **Write only on approval**, bumping `template_version`.
7. **Validate after writing** (below), and report the new version.

## Validation checklist

After any write, confirm:

- Frontmatter still has `template: kaizen`, `template_version` (bumped), `schema`.
- Every `sab:field` / `sab:column` / `sab:list` has a unique `id` within its scope.
- Every `enum` has `values`; every `scale` has `min` and `max`.
- Every `sab:repeat` has a matching `sab:end-repeat`.
- Every `when` references a field id that exists and is prompted **earlier**.
- `carries-forward-to` still points at a live table id.
- Section headings are numbered contiguously and match their `sab:section` order.
- Each `sab:extra` slug matches a real context, or is knowingly dormant —
  unmatched slugs are ignored silently by design, so a typo fails quietly. Check
  slugs against `sab context list`.

## Recipes

**Add a prompt to an existing section** — insert a `sab:field` with a fresh id
directly above its prose line. Decide `required` deliberately; default to optional.

**Add a per-project prompt** — add a `sab:extra context="<slug>"` block after the
`sab:end-repeat`, containing the field(s). Verify the slug with `sab context list`.

**Add a whole section** — `sab:section` with a new id, a numbered `##` heading, its
fields, and a `---` separator. Renumber following sections.

**Retire a section** — delete the block, renumber the rest. Warn the user that old
notes retain the section; new ones won't, and the version bump is what marks the
boundary.

**Change the intentions cap** — edit `max` on the `sab:list`, and update the "Three
maximum" prose to match. Mention that section 2's carried-forward table will size
itself to whatever the previous week actually recorded, so old notes stay readable.

**Make a prompt conditional** — add `when` to the field, ensuring the referenced
field is prompted earlier in the template.
