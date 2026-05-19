# Conventions reference

This file is loaded by the `implement-feature` skill on demand when the
agent needs project-specific naming, file structure, or code style conventions.

Fill this in with the actual conventions from your project. Pull from your
existing style guide, linter config comments, or code review feedback.
Conventions that contradict common defaults are the most valuable to document
here — the agent already knows standard practices.

---

## Naming

<!-- File names, variable names, function names, class names, constants.
     Note anything that deviates from language defaults.

Example:
- Files: `kebab-case.ts` for modules, `PascalCase.tsx` for React components
- Variables and functions: `camelCase`
- Classes and types: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Database columns: `snake_case` (Prisma maps these automatically)
- React hooks: prefix with `use`, e.g. `useCurrentUser`
-->

_Not yet documented._

---

## File and directory structure

<!-- Where do different kinds of files live? What is the top-level structure?

Example:
src/
  components/   React components (one file per component)
  hooks/        Custom React hooks
  routes/       Express route handlers
  services/     Business logic (no HTTP or DB concerns)
  lib/          Shared utilities and helpers
  types/        Shared TypeScript types and interfaces
tests/
  integration/  Tests that require a running server or database
-->

_Not yet documented._

---

## Code style

<!-- Anything not covered by the linter config. Patterns that are enforced
     by convention rather than tooling.

Example:
- Prefer `const` over `let`. Never use `var`.
- Use explicit return types on all exported functions.
- Avoid default exports — use named exports everywhere.
- Keep files under 200 lines. Split if larger.
- No inline comments explaining *what* the code does. Comments explain *why*.
-->

_Not yet documented._

---

## Import order and aliasing

<!-- How are imports organized? Are there path aliases?

Example:
Import order (enforced by eslint-plugin-import):
1. Node built-ins
2. External packages
3. Internal packages (using `@/` alias for `src/`)
4. Relative imports

Path alias: `@/` maps to `src/`. Use `@/lib/errors` not `../../lib/errors`.
-->

_Not yet documented._

---

## Git and commit conventions

<!-- Commit message format, branch naming, PR conventions.

Example:
Commits: Conventional Commits format (`feat:`, `fix:`, `chore:`, etc.)
Branches: `<type>/<short-description>` e.g. `feat/user-csv-export`
PRs: one feature per PR; link to the relevant issue or spec in the description.
-->

_Not yet documented._
