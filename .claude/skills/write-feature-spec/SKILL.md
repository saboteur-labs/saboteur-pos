---
name: write-feature-spec
description: Produces a structured feature specification from a rough idea or brief description. The output is a markdown document suitable for review, task breakdown, and as context for an implementation skill or prompt.
argument-hint: feature name, additional context or description
---

Write a feature spec for the following:

Feature: $0

Additional context: $1

Produce a markdown spec document with these sections:

## Overview

One paragraph. What is this feature and what problem does it solve?
Do not describe how it works yet — only what and why.

## Goals

Bullet list. What should be true when this feature is complete?
Frame as outcomes, not tasks. Maximum 5 goals.

## Non-goals

Bullet list. What is explicitly out of scope for this feature?
Include at least one item — if nothing is out of scope, the feature
is probably under-specified.

## User stories

List of user stories in the format:
"As a [user type], I want to [action] so that [outcome]."
Include only the stories directly addressed by this feature.

## Functional requirements

Numbered list of specific, testable requirements.
Each requirement must be independently verifiable.
Use "must", "should", or "may" to indicate priority (RFC 2119).

## Open questions

Bullet list of unresolved questions that must be answered before or
during implementation. If none, write "None identified."

## Out of scope (deferred)

Bullet list of related features or improvements that are intentionally
deferred to a future iteration.

Rules for the entire document:

- Be specific and concrete. Avoid vague language like "improve",
  "enhance", or "better". Prefer "reduce latency by 200ms" over
  "improve performance".
- Do not describe implementation details or technology choices unless
  they are constraints given in the feature description.
- Keep the document under 500 words. If more is needed, the scope is
  likely too large — note this at the top.
