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
**Done:** [ ]

---

### Task 4: Composite directives — tables, repeats, per-context extras
**What:** Extends the AST with `sab:table`/`sab:column`/`sab:fixed-rows`, `sab:repeat`/`sab:end-repeat`, and `sab:extra` blocks.
**Files:** `src/kaizen/parse.ts`, `src/kaizen/parse.test.ts`
**Done when:** The shipped template parses into a repeat block bound to `source="contexts"` with 4 child fields, 3 `sab:extra` blocks keyed by slug, and 2 tables with their columns and fixed rows; an unclosed `sab:repeat` fails with an error naming the section.
**Depends on:** 3
**Estimate:** 3
**Notes:** FR11, FR17.
**Done:** [ ]

---

### Task 5: Template validation pass
**What:** A validator that runs after parse and reports structural errors before any prompting begins.
**Files:** `src/kaizen/validate.ts`, `src/kaizen/validate.test.ts`
**Done when:** Duplicate ids within a scope fail with a human-readable error; `enum` without `values` and `scale` without `min`/`max` fail; a `when` referencing an unknown or later-prompted field fails; a missing required section (1–7) fails naming the section; the shipped template passes clean.
**Depends on:** 4
**Estimate:** 3
**Notes:** FR8, FR16. Fail before the first prompt — never half-collect a review then error out.
**Done:** [ ]

---

### Task 6: `when` expression evaluator
**What:** Evaluates conditional-prompt expressions against answers already collected in the run.
**Files:** `src/kaizen/when.ts`, `src/kaizen/when.test.ts`
**Done when:** `energy<=2 or focus<=2` and `matches_priorities!=Y` evaluate correctly against a supplied answer map; unsupported syntax fails at validation time rather than mid-run; a field whose `when` is false is skipped and recorded as unasked.
**Depends on:** 3
**Estimate:** 2
**Notes:** FR14. Scope is deliberately small — equality, inequality, numeric comparison, `and`/`or`. Resist growing an expression language.
**Done:** [ ]

---

### Task 7: Field prompting and type validation
**What:** Prompts a single field per its declared type and re-prompts on invalid input.
**Files:** `src/kaizen/prompt-field.ts`, `src/kaizen/prompt-field.test.ts`
**Done when:** Each of `scale`, `word`, `text`, `longtext`, `enum`, `percent`, `date`, `duration` accepts valid input and re-prompts on invalid; `required="true"` re-prompts on empty while an optional field accepts empty and records as unanswered.
**Depends on:** 3
**Estimate:** 3
**Notes:** FR12, FR13. Builds on `src/prompt.ts`; inject the ask function so tests drive it without a TTY.
**Done:** [ ]

---

### Task 8: Context expansion
**What:** Expands the repeat block into one subsection per non-`inbox` context, appending matching `sab:extra` fields, and expands the bandwidth table's rows.
**Files:** `src/kaizen/expand.ts`, `src/kaizen/expand.test.ts`
**Done when:** Given a context list, expansion produces one snapshot block per non-`inbox` context in stable alpha order, with `offbeat-fm`/`getwrite-development`/`saboteur-pos` receiving their extra field; an `sab:extra` slug matching no context is dropped silently; the bandwidth table yields context rows followed by the fixed rows with wording preserved.
**Depends on:** 4
**Estimate:** 3
**Notes:** FR17, FR22, FR25. The silent-drop behaviour is deliberate (retiring a project needs no template edit) — assert it explicitly so nobody later "fixes" it into an error.
**Done:** [ ]

---

### Task 9: Per-context recap
**What:** Displays done tasks, their linked commits, and blocked tasks for a context before its snapshot prompts.
**Files:** `src/commands/kaizen/recap.ts`, `tests/kaizen.test.ts`
**Done when:** Each snapshot is preceded by that context's recap for the review week; the recap issues reads only, verified by asserting no write occurs; a context with no activity shows an explicit "no movement recorded" line rather than blank space.
**Depends on:** 8
**Estimate:** 2
**Notes:** FR23. Reuses `doneSince`, `blockedInScope`, `commitsForTasks` from `src/commands/checkin/recap.ts` — pass the week-of date as the cutoff.
**Done:** [ ]

---

### Task 10: Intentions carry-forward lookup
**What:** Reads the most recent prior Kaizen note and returns its recorded intentions.
**Files:** `src/commands/kaizen/intentions.ts`, `src/commands/kaizen/intentions.test.ts`
**Done when:** The lookup returns the `intentions` frontmatter array from the newest note tagged `kaizen` in scope (`ORDER BY created_at DESC LIMIT 1`); returns empty when none exists; ignores notes whose frontmatter is malformed rather than throwing.
**Depends on:** 4
**Estimate:** 3
**Notes:** FR21, FR30. Key off `tags` and never off `type` — Kaizen notes are `type = 'note'`, same as standup/retro.
**Done:** [ ]

---

### Task 11: Section 2 prefilled table
**What:** Prompts the intentions-review table with the `Intention` column pre-filled and only `Outcome`/`Why` asked.
**Files:** `src/commands/kaizen/section2.ts`, `tests/kaizen.test.ts`
**Done when:** With prior intentions present, one row per intention is prompted for outcome (enum) and why, with the intention text shown and not editable; with none present, the table's `empty-message` renders and the section is skipped without prompting.
**Depends on:** 7, 10
**Estimate:** 2
**Notes:** FR21.
**Done:** [ ]

---

### Task 12: Section 5 bandwidth table
**What:** Prompts a percentage per expanded row and warns when the total isn't 100.
**Files:** `src/commands/kaizen/section5.ts`, `tests/kaizen.test.ts`
**Done when:** Every expanded row is prompted for a percent; a total other than 100 prints a warning and proceeds; the `protect_or_cut` field is prompted only when `matches_priorities` is not `Y`.
**Depends on:** 6, 7, 8
**Estimate:** 2
**Notes:** FR26. Warn, never block — FR26 is explicit that this is non-fatal.
**Done:** [ ]

---

### Task 13: Renderer
**What:** Renders the collected answers back into the template's structure, reproducing all template prose byte-for-byte.
**Files:** `src/kaizen/render.ts`, `src/kaizen/render.test.ts`
**Done when:** A rendered note contains every prose span from the source template byte-identical (asserted by extracting prose spans from both and comparing); answers appear against their prompts; skipped projects render their skip reason; unanswered optional fields render as empty rather than being dropped; `sab:*` directives do not appear in the output.
**Depends on:** 7, 8
**Estimate:** 5
**Notes:** FR4. The byte-for-byte assertion is the single most important test in the feature — it is what makes the immutability promise observable in the output, not just the file.
**Done:** [ ]

---

### Task 14: Persist the Kaizen note
**What:** Writes the rendered review as a note with Kaizen frontmatter, transactionally.
**Files:** `src/commands/kaizen/persist.ts`, `tests/kaizen.test.ts`
**Done when:** A run produces a note with `tags: [kaizen]`, `week_of`, `template_path`, `template_hash`, `template_version`, and an `intentions` array; the file and `knowledge_index` row are written in one transaction (a forced mid-write failure leaves neither); `sab note find --tag kaizen` returns it; two runs in the same week produce two distinct files.
**Depends on:** 13
**Estimate:** 3
**Notes:** FR29–FR31, FR33. Reuses `createCheckinNote`; extend its options for the extra frontmatter rather than forking it.
**Done:** [ ]

---

### Task 15: Command wiring and flags
**What:** Registers `sab kaizen` and orchestrates load → validate → expand → prompt → render → persist.
**Files:** `src/commands/kaizen.ts`, `src/index.ts`, `tests/kaizen.test.ts`
**Done when:** `sab kaizen` runs the full flow end to end; `--week-of` overrides the default Monday-of-current-week; `--context` changes the filing context while sections 3 and 5 still enumerate all contexts; `--all` is rejected with a clear error; `--template` loads an alternate file; the note id and path print on success; no task state, dependency, or non-`knowledge_index` table is mutated.
**Depends on:** 5, 9, 11, 12, 14
**Estimate:** 3
**Notes:** FR18, FR19, FR28, FR32, FR34. Follow the `sab standup` registration shape in `src/index.ts`, including the `--all` rejection precedent.
**Done:** [ ]

---

### Task 16: Template edit entry points
**What:** Adds `sab kaizen template edit` and `sab kaizen --edit-template`, both opening `$EDITOR` and exiting.
**Files:** `src/commands/kaizen/templateEdit.ts`, `src/index.ts`, `tests/kaizen.test.ts`
**Done when:** Both entry points open the resolved template in `$EDITOR` and exit without starting a review; a missing `$EDITOR` produces the standard message and a non-zero exit; neither path is reachable from a review run.
**Depends on:** 2
**Estimate:** 1
**Notes:** FR6, FR7. This is the CLI's only template write path — the `saboteur-kaizen-template` skill drives the same file separately and the CLI must not know about it.
**Done:** [ ]

---

### Task 17: Elapsed-time default
**What:** Measures run duration and offers it as the default for "Time spent on this review".
**Files:** `src/commands/kaizen.ts`, `tests/kaizen.test.ts`
**Done when:** The prompt shows a measured duration the user can accept or overwrite, and the accepted value lands in the rendered note.
**Depends on:** 15
**Estimate:** 1
**Notes:** FR20. Prompt for it last, so the measurement covers the actual review.
**Done:** [ ]

---

### Task 18: End-to-end and immutability tests
**What:** A full-run integration test plus explicit proof the template is never written.
**Files:** `tests/kaizen.test.ts`
**Done when:** A scripted run over a temp DB and temp template produces the expected note; the template file's mtime and hash are unchanged after the run; a run interrupted mid-flow leaves no partial note and an untouched template; a template missing a required section fails before the first prompt.
**Depends on:** 15
**Estimate:** 3
**Notes:** FR3. The unchanged-hash assertion is the regression guard for the feature's core promise — it must fail loudly if anyone adds a write path later.
**Done:** [ ]

---

### Task 19: Documentation
**What:** Documents `sab kaizen`, its flags, and the template annotation contract.
**Files:** `Docs/CoreSpec/Docs/CLI.md`, `README.md`, `CLAUDE.md`
**Done when:** `CLI.md` lists `sab kaizen` and `sab kaizen template edit` with all flags; the annotation contract is documented with the directive table and field types; `CLAUDE.md`'s core-systems section gains a Kaizen entry alongside Standup/Retro.
**Depends on:** 15
**Estimate:** 2
**Notes:** `CLAUDE.md` is already stale about the project being pre-implementation; worth correcting that line while editing the file.
**Done:** [ ]

---

## Summary

- **Total tasks:** 19
- **Total estimated effort:** 50 points
- **Critical path:** Tasks 1 → 2 → 3 → 4 → 8 → 13 → 14 → 15 → 18 (26 points). Tasks 6, 7, 10 and 16 branch off early and can run alongside it; 17 and 19 are trailing leaves.
- **Risks:**
  - **Task 3 (5 pts)** carries the most uncertainty — the parser must retain prose losslessly while extracting structure, and every downstream task depends on its AST shape. Worth building against the real template from the first test rather than a reduced fixture.
  - **Task 13 (5 pts)** is where FR4's byte-for-byte promise is actually proven; a naive render-from-AST that reflows markdown will pass casual review and violate the spec. The prose-span comparison test is the guard.
  - **Tasks 8 and 9** assume `sab context list` ordering is stable and that `recap.ts` helpers accept an arbitrary cutoff date rather than only the standup "since last session" cutoff — verify the latter before starting Task 9, as it may add a point.
  - **Minor spec/skill drift:** the `saboteur-kaizen-template` skill lists `kaizen.template_path` in its resolution order, but no FR defines that config field. The skill treats it as optional so nothing breaks, but Task 2 should either add the field or the skill line should be dropped.
