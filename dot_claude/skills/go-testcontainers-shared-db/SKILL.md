---
name: go-testcontainers-shared-db
description: Use when Go integration tests use testcontainers-go against Postgres (or another database) and `go test` is slow because each test or package starts its own container, or when designing that test setup from scratch. Symptoms include "go test ./... takes forever", per-test container startup dominating test time, or a testcontainers-go TestMain per package.
---

# Shared testcontainers-go database across a whole test run

## Overview

`go test ./...` runs each package as its own OS process, so nothing is
shared by default — a naive testcontainers-go setup starts a fresh container
per test function (worst) or per package (still wasteful). Fix: one
container for the whole run, external to any package's `TestMain`, with
per-test isolation via a rolled-back transaction.

## When to use

- Test time is dominated by container startup, not test execution.
- Designing testcontainers-go integration tests from scratch.
- A package already owns a private `TestMain`-scoped container and the
  pattern needs extending to more packages.

Don't reach for testcontainers-go's own `WithReuseByName`/container-reuse
feature instead — it has been experimental for years (underlying mechanism
since 2022, ergonomic wrapper since 2025, still experimental), reused
containers are excluded from automatic reaper cleanup, and the docs warn the
name-based API may change. Use external orchestration instead.

## Core pattern

1. **A wrapper outside any test binary** starts one container, sets its
   connection string as an env var (e.g. `TEST_DATABASE_URL`) on a child
   process, execs `go test` as that child, and terminates the container on
   exit — success, failure, or interrupt. Use `signal.NotifyContext` +
   `exec.CommandContext` so Ctrl-C still cleans up. Wire it as the test
   runner: `make test` → `go run ./cmd/testdb ./...`, not `go test ./...`
   directly.
2. **Each package's `TestMain`** reads the env var (fail fast, with an
   actionable message, if unset), opens one connection, runs `m.Run()`,
   closes it.
3. **Per-test isolation via a transaction, not a fresh container**: a
   `beginTx(t) pgx.Tx` helper begins a transaction on the shared connection
   and rolls it back via `t.Cleanup` — the same idea as Rails'
   `use_transactional_fixtures` or Laravel's `RefreshDatabase`. Go's stdlib
   `testing` has no such hook, so build it once per project.
4. **If application code opens its own transaction**, depend on a small
   interface (`Begin(ctx) (pgx.Tx, error)`) instead of a concrete pool.
   Production gets a real transaction; tests get the per-test `pgx.Tx`, and
   pgx's `Tx.Begin()` is savepoint-based — calling `Begin` on an existing
   `pgx.Tx` issues a `SAVEPOINT`, keeping nested transactions safely inside
   the outer one. Don't build this speculatively — only once real code needs
   it.

## Common mistakes

- **Silencing testcontainers-go's default logger entirely.** A blanket
  no-op logger swallows genuine failures (e.g. a Ryuk reaper handshake
  failure) never surfaced as a Go `error` anywhere else. Filter for
  error/warning-shaped content instead.
- **Forcing every test onto the shared transaction.** Some genuinely can't
  use it — give these their own private container instead:
  - Two operations inserting the same unique key from what would be two
    transactions on one connection can **deadlock** (the second's
    constraint check blocks on the first's uncommitted row; a
    single-threaded test can never let the first proceed) — not just an
    isolation gap.
  - Postgres aborts the whole transaction after a caught constraint
    violation (`SQLSTATE 25P02`); a same-transaction follow-up query then
    fails with "current transaction is aborted," even though the
    application handled the original error correctly.
  - A test proving data survives across genuinely independent connections
    (e.g. session persistence across separate pool checkouts) can't be
    modeled by one shared transaction.
- **A single `pgx.Conn` shared per package isn't safe for concurrent use.**
  Don't add `t.Parallel()` here without moving to a pool and reconsidering
  isolation.
- **Skipping signal handling in the wrapper.** The scenario this pattern
  exists to fix — a dev interrupting a hung/slow run — is exactly the one
  most likely to leak a container if step 1 skips it.
