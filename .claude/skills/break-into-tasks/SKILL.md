---
name: break-into-tasks
description: Breaks a feature specification into an implementation task list. The output is a markdown document suitable for review, task tracking, and as context for an implementation skill or prompt.
argument-hint: feature spec, granularity
---

Break the following feature spec into an implementation task list.

Spec:
$1

Granularity: $2

Rules for each task:

1. Each task must be executable in a single focused session — one concern,
   one area of the codebase, one logical unit of work.
2. Each task must have a clear done condition: a specific, verifiable state
   that is unambiguously true or false.
3. Tasks must be ordered by dependency — a task that depends on another
   comes after it.
4. Do not create tasks for things outside the spec's functional requirements.
   Non-goals stay non-goals.

Output format — one entry per task:

### Task N: [short title]

**What:** [one sentence — what this task produces]
**Files:** [files to create or modify, or "TBD if unknown"]
**Done when:** [specific, verifiable condition]
**Depends on:** [task numbers this task requires, or "none"]
**Estimate:** [$2 — your estimate for this task]
**Notes:** [assumptions, risks, or implementation hints. Omit if none.]

After the task list, add:

## Summary

- Total tasks: N
- Total estimated effort: [sum]
- Critical path: [the sequence of dependent tasks that determines minimum
  elapsed time, e.g. "Tasks 1 → 3 → 5 → 6"]
- Risks: [any tasks with high uncertainty or dependency risk]
