# Multi Directory Repo Support — Feature Spec

## Overview

Git integration discovers repositories under a single configured directory (`repos_dir`), scanning only its immediate children. Developers who organize repos across several parallel directories — for example `~/code/apps` and `~/code/landing` — cannot surface all of them without flattening their layout or repeatedly re-pointing `repos_dir`. This feature lets the user configure multiple repo directories so repositories from all of them are discovered together, while preserving the existing per-context scoping and basename-based repo identity. It is the deferred follow-on to the [Tighten Git Integration](../tighten-git-integration/tighten-git-integration-spec.md) feature.

## Goals

- Repositories under any of several configured directories are discovered and surfaced together in `sab git list` and the briefing.
- An existing single-`repos_dir` configuration keeps working with no required change.
- Repo identity stays the basename, so `contexts.repos`, the `commits` index, and `sab context repos` need no change.
- Basename collisions across directories are detected and surfaced, never silently ambiguous.

## Non-goals

- Recursive or nested discovery — each configured directory is still scanned only at its immediate children.
- Path-qualified repo identity (root-relative names) — identity stays the bare basename.
- A `sab` command to manage the directory list — configuration remains a hand-edited JSON field, consistent with today's `repos_dir`.
- Any network or remote repo discovery.

## User stories

- As a developer with repos split across `apps/` and `landing/` directories, I want all of them discovered together so my briefing and `sab git list` show every relevant repo.
- As an existing user, I want my current `repos_dir` setting to keep working so upgrading requires no config edit.

## Functional requirements

1. The config MUST support a `repos_dirs` array of directory paths; each entry MUST be tilde- and absolute-path expanded exactly as `repos_dir` is today.
2. When `repos_dirs` is present, discovery MUST scan the immediate children of every listed directory and union the results.
3. When `repos_dirs` is absent but `repos_dir` is present, discovery MUST behave exactly as today.
4. When both are present, the system MUST union `repos_dir` with `repos_dirs`, treating `repos_dir` as one additional root.
5. A listed directory that does not exist MUST be skipped without error; the remaining directories MUST still be scanned.
6. Identical directory entries MUST be de-duplicated so a directory is scanned at most once.
7. `sab git list` and the briefing Repo State MUST consume the unioned discovery with no change to context scoping, `*` marking, or the skipped footer (beyond requirement 9).
8. Repo names stored and matched (commits, `contexts.repos`, link validation) MUST remain basenames, unchanged by the number of roots.
9. When two or more directories each contain a working repo with the same basename, the system MUST exclude all colliding repos from discovery, list each in the skipped footer with reason `name-collision`, and print a warning naming the basename and its directories.

## Open questions

None identified.

## Out of scope (deferred)

- Recursive discovery and nested repo directories.
- Path-qualified repo identity, allowing same-basename repos to coexist.
- A `sab` command to add or remove repo directories.
- Per-directory context defaults (auto-assigning a directory's repos to a context).
