# Direct Edit — Implementation Tasks

### Task 1: Register `--body` flag on `sab note edit` ✓

**What:** Add the `--body <text>` option to the `note edit` command registration and thread it through to `runNoteEdit` via the options type.
**Files:** `src/index.ts`, `src/commands/note/edit.ts` (options type only)
**Done when:** `sab note edit <id> --body "hello"` parses without error and `options.body` is available inside `runNoteEdit`; no functional behaviour changes yet.
**Depends on:** none
**Estimate:** 1
**Notes:** Commander passes unknown options silently — add `.option('--body <text>', ...)` to the `note edit` command block (~line 246). Update the `options` parameter type in `runNoteEdit` to include `body?: string`.

---

### Task 2: Implement body content resolution ✓

**What:** Add a helper that takes the raw `--body` value, detects the `@<path>` prefix, reads the file if present, and returns the resolved string — or exits non-zero on any error condition.
**Files:** `src/commands/note/edit.ts`
**Done when:**
- `--body "some text"` returns `"some text"`
- `--body @/tmp/note.txt` reads and returns the file contents
- `--body @/nonexistent` exits 1 with `"Cannot read file '/nonexistent': <OS error>."`
- `--body "   "` (whitespace only) exits 1 with `"Body text is required for --body. Use 'sab note edit <id>' to open the editor."`
- `--body @/tmp/empty.txt` (empty file) exits 1 with the same empty-body message
**Depends on:** Task 1
**Estimate:** 2
**Notes:** The `@` prefix check is a simple `value.startsWith('@')` — slice off the `@`, call `readFileSync`, wrap in try/catch for the OS error message. Trim happens after resolution so the same empty check covers both input forms.

---

### Task 3: Wire direct-edit path into `runNoteEdit` ✓

**What:** When `options.body` is set, skip the `$EDITOR` check entirely, use the resolved body to compose the new file content (preserving frontmatter, replacing body), write atomically, update `updated_at`, and re-index — reusing the existing post-editor write block.
**Files:** `src/commands/note/edit.ts`
**Done when:**
- `sab note edit <id> --body "new content"` writes `new content` as the note body, preserves all frontmatter fields except `updated_at`, updates `updated_at` to today, re-indexes the note, and exits 0 without opening `$EDITOR`.
- `sab note edit <id> --body @<path>` behaves identically using file contents.
- Running without `--body` still opens `$EDITOR` (existing behaviour unchanged).
- Note ID not found exits 1 with the existing not-found error (no write occurs).
- The file write and index upsert execute inside a single `db.transaction`.
**Depends on:** Task 2
**Estimate:** 2
**Notes:** The existing post-editor block (lines 39–62 of `edit.ts`) already does the right things — re-read, parse frontmatter, set `updated_at`, `matter.stringify`, `writeFileSync`, `upsertKnowledgeEntry`. For the direct-edit path, swap `parsed.content` with the resolved body and skip the `execSync` call. Gate the `$EDITOR` check on `!options.body` so the missing-editor error is never reached when `--body` is used. Req 10 ("cannot be combined with editor flags") has no current conflict but add a comment reserving the guard for future flags.

---

## Summary

- Total tasks: 3
- Total estimated effort: 5 points
- Critical path: Task 1 → Task 2 → Task 3
- Risks: Task 3 — the existing post-editor write block uses `parsed.content` (the body the editor left on disk) as the source of truth. Substituting the resolved body is a one-line change, but it must not regress the editor path; the two branches must remain clearly separate and the editor path must be covered by a manual smoke-test after the change.
