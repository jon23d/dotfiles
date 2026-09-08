# TDD — Go

The red-green-refactor cycle, one-behavior-per-cycle rule, hermetic-test
rules, and table-driven-test concept in the main skill are all followed
as-is in Go — table-driven tests via `t.Run` subtests are in fact the
canonical Go expression of that universal principle, not an adaptation of it.
This file covers the Go-specific tooling and the gotchas confirmed by
actually running this stack end-to-end (see `golang-project-layout` for the
project this was verified against).

## Stack

- **Structure:** stdlib `testing` + table-driven tests via `t.Run`.
- **Assertions:** `testify/require` and `testify/assert` are the deliberate
  default here, not a grudging exception — testify is near-universal in real
  Go codebases and its assertion diffs are more reviewer-friendly than
  hand-rolled `if got != want { t.Errorf(...) }` boilerplate. `require` stops
  the test immediately on failure (use for setup/preconditions); `assert`
  continues and reports all failures (use for checking multiple independent
  outcomes in one test).
- **Mocking:** hand-written fakes behind small interfaces, not
  `testify/mock` or a code-generated mocking framework. This is one of the
  most consistently-cited real Go idioms — accept interfaces, return
  structs — and a small interface makes a fake trivial to write by hand.
  Reach for a mocking library only if a fake is genuinely impractical
  (rare).
- **Integration tests:** `testcontainers-go` against a real Postgres, gated
  behind a build tag (`//go:build integration`), run separately from unit
  tests.

## Table-driven unit test pattern

```go
func TestValidateSKU(t *testing.T) {
	tests := []struct {
		name    string
		sku     string
		wantErr bool
	}{
		{name: "valid sku", sku: "WIDGET-001", wantErr: false},
		{name: "empty sku", sku: "", wantErr: true},
		{name: "sku too long", sku: strings.Repeat("A", 65), wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateSKU(tt.sku)
			if tt.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
		})
	}
}
```

## Integration test pattern (testcontainers-go)

Gate DB-backed tests behind a build tag so `go test ./...` (fast, no Docker
needed) and `go test -tags=integration ./...` (real Postgres, slower) stay
separate — this split is what `just test-unit` / `just test-integration`
run:

```go
//go:build integration

package store_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

func TestWidgetsStore_Integration(t *testing.T) {
	ctx := context.Background()

	pgContainer, err := postgres.Run(ctx, "postgres:16-alpine",
		postgres.WithDatabase("widgetsvc"),
		postgres.WithUsername("widgetsvc"),
		postgres.WithPassword("widgetsvc"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2)),
	)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, pgContainer.Terminate(ctx)) })

	connStr, err := pgContainer.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err)

	// Apply the real goose migration against the throwaway container, then
	// exercise the real sqlc-generated queries — not mocks. This is the
	// actual integration test, not just "a Postgres is up."
	// ... run goose.Up(db, "db/migrations"), then store.New(pool).Create/Get/List ...
}
```

## Confirmed gotchas

- **`go test` result caching is smarter than commonly assumed, but `-count=1`
  is still the right defensive default.** Empirically, Go's test cache
  tracks values read via `os.Getenv` inside a test and correctly
  invalidates the cache when a *tracked* env var's value changes. The real
  risk it doesn't cover is **external state changing without a
  corresponding Go-visible signal** — e.g. database content or schema
  changing between runs with no env var flip to key off. `just test` passes
  `-count=1` explicitly for exactly this reason: don't rely on the cache's
  env-var tracking being sufficient, force a real run.
- **`t.Setenv` and `t.Parallel()` are hard-incompatible** — `t.Setenv`
  panics if called in a test marked parallel. A table-driven test that uses
  `t.Setenv` per case cannot also call `t.Parallel()` in that subtest.
- **`go run` breaks signal-based graceful shutdown** — confirmed via
  `ps`/`ss`: `kill -TERM` on a `go run` wrapper kills only the wrapper: the
  compiled child process never receives the signal and keeps its port
  bound. Never test shutdown behavior through `go run` — build a binary
  first (`just build`) and signal that.
- **`httptest`'s `defer srv.Close()` blocks until in-flight handlers
  return.** If a handler under test blocks on a channel/timeout, register
  any channel-release `defer` *after* `Close`'s defer (Go defers run LIFO)
  or the test silently pays the handler's full timeout instead of returning
  immediately.
- **golangci-lint silently skips build-tagged test files** unless you pass
  `--build-tags=integration` (or whatever tag you use) — `golangci-lint run
  ./...` alone will report clean even with real issues in
  `integration_test.go` because it never looked at the file. `just lint`
  always passes the tag for this reason.
- **golangci-lint v2's `noctx` linter flags plain `httptest.NewRequest`**,
  wanting `httptest.NewRequestWithContext` — even in test files, where the
  plain form is extremely common elsewhere in the Go ecosystem. Two
  legitimate options: fix the call sites (the stricter route), or exclude
  `noctx` for `_test.go` in `.golangci.yml` if that friction isn't wanted.
  Pick one deliberately, don't leave it as an unaddressed lint failure.
