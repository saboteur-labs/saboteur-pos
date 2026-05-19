# Patterns reference

This file is loaded by the `implement-feature` skill on demand when the
agent needs project-specific implementation patterns.

Fill this in with the patterns your project actually uses. The more specific
and project-grounded this file is, the more useful the skill becomes.
Generic advice ("use clean architecture") is less useful than concrete
patterns ("API route handlers live in `src/routes/`, each file exports a
single router, errors are thrown as `AppError` instances from
`src/lib/errors.ts`").

---

## API / route handlers

<!-- How are routes structured? Where do they live? What do they return?
     What error format do they use?

Example:
Routes live in `src/routes/<resource>.ts`. Each file exports a single
Express Router. Handlers call service functions from `src/services/`.
Errors are thrown as `AppError` with a `statusCode` and `message`. The
global error handler in `src/middleware/errorHandler.ts` formats responses.
-->

_Not yet documented._

---

## State management

<!-- How is state managed in the frontend (if applicable)?
     Redux slices? Zustand stores? React context? Server state via React Query?

Example:
Server state: React Query with hooks in `src/hooks/use<Resource>.ts`.
Local UI state: `useState` or `useReducer` in the component.
No Redux — do not introduce it.
-->

_Not yet documented._

---

## Background jobs / workers

<!-- How are async jobs run? Queue library? Cron? Worker threads?

Example:
Jobs use BullMQ. Queue definitions are in `src/queues/`.
Job processors are in `src/workers/<job-name>.worker.ts`.
Each worker exports a single `process` function.
-->

_Not yet documented._

---

## Database access

<!-- ORM, query builder, or raw SQL? Migration tool? Connection pooling?

Example:
Prisma ORM. Schema is in `prisma/schema.prisma`.
Migrations: `npx prisma migrate dev --name <description>`.
Never use `prisma.$queryRaw` for user-supplied values — use parameterized
Prisma queries.
-->

_Not yet documented._

---

## Testing patterns

<!-- Test framework, file location conventions, fixture patterns, mocking
     approach.

Example:
Jest + ts-jest. Test files are colocated: `src/utils/parseDate.test.ts`.
Mocks live in `src/__mocks__/`. Use `jest.mock()` for module-level mocks.
Integration tests are in `tests/integration/` and use a real test database
seeded by `tests/fixtures/seed.ts`.
-->

_Not yet documented._

---

## Error handling

<!-- How are errors classified, thrown, and formatted?

Example:
All application errors extend `AppError` from `src/lib/errors.ts`.
Field validation errors use `ValidationError` (a subclass of `AppError`).
Unexpected errors are logged and re-thrown as a generic 500 `AppError`.
Never expose raw error messages or stack traces to API consumers.
-->

_Not yet documented._
