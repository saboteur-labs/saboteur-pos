# Kaizen Command — Implementation Tasks

Derived from `kaizen-spec.md`. Estimates in story points (1/2/3/5/8).

Layering: a template **engine** under `src/kaizen/` (load → parse → validate →
expand → render, all pure and independently testable) with the command shell in
`src/commands/kaizen.ts`. Existing modules are reused rather than rebuilt:
`src/commands/checkin/recap.ts` (done/blocked/commit recaps),
`src/commands/checkin/writeCheckinNote.ts` (transactional note write),
`src/prompt.ts` (`ask`/`askSequence`).

---

### Task 1: Seed the Kaizen template on init
**What:** Ships `templates/kaizen.md` as a package asset and writes it to `~/saboteur/templates/kaizen.md` on `sab init`, backfilling existing installs.
**Files:** `src/commands/init.ts`, `package.json` (`files`/build copy), `tests/layer1-init.test.ts`
**Done when:** A fresh `sab init` produces `~/saboteur/templates/kaizen.md` byte-identical to the shipped asset; running `init` again over a hand-edited copy leaves it untouched; an install whose config predates this feature gains the file on next `init`.
**Depends on:** none
**Estimate:** 2
**Notes:** Mirrors how `stale_branch_days` was backfilled. Confirm the asset lands in the published package — `npm run build` runs `tsc`, which won't copy a `.md` on its own.
**Done:** [x] — `src/kaizen/paths.ts` (asset resolution by upward walk, works from `src/` and `dist/`), `src/kaizen/seed.ts` (never overwrites, so it doubles as the backfill), init step 8 + `Kaizen:` output line. 3 tests in `tests/layer1-init.test.ts`. `npm pack --dry-run` confirms `templates/kaizen.md` ships; no build change was needed. Templates dir resolves alongside the config file, so `--config` runs stay isolated.

---

### Task 2: Template loader — read, frontmatter, schema gate, hash
**What:** Loads the template read-only and returns its raw text, parsed frontmatter, and content hash.
**Files:** `src/kaizen/loader.ts`, `src/kaizen/loader.test.ts`
**Done when:** Loader resolves the default path or an explicit override, rejects frontmatter missing `template: kaizen` or carrying an unsupported `schema` with a message naming the supported version, and returns a stable hash for identical input. Opens with read-only intent; no write call exists in the module.
**Depends on:** 1
**Estimate:** 2
**Notes:** FR1–FR2, FR5, FR10. Hash algorithm just needs stability — `sha256` of the raw bytes.
**Done:** [x] — `src/kaizen/loader.ts` + 17 tests. Frontmatter is split by hand rather than taking gray-matter's `content`, which strips the newline after the closing `---`; `body` must be an exact slice of `raw` or FR4 fails downstream. Returns `bodyOffset` so the parser can map back to source offsets. Also validates `template_version` (FR30 needs it) and distinguishes ahead-of-sab from behind-sab schemas in the error text.

---

### Task 3: Directive lexer and block parser
**What:** Parses `<!-- sab:* -->` comments into a typed AST of sections, fields, lists, and followups, preserving every prose span verbatim between them.
**Files:** `src/kaizen/parse.ts`, `src/kaizen/parse.test.ts`
**Done when:** Parsing the shipped template yields all 7 sections in order with correct field ids and types; every byte of non-directive text is retained in a prose node; an unrecognised `sab:*` directive emits a stderr warning and is skipped without aborting; attribute parsing handles quoted values containing spaces and pipes.
**Depends on:** 2
**Estimate:** 5
**Notes:** FR9, FR11, FR15. The verbatim-prose guarantee (FR4) is won or lost here — model prose as opaque spans the parser never normalises. Highest-value unit tests in the feature.
**Done:** [x] — `src/kaizen/parse.ts` + 26 tests. Two-layer: `tokenize()` (prose spans + directives, with source offsets) then `parse()` (section tree). `reassemble()` is exported purely as the losslessness guard — the test asserting it round-trips the shipped template byte-for-byte is the tripwire for FR4. Non-`sab:` HTML comments stay prose, which the template relies on (`<!-- YYYY-MM-DD -->`, the per-context explainer block). Composite directives are kept as `raw-directive` nodes in document order for Task 4. **Carry-over for Task 15:** `parse()` returns `warnings[]` rather than writing to stderr itself, so it stays testable — the command shell must emit them (FR15).

---

### Task 4: Composite directives — tables, repeats, per-context extras
**What:** Extends the AST with `sab:table`/`sab:column`/`sab:fixed-rows`, `sab:repeat`/`sab:end-repeat`, and `sab:extra` blocks.
**Files:** `src/kaizen/parse.ts`, `src/kaizen/parse.test.ts`
**Done when:** The shipped template parses into a repeat block bound to `source="contexts"` with 4 child fields, 3 `sab:extra` blocks keyed by slug, and 2 tables with their columns and fixed rows; an unclosed `sab:repeat` fails with an error naming the section.
**Depends on:** 3
**Estimate:** 3
**Notes:** FR11, FR17.
**Done:** [x] — `fold()` pass in `src/kaizen/parse.ts` + 14 more tests (40 in the file). A parsed document now contains no `raw-directive` nodes, asserted by a tree walk. **Design call worth reviewing:** a `sab:table` absorbs the markdown table block that follows it as a `placeholder`, so Task 13 can keep the header row verbatim and replace only the empty body rows — otherwise a run renders a filled table beside a blank skeleton. This is the one place a directive's extent is located by looking at prose shape (contiguous `|` lines); the directive still declares that a table exists and names its columns, so FR9 holds in substance, but it is the closest the parser comes to the line. **Section 6's `1. 2. 3.` list skeleton has the same problem and is not yet handled** — Task 13 must absorb it the same way or the note will show an empty numbered list beside the real intentions.

---

### Task 5: Template validation pass
**What:** A validator that runs after parse and reports structural errors before any prompting begins.
**Files:** `src/kaizen/validate.ts`, `src/kaizen/validate.test.ts`
**Done when:** Duplicate ids within a scope fail with a human-readable error; `enum` without `values` and `scale` without `min`/`max` fail; a `when` referencing an unknown or later-prompted field fails; a missing required section (1–7) fails naming the section; the shipped template passes clean.
**Depends on:** 4
**Estimate:** 3
**Notes:** FR8, FR16. Fail before the first prompt — never half-collect a review then error out.
**Done:** [x] — `src/kaizen/validate.ts` + 22 tests. Id-uniqueness scopes are the subtle part: an `sab:extra` field is checked against the repeat it extends (same per-item answer namespace, so a collision would silently overwrite), but two different extras may reuse an id since each is a separate item. Also rejects a `when` referencing a *later* field — it could never hold when checked, so it would suppress its prompt forever. `REQUIRED_SECTIONS` hardcodes the seven ids, per the spec's non-goal on arbitrary templates.

---

### Task 6: `when` expression evaluator
**What:** Evaluates conditional-prompt expressions against answers already collected in the run.
**Files:** `src/kaizen/when.ts`, `src/kaizen/when.test.ts`
**Done when:** `energy<=2 or focus<=2` and `matches_priorities!=Y` evaluate correctly against a supplied answer map; unsupported syntax fails at validation time rather than mid-run; a field whose `when` is false is skipped and recorded as unasked.
**Depends on:** 3
**Estimate:** 2
**Notes:** FR14. Scope is deliberately small — equality, inequality, numeric comparison, `and`/`or`. Resist growing an expression language.
**Done:** [x] — `src/kaizen/when.ts` + 18 tests. Parse is separate from evaluate so a malformed condition fails in validation, before the first question. **Semantic call:** an unanswered field makes its comparison false whatever the operator — treating absence as not-equal would fire follow-ups predicated on information the user never gave. `and` binds tighter than `or`.

---

### Task 7: Field prompting and type validation
**What:** Prompts a single field per its declared type and re-prompts on invalid input.
**Files:** `src/kaizen/prompt-field.ts`, `src/kaizen/prompt-field.test.ts`
**Done when:** Each of `scale`, `word`, `text`, `longtext`, `enum`, `percent`, `date`, `duration` accepts valid input and re-prompts on invalid; `required="true"` re-prompts on empty while an optional field accepts empty and records as unanswered.
**Depends on:** 3
**Estimate:** 3
**Notes:** FR12, FR13. Builds on `src/prompt.ts`; inject the ask function so tests drive it without a TTY.
**Done:** [x] — `src/kaizen/prompt-field.ts` + 23 tests. All 8 types validate and re-prompt; enum returns declared casing, percent strips `%`, date rejects impossible-but-well-formed values like `2026-02-30`. **`longtext` reads until a blank line** rather than taking one line — the Kaizen question and honest note are the reflective fields and a single line would shape what gets written. **Load-bearing loop guard:** `ask()` returns `''` on exhausted stdin, so a required field would re-prompt forever; `maxAttempts` (default 10) throws `PromptAbortedError` instead.

---

### Task 8: Context expansion
**What:** Expands the repeat block into one subsection per non-`inbox` context, appending matching `sab:extra` fields, and expands the bandwidth table's rows.
**Files:** `src/kaizen/expand.ts`, `src/kaizen/expand.test.ts`
**Done when:** Given a context list, expansion produces one snapshot block per non-`inbox` context in stable alpha order, with `offbeat-fm`/`getwrite-development`/`saboteur-pos` receiving their extra field; an `sab:extra` slug matching no context is dropped silently; the bandwidth table yields context rows followed by the fixed rows with wording preserved.
**Depends on:** 4
**Estimate:** 3
**Notes:** FR17, FR22, FR25. The silent-drop behaviour is deliberate (retiring a project needs no template edit) — assert it explicitly so nobody later "fixes" it into an error.
**Done:** [x] — `src/kaizen/expand.ts` + 21 tests. Produces an `ExpandedDocument` with its own node union (`expanded-repeat`, `expanded-table`), so the renderer walks one shape and answer keys are namespaced (`projects.<slug>.<field>`, `<table>.<row>.<column>`). `order="alpha"` sorts by **slug**, not name, so a renamed context keeps its week-to-week position. **Bug found and fixed in Task 4's fold:** `sab:extra` has no terminator, so the last one swallowed the section's closing `---` and would have rendered a horizontal rule inside one context's snapshot only; `detachTrailingSeparator` returns it to the section. Two regression tests.

---

### Task 9: Per-context recap
**What:** Displays done tasks, their linked commits, and blocked tasks for a context before its snapshot prompts.
**Files:** `src/commands/kaizen/recap.ts`, `tests/kaizen.test.ts`
**Done when:** Each snapshot is preceded by that context's recap for the review week; the recap issues reads only, verified by asserting no write occurs; a context with no activity shows an explicit "no movement recorded" line rather than blank space.
**Depends on:** 8
**Estimate:** 2
**Notes:** FR23. Reuses `doneSince`, `blockedInScope`, `commitsForTasks` from `src/commands/checkin/recap.ts` — pass the week-of date as the cutoff.
**Done:** [x] — `src/commands/kaizen/recap.ts` + 10 tests. `doneSince` does take an arbitrary cutoff, so the risk noted against this task did not materialise. `parseRecapRequest` reads the `sab:repeat` `recap` attribute, so the template decides which parts are gathered. Empty contexts print "no movement recorded this week" rather than blank space. **Spec conflict to resolve (see Risks):** requesting `linked_commits` calls `indexCommits`, which writes the derived `commits` cache — FR28 as written forbids writing any table but `knowledge_index`.

---

### Task 10: Intentions carry-forward lookup
**What:** Reads the most recent prior Kaizen note and returns its recorded intentions.
**Files:** `src/commands/kaizen/intentions.ts`, `src/commands/kaizen/intentions.test.ts`
**Done when:** The lookup returns the `intentions` frontmatter array from the newest note tagged `kaizen` in scope (`ORDER BY created_at DESC LIMIT 1`); returns empty when none exists; ignores notes whose frontmatter is malformed rather than throwing.
**Depends on:** 4
**Estimate:** 3
**Notes:** FR21, FR30. Key off `tags` and never off `type` — Kaizen notes are `type = 'note'`, same as standup/retro.
**Done:** [x] — `src/commands/kaizen/intentions.ts` + 10 tests. Keyed off `tags`, with a test proving a standup note is not mistaken for a kaizen one. Every bad-data path (deleted file, malformed YAML, non-array `intentions`, missing field) yields `[]` rather than throwing — a broken prior week should cost the prefill, not this week's review.

---

### Task 11: Section 2 prefilled table
**What:** Prompts the intentions-review table with the `Intention` column pre-filled and only `Outcome`/`Why` asked.
**Files:** `src/commands/kaizen/section2.ts`, `tests/kaizen.test.ts`
**Done when:** With prior intentions present, one row per intention is prompted for outcome (enum) and why, with the intention text shown and not editable; with none present, the table's `empty-message` renders and the section is skipped without prompting.
**Depends on:** 7, 10
**Estimate:** 2
**Notes:** FR21.
**Done:** [x] — `promptTable()` in `src/commands/kaizen/sections.ts` + 4 tests. Columns marked `prompt="false"` are shown as row context and never asked, so two prior intentions produce exactly four questions. No prior intentions → prints `empty-message`, asks nothing.

---

### Task 12: Section 5 bandwidth table
**What:** Prompts a percentage per expanded row and warns when the total isn't 100.
**Files:** `src/commands/kaizen/section5.ts`, `tests/kaizen.test.ts`
**Done when:** Every expanded row is prompted for a percent; a total other than 100 prints a warning and proceeds; the `protect_or_cut` field is prompted only when `matches_priorities` is not `Y`.
**Depends on:** 6, 7, 8
**Estimate:** 2
**Notes:** FR26. Warn, never block — FR26 is explicit that this is non-fatal.
**Done:** [x] — same `promptTable()`, + 6 tests. Both generated tables share one implementation; they differ only in their row source. Sum warning fires on a total other than 100 but keeps the answers, and stays silent when nothing was answered at all. Rows are labelled by context *name* while answer keys use the *slug*. `protect_or_cut`'s `when` gating is a plain field and lands in Task 15's walk.

---

### Task 13: Renderer
**What:** Renders the collected answers back into the template's structure, reproducing all template prose byte-for-byte.
**Files:** `src/kaizen/render.ts`, `src/kaizen/render.test.ts`
**Done when:** A rendered note contains every prose span from the source template byte-identical (asserted by extracting prose spans from both and comparing); answers appear against their prompts; skipped projects render their skip reason; unanswered optional fields render as empty rather than being dropped; `sab:*` directives do not appear in the output.
**Depends on:** 7, 8
**Estimate:** 5
**Notes:** FR4. The byte-for-byte assertion is the single most important test in the feature — it is what makes the immutability promise observable in the output, not just the file.
**Done:** [x] — `src/kaizen/render.ts` + 24 tests. The renderer only ever *appends* an answer to prose or *replaces* a placeholder it was handed; it never regenerates markdown from structure. Section 6's list stub is now absorbed in `fold()` (the debt from Task 4), matching the table treatment. **Two defects that the property tests passed straight over and only rendering a full review exposed:** (a) every directive left a doubled blank line, since the template puts a blank line either side of it — fixed by absorbing the directive's line ending into its token, keeping `raw` a true slice so reassembly stays lossless; (b) follow-up answers were appended to the end of the blockquote instruction they hang off. Both now have regression tests. **Open cosmetic question:** the template's author-facing `<!-- ... -->` hints (`<!-- YYYY-MM-DD -->`, the per-context explainer) are reproduced into the note. Invisible when rendered, slightly noisy in raw markdown — stripping them would mean deciding which comments are "authoring" and which are "content", which is the prose interpretation FR9 forbids.

---

### Task 14: Persist the Kaizen note
**What:** Writes the rendered review as a note with Kaizen frontmatter, transactionally.
**Files:** `src/commands/kaizen/persist.ts`, `tests/kaizen.test.ts`
**Done when:** A run produces a note with `tags: [kaizen]`, `week_of`, `template_path`, `template_hash`, `template_version`, and an `intentions` array; the file and `knowledge_index` row are written in one transaction (a forced mid-write failure leaves neither); `sab note find --tag kaizen` returns it; two runs in the same week produce two distinct files.
**Depends on:** 13
**Estimate:** 3
**Notes:** FR29–FR31, FR33. Reuses `createCheckinNote`; extend its options for the extra frontmatter rather than forking it.
**Done:** [x] — `src/commands/kaizen/persist.ts` + 10 tests. Reuses `createCheckinNote`, extended with two optional fields (`createdAt`, `filenameDate`) rather than forked; existing callers are unaffected. Notes are filed under the **week under review**, not the day written, so a Monday review of last week sorts where it belongs. **Ordering defect found by test:** FR21's `ORDER BY created_at DESC LIMIT 1` ties for two same-week reviews — at date granularity always, and even at millisecond granularity for back-to-back writes, which is what the test hit. Fixed with full-ISO `created_at` *plus* a `rowid DESC` tie-break, so the newest review wins regardless of clock resolution. **Known gap (Task 18):** the file write precedes the DB transaction, so a failing index write leaves an orphaned `.md`. FR29 wants neither written — needs a write-after-commit or cleanup-on-throw in the shared writer, which would also fix `sab standup`/`sab retro`.

---

### Task 15: Command wiring and flags
**What:** Registers `sab kaizen` and orchestrates load → validate → expand → prompt → render → persist.
**Files:** `src/commands/kaizen.ts`, `src/index.ts`, `tests/kaizen.test.ts`
**Done when:** `sab kaizen` runs the full flow end to end; `--week-of` overrides the default Monday-of-current-week; `--context` changes the filing context while sections 3 and 5 still enumerate all contexts; `--all` is rejected with a clear error; `--template` loads an alternate file; the note id and path print on success; no task state, dependency, or non-`knowledge_index` table is mutated.
**Depends on:** 5, 9, 11, 12, 14
**Estimate:** 3
**Notes:** FR18, FR19, FR28, FR32, FR34. Follow the `sab standup` registration shape in `src/index.ts`, including the `--all` rejection precedent.
**Done:** [x] — `src/commands/kaizen.ts` (shell) + `src/commands/kaizen/run.ts` (question walker) + registration, with 23 tests in `tests/kaizen.test.ts`. Nothing about the seven sections is hardcoded in the walker — the template drives which questions exist, their order, type, and conditions. Parser warnings now reach stderr, closing Task 3's carry-over. **Bug found by live run:** `--config` after a nested subcommand is parsed by the *parent* command, so `sab kaizen template edit --config X` silently used the default `~/saboteur` path; fixed with `optsWithGlobals()`.

---

### Task 16: Template edit entry points
**What:** Adds `sab kaizen template edit` and `sab kaizen --edit-template`, both opening `$EDITOR` and exiting.
**Files:** `src/commands/kaizen/templateEdit.ts`, `src/index.ts`, `tests/kaizen.test.ts`
**Done when:** Both entry points open the resolved template in `$EDITOR` and exit without starting a review; a missing `$EDITOR` produces the standard message and a non-zero exit; neither path is reachable from a review run.
**Depends on:** 2
**Estimate:** 1
**Notes:** FR6, FR7. This is the CLI's only template write path — the `saboteur-kaizen-template` skill drives the same file separately and the CLI must not know about it.
**Done:** [x] — `src/commands/kaizen/templateEdit.ts`, pulled forward because Task 15's shell imports it. Both entry points exit without running a review; missing `$EDITOR` gives the standard message.

---

### Task 17: Elapsed-time default
**What:** Measures run duration and offers it as the default for "Time spent on this review".
**Files:** `src/commands/kaizen.ts`, `tests/kaizen.test.ts`
**Done when:** The prompt shows a measured duration the user can accept or overwrite, and the accepted value lands in the rendered note.
**Depends on:** 15
**Estimate:** 1
**Notes:** FR20. Prompt for it last, so the measurement covers the actual review.
**Done:** [x] — done as part of Task 15 rather than after it, because a static default would have been actively wrong. **Ordering conflict resolved:** the template places "Time spent on this review" *second*, where elapsed time is necessarily zero. It is now asked last (`deferFields`) while still *rendering* in its template position — FR18's ordering requirement is about sections, and the preamble is not one. Defaults resolve through a `defaultFor(id)` callback so they are computed when asked, not when the run starts.

---

### Task 18: End-to-end and immutability tests
**What:** A full-run integration test plus explicit proof the template is never written.
**Files:** `tests/kaizen.test.ts`
**Done when:** A scripted run over a temp DB and temp template produces the expected note; the template file's mtime and hash are unchanged after the run; a run interrupted mid-flow leaves no partial note and an untouched template; a template missing a required section fails before the first prompt.
**Depends on:** 15
**Estimate:** 3
**Notes:** FR3. The unchanged-hash assertion is the regression guard for the feature's core promise — it must fail loudly if anyone adds a write path later.
**Done:** [x] — 7 more tests in `tests/kaizen.test.ts` (30 in the file). Immutability is asserted on **bytes and mtime together**: mtime catches a rewrite with identical content, which byte-equality alone would pass — verified that the tripwire actually trips before relying on it. Also asserts the recorded `template_hash` matches the file, and that editing the template between runs changes it, which is what makes "which version produced this review" answerable. Interrupted runs leave no note, no index row, and an untouched template. **Closed the FR29 gap from Task 14:** `createCheckinNote` now removes the file if the index transaction throws, so the pair is all-or-nothing per Invariant 5 — this fixes `sab standup` and `sab retro` too.

---

### Task 19: Documentation
**What:** Documents `sab kaizen`, its flags, and the template annotation contract.
**Files:** `Docs/CoreSpec/Docs/CLI.md`, `README.md`, `CLAUDE.md`
**Done when:** `CLI.md` lists `sab kaizen` and `sab kaizen template edit` with all flags; the annotation contract is documented with the directive table and field types; `CLAUDE.md`'s core-systems section gains a Kaizen entry alongside Standup/Retro.
**Depends on:** 15
**Estimate:** 2
**Notes:** `CLAUDE.md` is already stale about the project being pre-implementation; worth correcting that line while editing the file.
**Done:** [x] — `CLI.md` gains `sab kaizen`, `sab kaizen template edit`, and a full annotation-contract section (directive table, field types, `when` grammar, validation rules, placeholders). `README.md` covers the command, the template file, and the never-writes-it guarantee. `CLAUDE.md`'s "implementation has not begun" line is corrected, build commands are filled in (with the `ui-file-watcher` flake noted), and a Kaizen entry sits alongside Standup/Retro carrying the two rules a future contributor must not break. **Documented error strings were checked against the running CLI**, which surfaced one contract asserted nowhere: missing `$EDITOR`. The shared test helper always sets `EDITOR`, so a test now spawns without it — 31 tests in `tests/kaizen.test.ts`.

---

## Summary

- **Total tasks:** 19
- **Total estimated effort:** 50 points
- **Critical path:** Tasks 1 → 2 → 3 → 4 → 8 → 13 → 14 → 15 → 18 (26 points). Tasks 6, 7, 10 and 16 branch off early and can run alongside it; 17 and 19 are trailing leaves.
- **Risks:**
  - **Task 3 (5 pts)** carries the most uncertainty — the parser must retain prose losslessly while extracting structure, and every downstream task depends on its AST shape. Worth building against the real template from the first test rather than a reduced fixture.
  - **Task 13 (5 pts)** is where FR4's byte-for-byte promise is actually proven; a naive render-from-AST that reflows markdown will pass casual review and violate the spec. The prose-span comparison test is the guard.
  - ~~**Tasks 8 and 9** assume `recap.ts` helpers accept an arbitrary cutoff~~ — resolved: `doneSince` takes any `cutoffIso`, no extra work needed.
  - ~~**FR29 partial writes**~~ — resolved in Task 18: the shared note writer now cleans up the file when the index write fails.
  - **FR28 vs. commit linking (open).** FR28 says a run must not mutate "any table other than `knowledge_index`", but showing linked commits requires `indexCommits`, which writes the derived `commits` cache. `sab standup` already does exactly this under an identically worded requirement, so the working interpretation is that refreshing a derived index does not count as mutating user data. Either FR28 should be amended to say so explicitly, or the recap must drop commit linking. Flagging rather than silently choosing.
  - **Minor spec/skill drift:** the `saboteur-kaizen-template` skill lists `kaizen.template_path` in its resolution order, but no FR defines that config field. The skill treats it as optional so nothing breaks, but Task 2 should either add the field or the skill line should be dropped.

---

## Completion

All 19 tasks done, 50 points. **487 tests passing** across 37 files; typecheck clean.

Delivered beyond the original breakdown:
- **FR29 partial-write fix** (Task 18) — the shared note writer now removes the file when the index transaction fails, which also fixes `sab standup` and `sab retro`.
- **Carry-forward ordering** (Task 14) — full-ISO `created_at` plus a `rowid` tie-break, since FR21's ordering ties for two same-week reviews.
- **Elapsed-time ordering** (Task 17) — asked last, rendered in template position, because the template places it where the measurement would be zero.

Still open for the spec owner:
- **FR28 vs. commit linking.** Showing linked commits calls `indexCommits`, which writes the derived `commits` cache; FR28 forbids writing any table but `knowledge_index`. `sab standup` has always done this under identical wording. Recommend amending FR28 to exempt derived indexes.
- **Author-facing HTML comments** in the template (`<!-- YYYY-MM-DD -->`, the per-context explainer) are reproduced into every note. Invisible when rendered, mildly noisy in raw markdown. Stripping them means deciding which comments are authoring and which are content — the prose interpretation FR9 forbids.
- **`--week-of` still prompts.** It sets the field's default rather than skipping the question, per FR19 as written. A one-line change if skipping is preferred.
