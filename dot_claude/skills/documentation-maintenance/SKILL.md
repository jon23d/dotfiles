---
name: documentation-maintenance
description: Use after a slice ships, before opening the PR, to update developer-facing documentation to match what changed — new services, endpoints, environment variables, or user-visible behavior. Defines which documents are in scope and requires each to be reported on explicitly.
---

# Documentation Maintenance

Every change that touches system behavior, adds a service or dependency,
changes the API surface, or changes environment configuration must update the
relevant owned docs. Not optional — no owned doc may be silently skipped.

A from-scratch verification (`from-scratch-run` skill) should already have run
before this delegation if the change met its trigger conditions — that is the
caller's responsibility, not this skill's. This skill only updates
documentation; it does not verify setup and must not dispatch its own
subagent to do so.

## Owned documents

Check every one of these against what changed. If a doc doesn't apply, say so
explicitly in your report ("no change to docs/architecture.md — DI bindings
unchanged") — do not omit it.

- **`README.md`** — quickstart, tool versions, env setup, run/test commands,
  troubleshooting
- **`docker-compose.yml`** — new containers, ports, health checks,
  `depends_on: condition: service_healthy`
- **`docs/architecture.md`** — components, data flow, bindings (create if
  missing)
- **`docs/api.md`** — endpoint schemas, error types (create if missing)
- **`docs/functionality.md`** — feature behavior by area (create if missing)
- **`mocks/`** — a mock container per new third-party integration; use Prism
  for anything with an OpenAPI spec; flag as a follow-up if no spec exists,
  don't skip
- **`.env.example`** — new env vars with placeholder values, never real
  secrets
- **Confluence** — see below

## Confluence

Confluence is canonical; local `docs/` files are a secondary mirror — update
both when behavior changes. Resolve the space via `.project-management.yml`
(`confluence.space_key`, per the `project-management` skill's Step 0) rather
than assuming one. Read the page tree first to find the right parent
(typically a `Functionality` or `Apps` section) and read the existing page
before editing it. Create the page under that parent if none exists yet.

## Method

1. Identify every owned document plausibly affected by the change
2. Read each one's current state — don't rewrite what hasn't changed
3. Make the minimum targeted edit needed to reflect reality, local and
   Confluence both
4. Report every owned document from the checklist, including the ones you
   didn't touch and why

Style: follow `human-readable-docs` for prose, structure, and tables.

## Rules

- Never rewrite a document from scratch when a targeted edit will do
- Never speculate about whether something changed — read the source
- Create a file if it's supposed to exist and doesn't
