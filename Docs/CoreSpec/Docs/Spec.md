**SABOTEUR**

Personal Operations System

**Full Specification v2**

---

**Status** Draft

**Audience** Internal / Saboteur

**Scope** Full system --- Phase 1 through Phase 4 roadmap

---

**1. Purpose & Scope**

This document is the Phase 1 specification for the Saboteur Personal
Operations System (POS) --- a local-first, CLI-driven command center for
managing tasks, notes, and project contexts across multiple business
domains.

Phase 1 delivers the minimum useful system: a working task and note
manager scoped by context, culminating in a daily briefing that replaces
the habit of opening multiple apps each morning. Git intelligence is
explicitly deferred to Phase 2, but the data schema is designed to
accommodate it from day one.

+-----------------------------------------------------------------------+
| **The Core Principle (unchanged from brainstorm)** |
| |
| Everything must be addressable, linkable, and automatable. If a |
| feature cannot be referenced by ID, composed into another view, or |
| triggered programmatically --- it does not ship. |
+-----------------------------------------------------------------------+

**2. What Is NOT in Phase 1**

The following are explicitly out of scope. They are not forgotten ---
they are deferred to preserve momentum.

- Git / repo intelligence (branches, commits, PR health, stale
  detection)

- Commit-to-task linking

- Weekly briefings

- Lightweight time / effort tracking

- Any UI layer

- Plugin system

- Calendar integrations

- Team or collaboration features

+-----------------------------------------------------------------------+
| **Phase 2 Hook** |
| |
| The data schema includes repo and branch fields on tasks from day |
| one. Wiring Git into them is a Phase 2 concern, not a schema |
| migration. |
+-----------------------------------------------------------------------+

**3. Architecture**

**3.1 Non-Negotiables (Unchanged)**

- Local-first: all data lives on the user\'s file system

- CLI-first: the entire system is operable from the terminal with no
  UI required

- Event-based: every command produces a deterministic, observable
  result

- Composable: complex behavior is always a chain of simple units

- UI is a separate layer: CLI does all work; UI only reads and
  triggers commands

**3.2 Data Storage**

Two storage strategies are used. The choice is deliberate, not
arbitrary.

---

**Entity** **Storage** **Rationale**

Tasks SQLite (saboteur.db) Requires querying, filtering,
state transitions, dependency
resolution. Flat files become
painful fast. SQLite is a single
portable file.

Knowledge (Notes + Markdown + YAML Source of truth is the .md file.
plugins) frontmatter; SQLite SQLite index is a multi-source
index knowledge index --- personal
notes in Phase 1, plugin sources
(Omoikane etc.) added later. Each
indexed entry carries a source_id
and type.

Config saboteur.config.json Single file defining all paths.
Portable --- copy config + db +
notes dir to resume on a new
machine. Never contains
credentials.

Secrets saboteur.secrets.json Plugin credentials only.
Explicitly gitignored. Never
copied during machine migration
--- must be recreated. Path
referenced in config via
secrets_path. macOS Keychain is a
stretch goal.

---

**3.3 Portability**

To move the entire system to a new machine, copy three things and run
one command:

- saboteur.config.json

- saboteur.db

- The notes directory (path defined in config)

> sab init \--config /path/to/saboteur.config.json

Credentials (saboteur.secrets.json) are explicitly excluded from
migration. They must be recreated on the new machine. Plugin-registered
knowledge sources (e.g. Omoikane repos) must also be re-pointed if their
paths differ on the new machine.

**3.4 Mental Model**

> \[ Core Engine \]
>
> ├── Data Layer ← SQLite (tasks) + Markdown (notes) + config
>
> ├── State Machine ← task lifecycle
>
> ├── Event System ← every command emits a deterministic event
>
> └── CLI Interface ← primary control surface
>
> \[ UI Layer \] ← Phase 2+. Reads CLI output only.

**4. Data Model**

**4.1 Task Schema**

All fields marked \* are required at creation. Fields marked □ are
nullable placeholders for Phase 2 Git integration.

---

**Command** **Description**

id \* Stable UUID. Never changes. Used for all
cross-references.

title \* Short description of the work.

state \* Enum: backlog \| active \| blocked \| review \| done

context \* Foreign key to Context. Every task belongs to a
context.

priority Enum: critical \| high \| normal \| low. Default:
normal.

energy Enum: deep \| shallow \| admin. Maps to focus
required.

effort Enum: xs \| s \| m \| l \| xl. Estimated size.

blocks Array of task IDs this task blocks.

blocked_by Array of task IDs blocking this task.

note_id Optional linked note ID.

repo □ Repo name. Set manually in Phase 1; auto-detected in
Phase 2.

branch □ Branch name. Same as repo --- Phase 2 wiring.

created_at Timestamp. Auto-set.

updated_at Timestamp. Auto-updated on any state change.

state_history JSON array of {state, timestamp} objects. Enables
cycle time.

---

**4.2 Note Schema (YAML Frontmatter)**

Each note is a .md file. The frontmatter is the structured record; the
body is freeform Markdown.

> \-\--
>
> id: note_abc123 \# stable UUID
>
> title: Auth Flow Thoughts
>
> tags: \[auth, backend\]
>
> task_id: task_xyz789 \# optional link to a task
>
> context: varsentry
>
> created_at: 2026-03-25
>
> updated_at: 2026-03-25
>
> \-\--
>
> \# Your markdown content here\...

**4.3 Context Schema**

A context is a named filter scope. It is lightweight by design.

---

**Command** **Description**

id \* Stable slug. Used as the context key (e.g. varsentry).

name \* Display name.

description Optional. One sentence.

repos Array of repo names associated with this context
(Phase 2).

created_at Timestamp.

---

**4.4 Config Schema (saboteur.config.json)**

> {
>
> \"version\": \"1\",
>
> \"db_path\": \"\~/saboteur/saboteur.db\",
>
> \"secrets_path\": \"\~/saboteur/saboteur.secrets.json\", // never
> copied on migration
>
> \"repos_dir\": \"\~/code\", // Phase 2a --- defined now, unused in P1
>
> \"active_context\": \"varsentry\",
>
> \"briefing\": {
>
> \"stale_task_days\": 3, // tasks active \> N days trigger stale flag
>
> \"provider_timeout_ms\": 2000 // Phase 2c+ --- max wait per plugin
> provider
>
> },
>
> \"sources\": \[ // knowledge index sources
>
> {
>
> \"id\": \"personal-notes\",
>
> \"type\": \"note\",
>
> \"path\": \"\~/saboteur/notes\",
>
> \"owner\": \"core\",
>
> \"enabled\": true
>
> }
>
> // plugins append their own sources here on enable
>
> \]
>
> }

**4.5 Knowledge Index Schema (SQLite)**

The knowledge index is a multi-source table in SQLite. In Phase 1 it
contains only personal notes. Plugin sources are added in Phase 2c
without schema migration.

---

**Command** **Description**

id \* Stable UUID matching the entry\'s frontmatter id.

source_id \* Foreign key to the sources registry (e.g.
personal-notes, omoikane-auth).

type \* Enum: note \| omoikane. Extensible by plugins.

title Extracted from frontmatter.

tags JSON array. Extracted from frontmatter.

task_id Linked task UUID if present in frontmatter.

context Context slug from frontmatter or source default.

path Absolute path to the source .md file.

created_at From frontmatter.

updated_at From frontmatter. Used by briefing for yesterday\'s
entries.

---

**4.6 Sources Registry Schema (SQLite)**

Tracks all registered knowledge sources. Core registers personal-notes
on sab init. Plugins register and deregister their own sources.

---

**Command** **Description**

id \* Unique slug (e.g. personal-notes, omoikane-auth).

type \* Enum: note \| omoikane. Matches knowledge index type.

path \* Absolute path to the source directory.

owner \* Enum: core \| plugin. Core-owned sources cannot be
deleted by plugins.

context Optional. If set, source only appears when this
context is active.

enabled Boolean. Disabled sources are not scanned or queried.

---

**5. Feature Specifications**

**5.1 Tasks**

**State Machine**

The task lifecycle is a formal state machine. Transitions outside of the
defined paths are rejected.

> backlog → active → blocked → active (unblocked)
>
> active → review → done
>
> active → backlog (deprioritized)
>
> any → blocked (blocked state can be set from anywhere)

**Derived Views**

Views are always derived from queries --- never manually curated lists.

---

**View** **Query Definition**

today state = active, ordered by priority desc, energy desc

active state = active

backlog state = backlog

blocked state = blocked

review state = review

deep-work state = active AND energy = deep AND blocked_by is
empty

stale state = active AND updated_at \< now - stale_task_days

---

**5.2 Notes**

Notes are Markdown files with YAML frontmatter. The CLI manages creation
and indexing. The file system is the source of truth.

- Creating a note opens the user\'s \$EDITOR with a pre-populated
  frontmatter template

- The note index in SQLite is rebuilt on sab sync or automatically on
  each command

- Wiki-style links use the note ID: \[\[note_abc123\]\] or a slug:
  \[\[auth-flow-thoughts\]\]

- Querying filters by tag, context, or linked task ID

**5.3 Contexts**

A context is the active lens for all commands. Once set, all task and
note queries automatically scope to it unless \--all is passed.

- sab context use varsentry --- sets active context, persisted to
  config

- sab context list --- shows all contexts with task counts

- All commands respect active context by default

- \--all flag bypasses context filter for any command

+-----------------------------------------------------------------------+
| **Why context is in Phase 1** |
| |
| Context is cheap to implement now and high-value for the primary |
| friction point: switching between business domains (Saboteur, |
| Varsentry, etc). Without it, the tool is useful for one project. With |
| it, it becomes the single command center. |
+-----------------------------------------------------------------------+

**The inbox Context**

inbox is a reserved, built-in context created automatically on sab init.
It cannot be deleted. It serves two purposes:

- Default landing zone --- any task or note created without an
  explicit \--context flag is assigned to inbox automatically

- Capture without friction --- no decision required at creation time;
  sort it later

inbox items surface in the daily briefing as a distinct section at the
top: \"X unsorted items in inbox.\" This creates a lightweight triage
habit without enforcing it.

> sab task add \"Random idea\" \# lands in inbox
>
> sab task add \"Fix auth\" \--context varsentry \# explicit context
>
> sab task move \<id\> \--context varsentry \# graduate out of inbox

**Deleting a Context**

sab context delete \<slug\> follows a safe-by-default deletion policy.
inbox cannot be deleted under any circumstances.

- If the context has tasks or notes attached, deletion is refused by
  default

- The refusal message lists counts: \"varsentry has 12 tasks and 4
  notes. Reassign or use \--force.\"

- \--reassign \<slug\> migrates all attached items to another context,
  then deletes

- \--force deletes the context and orphans its items back to inbox

> sab context delete old-project \# refused if items exist
>
> sab context delete old-project \--reassign varsentry \# migrate then
> delete
>
> sab context delete old-project \--force \# orphan to inbox, then
> delete

+-----------------------------------------------------------------------+
| **Why refuse by default** |
| |
| Accidentally deleting a context with 40 tasks is a bad morning. The |
| default refusal costs one extra command in the rare case you actually |
| want deletion. \--force exists for the intentional case; it orphans |
| to inbox rather than destroying records. |
+-----------------------------------------------------------------------+

**5.4 Daily Briefing**

The briefing is the proof-of-value for Phase 1. It is a read-only,
derived view that composes data from tasks and notes into situational
awareness. Running sab briefing each morning replaces opening multiple
apps.

Output sections (in order):

- Inbox --- unsorted items across all contexts needing assignment
  (always shown first, even when a context is active)

- Context --- currently active context

- Active tasks --- tasks in state: active, sorted by priority

- Stale tasks --- active tasks with no state change in \> N days (N
  from config)

- Blocked tasks --- tasks in state: blocked, with their blocking
  dependencies listed

- In review --- tasks awaiting review

- Yesterday\'s notes --- notes created or modified in the last 24
  hours

The briefing has no Git data in Phase 1. It is still genuinely useful
without it. When Phase 2 ships, the following sections are added without
changing the briefing\'s structure:

- Repos with uncommitted changes

- PRs awaiting action

- Tasks with no commits in N days

**6. CLI Grammar**

**6.1 Structure**

All commands follow the noun-verb pattern. This is intentional --- as
the command surface grows, grouping by noun makes shell autocomplete
useful and the mental model consistent.

> sab \<noun\> \<verb\> \[target\] \[flags\]

Rationale: sab task \<TAB\> surfaces all task operations. Verb-first
(sab add task) reads naturally but does not scale --- you must remember
verbs, not domains.

**6.2 Task Commands**

---

**Command** **Description**

sab task add Create a new task. Prompts for priority/energy/effort
\<title\> if not flagged.

sab task list List tasks in current context. Respects active view
filter.

sab task view Show full task detail including state history and
\<id\> linked note.

sab task move Transition task to new state. Validates against state
\<id\> \<state\> machine.

sab task edit Open task metadata in \$EDITOR.
\<id\>

sab task done Shorthand for sab task move \<id\> done.
\<id\>

sab task block Shorthand for sab task move \<id\> blocked.
\<id\>

sab task link Link a note to a task.
\<id\> \--note  
 \<note_id\>

sab task link Add a dependency: this task blocks another.
\<id\> \--blocks
\<id\>

---

Common flags (apply to most task commands):

- \--context \<ctx\> override active context for this command

- \--priority \<p\> critical \| high \| normal \| low

- \--energy \<e\> deep \| shallow \| admin

- \--effort \<e\> xs \| s \| m \| l \| xl

- \--all bypass context filter

- \--view \<v\> apply a derived view filter (today, deep-work, stale,
  etc.)

**6.3 Note Commands**

---

**Command** **Description**

sab note new Create a new note. Opens \$EDITOR with pre-populated
\<title\> frontmatter.

sab note list List notes in current context.

sab note view Print note to terminal.
\<id\>

sab note edit Open note in \$EDITOR.
\<id\>

sab note find Filter notes by tag.
\--tag \<tag\>

sab note find Find notes linked to a task.
\--task \<id\>

---

**6.4 Context Commands**

---

**Command** **Description**

sab context list List all contexts with task and note counts.

sab context new Create a new context.
\<slug\>

sab context use Set active context. Persists to config.
\<slug\>

sab context show Print currently active context.

sab context Delete a context. Refused if items exist unless
delete \<slug\> \--reassign or \--force is passed.

sab context Migrate all items to another context, then delete.
delete \<slug\>  
 \--reassign  
 \<slug\>

sab context Orphan all items to inbox, then delete. inbox itself
delete \<slug\> cannot be deleted.
\--force

---

**6.5 System Commands**

---

**Command** **Description**

sab briefing Run the daily briefing for the active context.

sab ui Start the local React dashboard on port 9421. (Phase
2b)

sab ui stop Stop the local React dashboard. (Phase 2b)

sab plugin list List all plugins and their enabled status. (Phase 2c)

sab plugin Enable a plugin. (Phase 2c)
enable \<name\>

sab plugin Disable a plugin. (Phase 2c)
disable \<name\>

sab sync Rebuild the notes index from the file system.

sab init Initialize a new Saboteur workspace.

sab init Initialize from an existing config file (machine
\--config migration).
\<path\>

sab status Print config, active context, and DB path.

---

**7. Build Sequence**

Each layer is a dependency of the next. Do not skip ahead --- the
briefing is only as good as the data beneath it.

---

**\#** **Layer** **Deliverable / Done When**

**1** **Data Model + Schema defined, DB initialized, config file
Config** read/written correctly. sab init works.

**2** **Tasks --- CRUD + Can create, view, list, and transition
State Machine** tasks. State machine rejects invalid
transitions. All fields present including
Phase 2 stubs.

**3** **Contexts** Can create contexts, set active context,
and all task commands respect it. \--all
flag bypasses.

**4** **Derived Task sab task list \--view today / deep-work /
Views** stale all return correct filtered results.

**5** **Notes --- CRUD + Can create, view, edit notes. Frontmatter
Linking** correctly parsed. Links between notes and
tasks work.

**6** **Daily Briefing** sab briefing outputs all 5 sections
correctly for the active context. This is
the Phase 1 done signal.

---

+-----------------------------------------------------------------------+
| **Phase 1 Done Signal** |
| |
| sab briefing runs each morning and accurately reflects the state of |
| active work across all contexts. That single habit is the proof that |
| Phase 1 delivered. |
+-----------------------------------------------------------------------+

**8. Plugin Architecture**

Plugins are optional data providers. They extend what the system knows,
not how the system works. Core functionality is never modified by a
plugin --- disabling any plugin leaves the system fully operational.

**8.1 The Data Provider Model**

Plugins register as providers for a named data slot. Core features ---
primarily the briefing --- request data from named slots. If a provider
exists for that slot, the data renders. If not, the section is silently
omitted. Core never has a hard dependency on any plugin.

> // Plugin registers a named slot
>
> plugin.provides(\'gcp_service_health\')
>
> // Briefing requests the slot --- renders if available, skips if not
>
> briefing.section(\'GCP Health\',
> providers.get(\'gcp_service_health\'))

+-----------------------------------------------------------------------+
| **Why data provider over event hooks** |
| |
| Event hooks let plugins react to system actions --- useful for |
| notifications and side effects. But the briefing needs to compose |
| plugin data into its output, not just be notified that something |
| happened. Data providers solve this cleanly: core defines the slots, |
| plugins fill them, the briefing renders what exists. |
+-----------------------------------------------------------------------+

**8.2 Plugin Contract**

Every plugin must satisfy the following contract to be loadable by the
system:

- Declares a unique name and the data slots it provides

- Exposes an async fetch(context) method that returns structured data
  or null

- Respects the provider_timeout_ms config value --- must resolve or
  reject within the timeout

- Returns null on timeout or failure --- never throws into core

- Never modifies core data --- read-only access to the DB and
  filesystem

- Handles its own auth, credentials, and network failures gracefully

- Declares whether it requires network access (enforces local-first
  guarantee)

- Reads credentials from saboteur.secrets.json via the plugin API ---
  never from config

The briefing requests all provider slots concurrently with
Promise.allSettled(). Each slot has its own timeout. A slow or failed
provider produces a null result and its section is omitted --- the
briefing never blocks on any single provider.

> // Briefing fetch pattern (pseudocode)
>
> const results = await Promise.allSettled(
>
> providers.map(p =\> withTimeout(p.fetch(context), timeout_ms))
>
> )
>
> // Each result is rendered if resolved, silently omitted if
> null/rejected

**8.3 Plugin Tiers**

Three tiers of plugins are planned across the roadmap. Tier determines
when the plugin system must support them, not their importance.

---

**Tier** **Network** **Examples**

**Local** No Local AI summarization via LM Studio,
Omoikane knowledge read

**Remote Yes GitHub / GitLab PR data, npm package
--- Dev** insights

**Remote Yes GCP service health, Cloud Run status, Error
--- Infra** Reporting

---

**9. UI Layer**

The UI is a read-only React dashboard that runs as a local server. It is
a consumer of the same data the CLI uses --- not a wrapper around the
CLI. UI breakage is never a system failure.

**9.1 Principles**

- Read-only in Phase 2. No task creation, no state transitions, no
  editing through the UI.

- All mutations happen in the terminal. The UI reflects state; it does
  not change it.

- Reads directly from SQLite and the notes directory --- not by
  parsing CLI output.

- Runs on a fixed local port: 9421.

- Started with sab ui. The POS starts the server and confirms success
  or failure, then exits. Process management (keeping it running,
  starting on login) is the user\'s responsibility.

- sab ui is idempotent --- if already running on 9421, reports status
  and exits cleanly.

- Auto-refreshes on a configurable interval (default: 30s). Manual
  refresh always available.

**9.2 Phase 2 Views (Read-Only)**

The Phase 2 UI renders three views and nothing else:

- Briefing --- the daily briefing rendered as a readable page. This is
  the default view on open.

- Tasks --- task list for the active context with derived view filters
  (today, blocked, stale, deep-work). Click a task to expand detail
  and linked note.

- Notes --- note list for the active context. Click to read. No
  editing.

+-----------------------------------------------------------------------+
| **The right mental model for the Phase 2 UI** |
| |
| A morning newspaper. You open it, you read it, you close it and act |
| in the terminal. It is a more digestible rendering of sab briefing, |
| not a replacement for the CLI. |
+-----------------------------------------------------------------------+

**9.3 Phase 3 UI Additions**

Write capabilities are deferred to Phase 3, after the read layer is
proven stable. Phase 3 UI additions:

- Task creation and state transitions

- Note creation and editing

- Context switching via UI

- Plugin data panels (GCP health, npm, PR status)

**10. Full Roadmap**

Each phase builds on the last. Phases are not arbitrary groupings ---
each has a clear done signal that gates the next.

**Phase 1 --- Foundation**

Done signal: sab briefing runs every morning and accurately reflects the
state of active work across all contexts.

- Data model + config (SQLite + Markdown + saboteur.config.json)

- Tasks: CRUD, state machine, derived views

- Contexts: scoping, inbox as reserved default, safe deletion

- Notes: CRUD, frontmatter, wiki-style linking

- Daily briefing: composites all Phase 1 data

**Phase 2a --- Local Git Core**

Done signal: sab briefing includes accurate repo and commit data. No
network required.

- Scan repos directory, list repos and branches

- Detect uncommitted changes per repo

- Parse commit messages for task IDs --- auto-link commits to tasks

- Stale branch detection (configurable threshold)

- Briefing gains: repos with changes, tasks with no commits in N days

- Weekly briefing: what shipped (from state_history), what stalled,
  time allocation by repo/context

+-----------------------------------------------------------------------+
| **Implementation note: weekly briefing** |
| |
| The daily briefing is stateless --- it reads current data. The weekly |
| briefing is not. \'What shipped\' derives from state_history (already |
| in schema). \'Time allocation by repo\' requires aggregating git |
| activity over a window. \'What stalled\' requires comparing state at |
| two points in time. Budget accordingly --- the weekly briefing is |
| meaningfully more complex than it appears. |
+-----------------------------------------------------------------------+

**Phase 2b --- Read-Only UI**

Done signal: sab ui starts a local dashboard that renders the briefing,
task list, and notes accurately. Refreshes automatically.

- React server on port 9421

- Reads directly from SQLite and notes directory --- no CLI parsing

- Views: Briefing, Tasks (with derived view filters), Notes

- Read-only. All mutations remain in the CLI.

- sab ui starts the server, confirms success or failure, and exits.
  Process lifecycle is the user\'s responsibility.

**Phase 2c --- Plugin Architecture + Local Plugins**

Done signal: plugin system is live, at least two local plugins are
operational, and the briefing renders their data conditionally.

- Data provider plugin contract defined and enforced

- Plugin loader: reads plugin registry from config, validates
  contract, fails gracefully

- Local AI summarization plugin via LM Studio --- weekly briefing
  narrative, stale task explanations

- Omoikane read plugin --- index Omoikane knowledge entries, link to
  tasks and notes, surface in briefing

- sab plugin list / sab plugin enable / sab plugin disable commands

**Phase 3 --- Remote Plugins + Write UI**

Done signal: briefing includes remote data from at least one provider.
UI supports task and note mutations.

- GitHub / GitLab plugin: PR health, time open, CI status

- npm plugin: download trends, open issues, version drift between
  local and published

- GCP plugin: Cloud Run service health, recent deploy status, Error
  Reporting signal

- Hosted AI summarization as alternative to local LM Studio provider

- UI write capabilities: task creation, state transitions, note
  editing, context switching

- UI plugin panels: each remote plugin gets a briefing panel in the UI

**Phase 4 --- Omoikane Command Integration + Polish**

Done signal: the POS can issue research tasks to Omoikane and surface
results without leaving the system.

- sab omoikane query \<topic\> --- issue a research query, results
  linked back as notes

- sab omoikane task \<id\> --- trigger a research task from an
  existing POS task

- Full weekly briefing with AI narrative summary

- OSS readiness review: documentation, onboarding, config
  generalization

+-----------------------------------------------------------------------+
| **What stays constant across all phases** |
| |
| The CLI is always the primary control surface. The data model does |
| not require migration between phases --- schema stubs are in place |
| from Phase 1. UI breakage is never a system failure. Plugins are |
| always optional. The local-first guarantee is never compromised. |
+-----------------------------------------------------------------------+

Saboteur POS --- Full Specification v2
