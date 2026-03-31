# Saboteur POS — Color Palette

> Defines the full color system for `sab` CLI output.
> All output targets 256-color terminals. Primary targets: iTerm2 and VSCode integrated terminal.

---

## Design Principles

1. **Color signals meaning. Gray handles structure.** Six hues are used, each tied to a distinct semantic domain. Chrome (dividers, labels, IDs, timestamps) is always grayscale.
2. **Minimal surface area.** Hues are reserved — do not use a color outside its defined role.
3. **Default terminal color is a valid choice.** When something carries no special meaning, it inherits the terminal default. Don't assign color for its own sake.

---

## Hues

Six hues. Each owns a specific semantic domain.

| Token | 256-code | Hex | Domain |
|---|---|---|---|
| `hue.green` | `72` | `#5FAF5F` | Creation success, `done` task state |
| `hue.red` | `167` | `#D75F5F` | Errors, command failures, `critical` priority |
| `hue.amber` | `214` | `#FFAF00` | `blocked` state, `high` priority, stale warnings |
| `hue.cyan` | `38` | `#00AFD7` | `active` state, primary accent, context names |
| `hue.violet` | `97` | `#875FAF` | `review` state |
| `hue.blue` | `68` | `#5F87D7` | `deep` energy level |

---

## Chrome

Grayscale only. Used for all structural and secondary elements.

| Token | 256-code | Hex | Usage |
|---|---|---|---|
| `chrome.label` | `255` (bold) | `#EEEEEE` | Section headers, field label keys |
| `chrome.default` | terminal default | — | Body text, `backlog` state, `normal` priority, `shallow` energy |
| `chrome.muted` | `245` | `#8A8A8A` | Task IDs, timestamps, secondary info, `low` priority, `admin` energy |
| `chrome.dim` | `240` | `#585858` | Done task rows, de-emphasized items |
| `chrome.border` | `237` | `#3A3A3A` | Table dividers, section rules |

---

## Semantic Token Assignments

### Task States

| State | Token | Modifiers |
|---|---|---|
| `backlog` | `chrome.default` | none |
| `active` | `hue.cyan` | none |
| `blocked` | `hue.amber` | none |
| `review` | `hue.violet` | none |
| `done` | `chrome.dim` | strikethrough |

`done` rows use dim + strikethrough. Both are supported in iTerm2 and VSCode terminal via `\e[9m`.

### Priority

Priority color applies to the **priority badge only** — not the whole task row. Row color is always driven by state.

| Priority | Token | Modifiers |
|---|---|---|
| `critical` | `hue.red` | bold |
| `high` | `hue.amber` | none |
| `normal` | `chrome.default` | none |
| `low` | `chrome.muted` | none |

### Energy

Energy color applies to the **energy badge only** — same rule as priority.

| Energy | Token | Modifiers |
|---|---|---|
| `deep` | `hue.blue` | none |
| `shallow` | `chrome.default` | none |
| `admin` | `chrome.muted` | none |

### Contexts

Context slugs always render in `hue.cyan`. This applies in:

- The active context line in `sab briefing`
- The `Context:` field in `sab task view`
- The context column in `sab context list`
- Any `--context <slug>` confirmation output

Context names share cyan with the `active` task state. This is intentional — they appear in structurally distinct positions (heading lines vs. inline state badges) and do not collide.

### Feedback / Transient Output

| Event | Token | Modifiers |
|---|---|---|
| Resource created (task, note, context) | `hue.green` | none |
| Command failure / invalid input | `hue.red` | none |
| Warning (stale, unresolved link, etc.) | `hue.amber` | none |
| Informational / dry-run output | `chrome.muted` | none |

---

## Briefing Layout Colors

| Element | Token | Notes |
|---|---|---|
| Section header (e.g. `── Active Tasks ──`) | `chrome.label` bold | Structure, not meaning |
| Section item count badge | `hue.cyan` | e.g. `(4)` after the header label |
| Active context name | `hue.cyan` | Section 2 value |
| Task ID | `chrome.muted` | Short prefix only |
| Task title | state token | Inherits the row's state color |
| Dependency titles in blocked section | `chrome.default` | Uncolored — keeps blocked rows readable |
| Yesterday's note title | `chrome.default` | |
| Linked task title within a note row | `hue.cyan` | |

---

## Rules

1. **Never use hues for chrome.** Dividers, borders, and structural text are always grayscale.
2. **State drives row color.** Priority and energy only color their own badges.
3. **`done` rows are always dim + strikethrough.** No hue colors apply to done rows, even if the task was `critical`.
4. **Stale tasks in briefing Section 4 render with `hue.amber` row color**, overriding state color. Outside the briefing, staleness is indicated by the `stale` view label — not color.
5. **`inbox` context renders in `hue.cyan`** like all other contexts — no special treatment.

---

## Terminal Compatibility

| Feature | iTerm2 | VSCode Terminal |
|---|---|---|
| 256-color (codes 16–255) | ✓ | ✓ |
| Bold | ✓ | ✓ |
| Strikethrough (`\e[9m`) | ✓ | ✓ |
| Dim (`\e[2m`) | ✓ | ✓ |
| True color (24-bit) | ✓ | ✓ |

True color is not used by design — 256-color only, for portability.
