# Read-Only UI — Feature Spec

## Overview

A local single-page web dashboard that renders the Saboteur POS briefing, task views, and notes in a browser. It addresses the friction of scanning long lists and following cross-links in a terminal — visual layouts and clicks are faster than repeated CLI invocations. The dashboard is read-only in this phase; the CLI remains the only mutation surface.

## Goals

- Briefing, tasks, and notes are viewable at `http://localhost:9421` without CLI invocation.
- The UI reflects underlying data changes within 1 second of a CLI write, with no manual refresh.
- Reusable components built on shadcn/ui and saboteur-styles tokens are previewable in isolation via Storybook.
- A user can read any task or note end-to-end — dependencies and wiki-links included — without leaving the page.
- Styling derives from saboteur-styles tokens; project-specific styles live in one dedicated CSS file.

## Non-goals

- Mutation of any data through the UI.
- Multi-user, authentication, or remote hosting concerns.
- Mobile or touch optimisation.
- Bundling Storybook into the installed CLI.
- Client-side routing — app state alone determines what renders.

## User stories

- As a POS user, I want to read the morning briefing in a browser so I can scan it faster than in a terminal.
- As a POS user, I want to filter tasks by view (today, active, blocked, etc.) without re-running commands.
- As a POS user, I want to click a task to see its full detail, dependencies, and linked notes.
- As a POS user, I want clicking a wiki-link in a note to open the target note.
- As a POS user, I want the dashboard to update automatically when I make CLI changes.

## Functional requirements

1. `sab ui` MUST start an HTTP server on `127.0.0.1:9421`, print the URL, and exit cleanly; the server runs as a detached background process owned by the user.
2. `sab ui` MUST exit non-zero with a clear message if port 9421 is already in use, taking no other action.
3. The dashboard MUST render three views — Briefing (default), Tasks (with view filters), Notes — within a single page driven by app state, not URL routes.
4. The server MUST read data directly from `saboteur.db` and the notes directory; it MUST NOT shell out to `sab`.
5. The server MUST watch the SQLite file and notes directory and push change events to connected clients over WebSocket within 1 second of a CLI write.
6. No HTTP or WebSocket route MAY mutate state; all data flows are read-only.
7. All visual components MUST be browsable in isolation via Storybook in development; Storybook MUST NOT ship with the installed CLI.
8. Styling MUST consume tokens from `saboteur-works/saboteur-styles`; project-specific styles MUST live in a single dedicated CSS file alongside Tailwind utilities.
9. shadcn/ui primitives SHOULD be used as the base for interactive components before authoring bespoke equivalents.
10. The running server MUST NOT make outbound network requests.
11. The UI MUST be built with Vite, React, and Zustand for state management. WebSocket change events MUST update the Zustand store, which drives view re-renders.

## Open questions

None identified.

## Out of scope (deferred)

- Mutations through the UI (Phase 3).
- Plugin-panel rendering in the dashboard (Phase 2c).
- Repo and commit awareness in the briefing view (Phase 2a).
- Theming, dark mode toggles, accessibility audits beyond shadcn defaults.
- Packaging as a standalone desktop app (Electron/Tauri).
