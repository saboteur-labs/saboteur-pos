---
template: kaizen
template_version: 1
schema: 1
---

# Kaizen Weekly Review

<!-- sab:field id="week_of" type="date" default="monday-of-current-week" -->

**Week of:** <!-- YYYY-MM-DD -->

<!-- sab:field id="time_spent" type="duration" default="measured" -->

**Time spent on this review:** <!-- e.g. 45m -->

---

<!-- sab:section id="pulse-check" title="Pulse Check" minutes="5" -->

## 1. Pulse Check (5 min)

Answer honestly. These are for you, not an audience.

<!-- sab:field id="energy" type="scale" min="1" max="5" required="true" -->

- **Energy level this week (1–5):**

<!-- sab:field id="focus" type="scale" min="1" max="5" required="true" -->

- **Focus quality this week (1–5):**

<!-- sab:field id="week_word" type="word" required="true" -->

- **One word that describes the week:**

<!-- sab:followup when="energy<=2 or focus<=2" field="low_score_note" type="text" -->

> If you scored 1–2 on either, note it. Gaman is endurance with dignity — not ignoring the signal.

---

<!-- sab:section id="intentions-review" title="Last Week's Intentions" minutes="5" -->

## 2. Last Week's Intentions — Did They Hold? (5 min)

_Your intentions from last week's review are filled in below._

<!-- sab:table id="intentions_review" rows="from:previous.intentions" empty-message="No prior intentions on record — this section is skipped." -->
<!-- sab:column id="intention" source="previous.intentions" prompt="false" -->
<!-- sab:column id="outcome" type="enum" values="held|partial|missed|dropped" required="true" -->
<!-- sab:column id="why" type="text" required="true" -->

| Intention | Outcome | Why it did/didn't happen |
| --------- | ------- | ------------------------ |
|           |         |                          |

> Kaizen principle: a missed intention is not a failure — it's data. The question is always _why_, not _whether_.

---

<!-- sab:section id="project-snapshots" title="Project Snapshots" minutes="10-15" -->

## 3. Project Snapshots (10–15 min)

For each project, answer only what changed this week. Skip sections where nothing moved — but note the skip explicitly. "No movement — deprioritized" is honest. Leaving it blank is avoidance.

<!-- sab:repeat id="projects" source="contexts" exclude="inbox" order="alpha" skippable="true" skip-reason="required" recap="done_tasks,linked_commits,blocked_tasks" -->

### {{ context.name }}

<!-- sab:field id="what_moved" type="text" required="true" -->

- **What moved:**

<!-- sab:field id="whats_blocked" type="text" -->

- **What's blocked:**

<!-- sab:field id="improvement" type="text" -->

- **One small improvement made or identified:**

<!-- sab:field id="next_action" type="text" -->

- **Next action:**

<!-- sab:end-repeat -->

<!-- Per-context extra prompts. Each block is keyed by context slug and its
     fields are appended to that context's snapshot above. A block whose slug
     matches no current context is ignored (never an error) — so retiring a
     project needs no template edit. Add a block for any project that deserves
     a metric the generic four prompts don't capture. -->

<!-- sab:extra context="offbeat-fm" -->
<!-- sab:field id="artist_profiles" type="text" -->

- **Artist profiles this week (new / claimed):**

<!-- sab:extra context="getwrite-development" -->
<!-- sab:field id="export_milestone" type="text" -->

- **Export milestone status:** <!-- e.g. "PDF working, Word in progress" -->

<!-- sab:extra context="saboteur-pos" -->
<!-- sab:field id="release_signal" type="text" -->

- **npm/GitHub signal (downloads, stars, issues):**

---

<!-- sab:section id="kaizen-question" title="The Kaizen Question" minutes="5" -->

## 4. The Kaizen Question (5 min)

This is the core of the practice. One question, answered honestly each week:

> **What is the smallest change I could make right now that would make next week meaningfully better?**

<!-- sab:field id="kaizen_answer" type="longtext" required="true" -->

_Answer here:_

It does not have to be product-related. It can be process, habit, communication, or personal. Small is intentional — compounding is the mechanism.

---

<!-- sab:section id="bandwidth" title="Bandwidth Audit" minutes="5" -->

## 5. Bandwidth Audit (5 min)

You are one person. This section exists to prevent the primary operational risk identified in your business plan: founder burnout from simultaneous project development.

- **Where did my time actually go this week?** _(rough % by project/area)_

<!-- sab:table id="allocation" rows="contexts+fixed" exclude="inbox" warn-unless-sums-to="100" -->
<!-- sab:column id="area" prompt="false" -->
<!-- sab:column id="percent" type="percent" -->
<!-- sab:fixed-rows "Job search / financial stability" "Rest / recovery" -->

| Area                             | Est. % of time |
| -------------------------------- | -------------- |
|                                  |                |

<!-- sab:field id="matches_priorities" type="enum" values="Y|N|Partially" required="true" -->

- **Does that allocation match current phase priorities?** (Y / N / Partially)

<!-- sab:field id="protect_or_cut" type="text" when="matches_priorities!=Y" -->

- **If not — what do I need to protect or cut next week?**

> Your Phase 0 priority order from the business plan: product stability → OffBeat-FM editorial outreach → community support. If that order is inverted, note it here.

---

<!-- sab:section id="next-intentions" title="Next Week's Intentions" minutes="5" -->

## 6. Next Week's Intentions (5 min)

Three maximum. Not a task list — intentions are directional. Each should be completable and meaningful on its own.

<!-- sab:list id="intentions" type="text" min="1" max="3" carries-forward-to="intentions_review" -->

1.
2.
3.

> Fewer is better. An unrealistic intentions list is just a shame generator.

---

<!-- sab:section id="honest-note" title="One Honest Note" minutes="2" -->

## 7. One Honest Note (2 min)

Something you'd only write here — not in a GitHub issue, not in a Discord post. A doubt, an observation, a thing you're avoiding thinking about. This section has no structure by design.

<!-- sab:field id="honest_note" type="longtext" -->

_Write here:_

---

_"Small, consistent improvements compound faster than invisible perfection."_
_— Kaizen_
