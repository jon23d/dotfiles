---
name: modular-monolith-boundaries
description: Use when implementing or reviewing code in a Go modular monolith — a single binary whose domain modules (customer, billing, etc.) own separate Postgres schemas and talk only through consumer-defined Go interfaces wired in cmd/. Triggers include a repo whose AGENTS.md declares a modular monolith or platform manifesto, a module importing another module's package, a query or foreign key touching another module's tables, an interface returning another module's types, background jobs or config reads inside a domain module, or a new go.mod require without an ADR.
---

# Modular Monolith Boundaries

## Overview

The dangerous mistakes in a modular monolith compile, pass tests, and look fine in a diff: `billing` importing `customer`'s repository, a `sqlc` query that forgets `tenant_id`, a ticker loop inside a domain module. The compiler catches none of them. This skill turns the boundary into mechanical gates where possible and a strict review checklist where not.

Repo-specific facts — module names, the manifesto path, approved dependencies — live in the repo's `AGENTS.md`, not here. Read that first. When this skill and the repo's manifesto disagree, the manifesto wins.

## When to use

- Implementing a feature that touches two modules, or that needs data another module owns
- Reviewing any PR in a modular-monolith repo (load this from `code-review` the way `observability` is loaded)
- Acceptance criteria that mention a JOIN across modules, "just read the customer table," or a new library

Not for: single-service repos with one schema — use `golang-project-layout`.

## The rules

**Dependency direction is a DAG with `core` at the bottom.**
- `core` holds shared types only (tenant/user/cross-module IDs, `Principal`, `Money`, error envelope) and imports nothing else in the repo
- `auth` and `jobs` are infrastructure: they depend on `core`, and no domain module imports them
- Domain modules import `core` and themselves. Nothing else.
- Only `cmd/<binary>` and `cmd/<binary>/wiring` import more than one domain module

**A consumer defines what it needs, in its own types.** `billing.CustomerLookup` returns `billing.Customer`, not `customer.Customer`. The provider never implements the consumer's interface directly — that requires importing the consumer and reverses the edge. An adapter in `wiring/` does the translation, one file per consumer/provider pair.

**Storage is private.** Repository, `sqlc` output, and migrations live under `<module>/internal/`. Each module owns one Postgres schema and connects as a role granted only that schema. No SQL references another module's schema. No cross-module foreign keys: validate the referenced ID at write time through the consumer interface, and soft-delete anything referenced across a boundary.

**Tenant scoping is structural.** RLS policy in the same migration that creates the table, composite unique constraints including `tenant_id`, queries only inside the `core` transaction helper that issues `SET LOCAL app.tenant_id`, and a wrong-tenant test per repository. See `multi-tenancy/references/rls.md` for the SQL.

**Infrastructure lives at the assembly point.** Modules expose `RunX(ctx)`; `cmd/` registers it with `jobs/`. Config is loaded once in `cmd/` and passed down. Migrations run from `cmd/`, never from `init()`. Routes mount under the module's own prefix via a single `Mount` function.

**Dependencies and non-goals go through an ADR.** A `go.mod` require not listed in the manifesto, a `plugins/` dir, a registry pattern, reflection over struct tags, an HTTP call between modules, or a `proto/` dir is a decision, not a PR.

## Reviewing

1. Run `scripts/check_boundaries.sh` from the repo root (`DOMAIN_MODULES="a b c"` if the defaults don't match). Any FAIL is `critical` under `code-review` severities — file it and stop; the rest is moot until the boundary is fixed. If the script can't run, do the same checks by reading import blocks and file paths, and say so.
2. Read the diff against the rules above. Boundary, direction, tenant-isolation, and hand-edited generated code are `critical`. Misplaced routes, jobs inside modules, missing wrong-tenant test, speculative abstractions with one implementation are `major`.
3. File through `code-review`'s JSON output. Every finding names the fix: not "billing imports customer" but "add `ListActiveCustomers` to `billing.CustomerLookup`; implement in `wiring/customer_adapter.go`."
4. If the ticket itself requires a violation, the finding is against the ticket: it needs an ADR before the work can be done as written.

## Rationalizations — and why they don't hold

- "It's just one read, a JOIN is faster" — the boundary exists so the next product can lift this module out. One JOIN makes that a rewrite.
- "The provider can just implement the interface, it already has the method" — then the provider imports the consumer. That's the edge the DAG forbids.
- "depguard is blocking me, I'll add an exception" — depguard is the gate doing its job. Extend the interface or write the ADR.
- "The FK gives us integrity for free" — it also gives the module a hard dependency on another schema. Validate at write time instead.
- "A ticker in the module is simpler than the job runner" — until there are two replicas, or the runner exists and this module is the one that never registered with it.
- "This library is tiny" — size isn't the criterion; whether it's in the manifesto is.

## Red flags — stop and reassess

- An import block in a domain module that names another domain module, `auth`, or `jobs`
- `REFERENCES <other_schema>.` in a migration
- A `CREATE TABLE` with `tenant_id` and no `CREATE POLICY` in the same file
- `pool.Query` / `pool.Exec` outside the tenant transaction helper
- `go func()` with a ticker or sleep loop anywhere except `jobs/`
- `os.Getenv` outside `cmd/`
- A generic `Repository[T]`, `EventHandler`, or `Strategy` with exactly one implementation
- Editing `.golangci.yml`, `check_boundaries.sh`, or generated code to make a failure go away
