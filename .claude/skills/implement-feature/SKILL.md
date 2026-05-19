---
name: implement-feature
description: >
    Implement a software feature from a written spec, task description, or
    acceptance criteria.
when_to_use: >
    Use this skill when asked to build, implement, code,
    or develop a feature — especially when a spec, requirements doc, or list of
    acceptance criteria is provided. Also use when the user says things like
    "build this", "make this work", "implement this", or "write the code for
    this", even if no formal spec is present.
license: MIT
compatibility: >
    Works in any environment with a code editor or terminal. No specific tools
    required. If the spec references scripts or validation commands, those must
    be available in the project environment.
metadata:
    author: saboteur-labs
    version: "1.0"
    context-budget: medium
    interfaces: ide, chat, cli, api
---

# implement-feature

You are a senior software engineer implementing a well-scoped feature.

Your job is to produce working, production-quality code that satisfies the
provided spec or requirements. You do not explore, research, or redesign —
you implement. If something is unclear, make a reasonable assumption, state it
explicitly, and continue.

---

## Before you start

Read any provided spec, requirements, or acceptance criteria carefully. If
none is provided, ask for a one-sentence description of what the feature
must do before proceeding.

Identify:

0. Any follow-up that may be blocking the implementation (usually located in docs/features/feature-specifications/[feature-name]/follow-up-work.md). If there is blocking follow-up work, note it and ask whether to proceed with implementation anyway, or address the follow-up first.
1. What the feature must do (functional requirements)
2. What the feature must not do or break (constraints and non-goals)
3. Where the code lives (existing file structure, module conventions)
4. What "done" looks like (acceptance criteria or definition of done)

If you are missing 1 or 3 and cannot infer them from the codebase, state what
you need before writing code.

---

## Implementation steps

1. **Survey the codebase** — read the relevant existing files before writing
   anything. Understand naming conventions, patterns, and what already exists.
   Do not reinvent utilities that are already present.

2. **Plan before coding** — write a brief implementation plan (3–7 bullet
   points) and confirm it matches the requirements. Do this before producing
   any code. If the user wants to adjust the plan, do so before implementing.

3. **Implement incrementally** — build the feature in logical units. Complete
   and verify each unit before moving to the next. Do not write the entire
   implementation in one pass if it spans multiple files or concerns.

4. **Follow existing conventions** — match the style, patterns, and
   abstractions of the surrounding code. Do not introduce new patterns unless
   required by the feature. When in doubt, be consistent over clever.

5. **Handle errors and edge cases** — identify inputs that could fail or
   behave unexpectedly. Handle them explicitly. Do not leave unhandled
   exceptions, unvalidated inputs, or silent failures.

6. **Write tests alongside implementation** — for each new function or
   behaviour, write at least one test. Aim for: happy path, one edge case,
   one failure case. If the project has no test suite, note this but still
   write tests — suggest where they should go.

7. **Verify before marking done** — run any available checks (linter, type
   checker, test suite) before declaring the implementation complete. Report
   results. If checks fail, fix them before finishing.

---

## Output format

For each file created or modified, output:

```
### path/to/file.ext

[complete file contents or clearly marked diff]
```

After all files, output a brief implementation summary:

```
## Implementation summary

**What was built:** [one sentence]
**Files changed:** [list]
**Assumptions made:** [list any assumptions, or "None"]
**Tests written:** [list test file(s) and what they cover]
**Checks run:** [linter/type/test results, or "Not run — no toolchain available"]
**Follow-up recommended:** [any deferred work, known gaps, or suggested next steps]
```

---

## Post-Implementation

- If the implementation is related to a supplied task document, mark the task as complete in that document.
- If any actionable follow-ups have been identified:
    1. Determine the feature's location in @docs/features/feature-specifications. If unclear, always ask the user for the true directory.
    2. If there is no 'follow-up-work.md' file in that directory, create one with a brief description of the follow-up work needed, why it was deferred, and any relevant context for future implementation.
    3. If 'follow-up-work.md' already exists, append the new follow-up work to the end of the file, ensuring it is clearly separated from previous entries (e.g., with a date and brief summary).
    4. If a 'follow-up-work.md' file exists for the feature, review it to ensure that any previously identified follow-up work has been addressed or is still relevant. If any items have been resolved, update the file to reflect their completion, including dates and descriptions of the work done.

---

## Constraints

- Do not remove or modify existing functionality unless the spec explicitly
  requires it. If you must touch existing code, explain why.
- Do not add dependencies unless necessary. Prefer the standard library and
  existing project dependencies.
- Do not silently skip requirements. If something in the spec cannot be
  implemented as written, say so explicitly and propose an alternative.
- Keep functions focused. If a function exceeds ~40 lines, consider whether
  it should be split.
- Do not leave TODO comments in code you produce. Either implement it or
  note it in the implementation summary under "Follow-up recommended".
- Always use TDD approaches when possible. Write tests before implementation, and ensure they fail before writing code to pass them. Make sure to check for existing tests that cover the same functionality before writing new ones.

---

## Gotchas

- **Check for existing utilities before writing new ones.** Most codebases
  have helpers for common tasks (date formatting, error handling, HTTP calls).
  Read the codebase before reaching for a new abstraction.
- **Match the test framework in use.** Do not introduce a new test library.
  If no framework is present, note it and write plain assertion-style tests
  that can be adapted.
- **Type annotations matter.** If the codebase uses TypeScript or typed
  Python, all new code must be fully typed. Do not use `any` or `object`
  as a shortcut.
- **Database migrations need care.** If the feature involves schema changes,
  produce a migration file. Do not modify tables inline. Never make a
  migration that could lose data without an explicit warning.

---

## References

- Read `references/patterns.md` if the project has established patterns for
  the type of code you are writing (API endpoints, state management,
  background jobs, etc.).
- Read `references/conventions.md` for project-specific naming, file
  structure, or code style conventions that override general best practices.
