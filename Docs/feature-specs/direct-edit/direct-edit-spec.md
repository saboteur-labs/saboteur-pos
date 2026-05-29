# Direct Edit — Feature Spec

## Overview

The `sab note edit` command currently requires `$EDITOR` to open the note file interactively. This blocks scripting, piping, and quick one-liner updates entirely within the terminal. Direct Edit adds flags to `sab note edit` that let the user supply new note body content as a CLI argument, replacing the file's body in place without ever opening an editor. The feature makes note body replacement a fully composable shell operation.

## Goals

- Users can replace a note's body content from the CLI without an editor opening.
- The note's frontmatter is always preserved exactly; only the body is replaced.
- `updated_at` is updated and the note is re-indexed after a direct edit.
- The command exits non-zero and writes nothing if the content argument is empty or missing.
- `$EDITOR` is never invoked when the direct-edit flag is used, even if set.

## Non-goals

- Appending to or patching a subset of the note body (replace-all only).
- Editing frontmatter fields via direct-edit flags (frontmatter editing remains editor-only).
- Reading replacement content from stdin (piping support is a future iteration).
- Applying direct edit to task metadata (`sab task edit` is out of scope).

## User stories

- As a CLI user, I want to replace a note's body from a shell one-liner so that I can update notes from scripts without spawning an editor.
- As a CLI user, I want the command to fail clearly if I forget the content argument so that I don't silently blank a note.

## Functional requirements

1. `sab note edit <id> --body <text>` MUST replace the body of the identified note with `<text>` and exit without opening `$EDITOR`.
2. `sab note edit <id> --body @<path>` MUST read the replacement body from the file at `<path>` and behave identically to the inline form thereafter.
3. If `<path>` in the `@<path>` form does not exist or cannot be read, the command MUST exit non-zero with `"Cannot read file '<path>': <OS error>."` and write nothing to disk.
4. The system MUST NOT enforce a maximum body length beyond what the shell passes as an argument; no truncation or size validation is performed.
5. The note's frontmatter MUST be preserved verbatim; no frontmatter field may be altered by a direct edit except `updated_at`.
6. `updated_at` MUST be set to the current timestamp on every successful direct edit.
7. After a successful write, the system MUST re-index the note in `knowledge_index` (same post-edit logic as the interactive path).
8. If `<text>` resolves to an empty string after trimming (or the file at `<path>` is empty), the command MUST exit non-zero with the message `"Body text is required for --body. Use 'sab note edit <id>' to open the editor."` and write nothing to disk.
9. If the note ID does not exist, the command MUST exit non-zero with the existing not-found error message and write nothing to disk.
10. Passing `--body` together with any flag that would open an editor MUST be a usage error: exit non-zero with `"--body cannot be combined with editor flags."` (reserved for future flags; no current conflict).
11. The write MUST be performed in a single atomic operation — no partial state.

## Open questions

None identified.

## Out of scope (deferred)

- Reading replacement content from stdin (`sab note edit <id> --body -` or piping) — file path input via `@<path>` covers the scripting use case.
- An `--append` flag for additive edits without full replacement.
- Direct editing of frontmatter fields from the CLI.
- Direct edit support on `sab task edit`.
