# Implementation summary template

Copy this into `SKILL.md` or reference it from the output format section.
The agent uses this as the structure for its completion report.

```markdown
## Implementation summary

**What was built:** [one sentence describing the feature]

**Files changed:**

- `path/to/new-file.ts` — created — [one-line description]
- `path/to/modified-file.ts` — modified — [what changed and why]

**Assumptions made:**

- [assumption 1, or "None" if none were made]

**Tests written:**

- `path/to/feature.test.ts` — covers [happy path / edge cases / error cases]

**Checks run:**

- Linter: [passed / N warnings / N errors]
- Type checker: [passed / N errors]
- Tests: [N passed, N failed, or "Not run"]

**Follow-up recommended:**

- [deferred work, known gaps, or suggested next steps, or "None"]
```
