---
name: implementation-planning
description: Use when a task touches APIs, schema, or spans multiple files, or when scope is unclear, before any code is written. Read-only exploration that produces a written implementation plan.
---

# Implementation planning

Read-only. Explore before proposing — a plan written without reading the code
is a guess with formatting.

## Before writing the plan

Load the skills the task actually needs (e.g. `rest-api-design` for endpoints,
`postgres-schema-design` for data model changes) before exploring. If a ticket
was referenced, read it first — related issues are fair game for context.

## Plan format

Write `.agent/plan-{slice}.md` with every section below. "None" is a valid
answer for a section that doesn't apply — do not omit the section.

- **Problem statement** — what needs to be built and why, in your own words
- **Files likely affected** — list, with a brief reason for each
- **Constraints and risks** — technical constraints, unknowns,
  backward-compatibility concerns
- **Data model changes** — new tables, columns, migrations; or "None"
- **API surface** — new or modified endpoints with request/response shapes;
  or "None"
- **Implementation steps** — numbered, ordered, each small enough for exactly
  one failing test
- **Skills to load** — which skills the implementer should load for each step
- **Acceptance criteria** — explicit, testable checklist
- **Open questions** — anything needing clarification; or "None — ready to
  implement"

## Output

Return only the file path and a one-line summary. The caller reads the plan —
don't paste its contents back. Open questions block implementation; surface
them rather than guessing an answer.
