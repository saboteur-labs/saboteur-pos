# Read-Only UI — Implementation Tasks

### Task 1: Scaffold UI package

**What:** Create a `ui/` workspace with Vite + React + TypeScript + Zustand, plus an npm script to run the dev server.
**Files:** `ui/package.json`, `ui/vite.config.ts`, `ui/tsconfig.json`, `ui/index.html`, `ui/src/main.tsx`, `ui/src/App.tsx`, root `package.json` (workspaces or postinstall hook)
**Done when:** `npm --prefix ui run dev` serves a hello-world React page at `http://localhost:5173` and Zustand is importable.
**Depends on:** none
**Estimate:** 2
**Done:** [x]

### Task 2: Wire Tailwind + saboteur-styles tokens

**What:** Install Tailwind in the UI package, import `saboteur-works/saboteur-styles` tokens, and create the single project CSS file that layers on top.
**Files:** `ui/tailwind.config.ts`, `ui/postcss.config.cjs`, `ui/src/styles/tokens.css` (imports saboteur-styles), `ui/src/styles/app.css` (project-specific overrides), `ui/src/main.tsx`
**Done when:** A Tailwind utility renders correctly in the dev page, a saboteur-styles token (e.g. a color variable) is visible via DevTools, and `app.css` is the only file with bespoke project styles.
**Depends on:** 1
**Estimate:** 2
**Notes:** Satisfies spec req #8.
**Done:** [x]

### Task 3: Install and configure shadcn/ui

**What:** Initialize shadcn/ui in the UI package and add the primitives needed for views (Button, Card, ScrollArea, Tabs, Separator at minimum).
**Files:** `ui/components.json`, `ui/src/components/ui/*`
**Done when:** A shadcn `Button` imported into `App.tsx` renders with project tokens applied.
**Depends on:** 2
**Estimate:** 1
**Notes:** Satisfies spec req #9.
**Done:** [x]

### Task 4: Set up Storybook

**What:** Install Storybook in the UI package wired to the project's Tailwind + tokens, and add `npm run storybook` (dev-only).
**Files:** `ui/.storybook/main.ts`, `ui/.storybook/preview.ts`, `ui/package.json` scripts, `ui/src/components/ui/Button.stories.tsx` (smoke story)
**Done when:** `npm --prefix ui run storybook` opens Storybook with the shadcn Button story rendered using project styles. Storybook artifacts are not produced by the CLI build.
**Depends on:** 3
**Estimate:** 2
**Notes:** Satisfies spec req #7. Confirm Storybook deps are devDependencies only.
**Done:** [5]

### Task 5: Add `sab ui` command with lifecycle and port check

**What:** Implement `sab ui` in the CLI: bind-check `127.0.0.1:9421`, spawn the server detached, print the URL, exit cleanly. Non-zero exit with a clear message if the port is in use.
**Files:** `src/commands/ui.ts`, `src/index.ts` (register command)
**Done when:** Running `sab ui` twice in a row: first prints `http://127.0.0.1:9421` and exits 0; second exits non-zero with "port 9421 already in use". Server process keeps running after the CLI exits.
**Depends on:** 1
**Estimate:** 3
**Notes:** Satisfies spec reqs #1, #2. Use `net.createServer().listen()` probe for the port check; spawn via `child_process.spawn` with `detached: true, stdio: 'ignore'` then `unref()`.
**Done:** [x]

### Task 6: Read-only data access layer for UI server

**What:** Build a module the UI server uses to query tasks, briefing, and notes directly from `saboteur.db` and the notes directory — reusing existing DB and note helpers, not shelling out to `sab`.
**Files:** `ui/server/data/tasks.ts`, `ui/server/data/notes.ts`, `ui/server/data/briefing.ts`
**Done when:** Each module returns plain-object data for the equivalent CLI command, verified by unit tests against a fixture DB.
**Depends on:** 1
**Estimate:** 3
**Notes:** Satisfies spec req #4. Import from `src/` where possible to avoid drift; expose only read paths.
**Done:** [x]

### Task 7: JSON API endpoints

**What:** HTTP server exposing `GET /api/briefing`, `GET /api/tasks?view=<name>`, `GET /api/notes`, `GET /api/notes/:id` — all read-only.
**Files:** `ui/server/http.ts`, `ui/server/routes.ts`
**Done when:** Each endpoint returns JSON matching the data layer output for fixture data; any non-GET method returns 405.
**Depends on:** 6
**Estimate:** 3
**Notes:** Satisfies spec reqs #3 (view filters), #6 (no mutations).
**Done:** [x]

### Task 8: File watcher for DB + notes directory

**What:** Watch `saboteur.db` and the notes directory; emit a typed change event (`tasks` | `notes` | `briefing`) on change, debounced to 250ms.
**Files:** `ui/server/watch.ts`
**Done when:** Touching `saboteur.db` emits one `tasks` event within 500ms; creating a `.md` file emits one `notes` event; rapid changes coalesce into one event.
**Depends on:** 6
**Estimate:** 2
**Notes:** Use `chokidar` or `fs.watch`. Debounce protects against SQLite WAL churn.
**Done:** [x]

### Task 9: WebSocket channel pushing change events

**What:** WebSocket endpoint at `/ws` that broadcasts watcher events to all connected clients; ignores any inbound message.
**Files:** `ui/server/ws.ts`, `ui/server/http.ts` (mount)
**Done when:** Two `wscat` clients both receive a `{type:"tasks"}` message within 1s of a fixture DB write; inbound text from a client triggers no server-side action.
**Depends on:** 7, 8
**Estimate:** 2
**Notes:** Satisfies spec reqs #5, #6. Use the `ws` package.
**Done:** []

### Task 10: Zustand store + WebSocket client

**What:** Frontend store holding `briefing`, `tasks`, `notes`, `selectedView`, `selectedNoteId`; initial-load fetchers; WebSocket client that re-fetches the relevant slice on each event.
**Files:** `ui/src/state/store.ts`, `ui/src/state/api.ts`, `ui/src/state/socket.ts`
**Done when:** Mounting `App` populates the store from the API; writing to the fixture DB updates the store within 1s without a page reload.
**Depends on:** 7, 9
**Estimate:** 3
**Notes:** Satisfies spec req #11.
**Done:** []

### Task 11: Reusable presentational components in Storybook

**What:** Build `TaskCard`, `TaskList`, `NoteCard`, `NoteList`, `ViewSelector`, `BriefingSection`, `WikiLink`, `EmptyState` — each with a Storybook story covering primary states.
**Files:** `ui/src/components/TaskCard.{tsx,stories.tsx}`, `ui/src/components/TaskList.{tsx,stories.tsx}`, `ui/src/components/NoteCard.{tsx,stories.tsx}`, `ui/src/components/NoteList.{tsx,stories.tsx}`, `ui/src/components/ViewSelector.{tsx,stories.tsx}`, `ui/src/components/BriefingSection.{tsx,stories.tsx}`, `ui/src/components/WikiLink.{tsx,stories.tsx}`, `ui/src/components/EmptyState.{tsx,stories.tsx}`
**Done when:** Each component renders in Storybook with at least one story per primary state (e.g. loaded, empty, blocked-task variant) and consumes only shadcn primitives + project tokens.
**Depends on:** 3, 4
**Estimate:** 5
**Notes:** No live data here — props only. Built before views so views just compose.
**Done:** []

### Task 12: App shell with state-driven view switching

**What:** Top-level layout that renders Briefing / Tasks / Notes based on `selectedView` from the store, with persistent navigation chrome — no client-side router.
**Files:** `ui/src/App.tsx`, `ui/src/components/AppShell.tsx`
**Done when:** Clicking nav items swaps the rendered view; the URL never changes; refresh restores the default Briefing view.
**Depends on:** 10, 11
**Estimate:** 2
**Notes:** Satisfies spec req #3 (single page, state-driven).
**Done:** []

### Task 13: Briefing view

**What:** Compose `BriefingSection` components against `store.briefing` to render all sections in spec order.
**Files:** `ui/src/views/BriefingView.tsx`
**Done when:** Briefing view matches the CLI `sab briefing` output for the same fixture data, with empty sections omitted.
**Depends on:** 12
**Estimate:** 2
**Done:** []

### Task 14: Tasks view with view filters

**What:** `TaskList` driven by `store.tasks` plus a `ViewSelector` that updates `selectedView` and triggers the API refetch with `?view=`.
**Files:** `ui/src/views/TasksView.tsx`
**Done when:** Switching between `today / active / backlog / blocked / review / deep-work / stale` updates the displayed list to match the API response for each view.
**Depends on:** 12
**Estimate:** 3
**Done:** []

### Task 15: Notes view with click-to-read and wiki-link navigation

**What:** Two-pane Notes view: `NoteList` on the left, selected note body on the right; clicking a `WikiLink` in the body sets `selectedNoteId` to the target.
**Files:** `ui/src/views/NotesView.tsx`, `ui/src/components/NoteBody.tsx`
**Done when:** Selecting a note renders its body; clicking a wiki-link to an existing note swaps the right pane to that note; broken wiki-links render disabled.
**Depends on:** 12
**Estimate:** 3
**Done:** []

### Task 16: `sab ui` serves built bundle from disk

**What:** Wire the CLI to build the UI bundle (or consume a prebuilt one) and have the server serve static assets from `ui/dist/` at `/`, alongside `/api` and `/ws`.
**Files:** `src/commands/ui.ts`, `ui/server/http.ts`, root `package.json` build script
**Done when:** After `npm run build`, `sab ui` serves the production UI at `http://127.0.0.1:9421/` with the API and WebSocket both reachable. No file is fetched from a remote origin at runtime.
**Depends on:** 5, 7, 9, 13, 14, 15
**Estimate:** 2
**Notes:** Satisfies spec reqs #1, #10.
**Done:** []

### Task 17: Verify no outbound network requests

**What:** Add a smoke test (or documented manual check) that confirms the running server makes no outbound network requests during a full session.
**Files:** `ui/server/__tests__/no-network.test.ts` or `Docs/feature-specs/read-only-ui/manual-checks.md`
**Done when:** Test/check passes with the server running and all three views exercised; any outbound request fails the check.
**Depends on:** 16
**Estimate:** 1
**Notes:** Satisfies spec req #10. Network blocking can be done with `nock.disableNetConnect()` or by intercepting `undici`.
**Done:** []

## Summary

- Total tasks: 17
- Total estimated effort: 41 points
- Critical path: Tasks 1 → 2 → 3 → 4 → 11 → 12 → 14 → 16 → 17 (28 points)
- Risks:
    - **Task 8** (file watcher) — SQLite WAL/journal churn may produce noisy events; debounce strategy needs validation against a real workload.
    - **Task 11** (component library) — largest single task; consider splitting into 11a (cards + lists) and 11b (briefing + wiki-link + empty state) if it overflows a session.
    - **Task 16** (bundle serving) — has the most upstream dependencies; any slip in views or server blocks the integration milestone.
