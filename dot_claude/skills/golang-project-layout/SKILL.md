---
name: golang-project-layout
description: Use when scaffolding a new Go service, or reviewing/modifying an existing Go service's project layout, task runner, or local dev environment. Covers directory structure, the justfile task runner, docker-compose local Postgres, and the dev-server bind-address rule.
---

# Go Project Layout

There is no single official Go project layout. The widely-linked
"golang-standards/project-layout" template is **not** endorsed by the Go
team — Go's own tech lead (Russ Cox) is on record stating it misrepresents
real Go ecosystem norms (most Go repos don't use its `pkg/` convention, for
example). The official guidance ("Organizing a Go module," go.dev) frames
structure as a function of project size: start flat, add structure only when
it's earned.

That said, the overwhelming majority of what gets built against this skill
set is a small-to-medium Postgres-backed REST API — so rather than leave this
abstract, here is the concrete default shape for that case. Deviate when a
project's shape genuinely differs; don't add layers (an empty `pkg/`, a
`domain/` you don't need yet) speculatively.

This layout, the `justfile`, and the `docker-compose.yml` below were built
and empirically run end-to-end (Postgres up, migrations applied, service
built and run under live-reload, tested, linted) — not just described. See
`tdd/references/golang.md` and `postgres-schema-design/references/golang.md`
for testing and schema/migration detail respectively; this skill covers the
scaffolding and dev-loop around them.

## Default layout for a small API service

```
widgetsvc/
├── cmd/
│   └── widgetsvc/
│       └── main.go            # entrypoint: wiring only, no business logic
├── internal/
│   ├── api/                   # HTTP: router, handlers, middleware
│   │   ├── router.go
│   │   ├── handlers.go
│   │   └── middleware.go
│   ├── config/                # env-var loading, fail-fast validation
│   │   └── config.go
│   ├── store/                 # sqlc-generated typed query code (generated, do not hand-edit)
│   │   ├── db.go
│   │   ├── models.go
│   │   ├── querier.go
│   │   └── widgets.sql.go
│   └── widget/                # domain/service logic — the actual business rules
│       └── widget.go
├── db/
│   ├── migrations/            # goose SQL migrations, source of truth for schema
│   │   └── 00001_create_widgets.sql
│   └── queries/                # sqlc input: hand-written .sql queries
│       └── widgets.sql
├── .air.toml                  # air live-reload config
├── .golangci.yml              # golangci-lint v2 config
├── docker-compose.yml         # local Postgres only
├── justfile
├── sqlc.yaml
├── go.mod
└── go.sum
```

Two structural elements have real backing beyond "convention": `cmd/<binary>/`
is the standard shape once a repo has (or might grow to have) more than one
binary, and `internal/` is not just convention — Go's compiler actually
enforces that packages under `internal/` are unimportable from outside the
module, giving you a real privacy boundary. Everything else above (`api/`,
`store/`, `widget/`, `config/`) is a reasonable default breakdown for "HTTP
concerns / generated data-access code / business logic / configuration," not
a mandated shape — a genuinely small service can start with fewer packages
and split them out once a package is doing more than one job.

`internal/store/` holds **generated** code (from `sqlc generate` — see
`postgres-schema-design/references/golang.md`). Never hand-edit files there;
edit `db/queries/*.sql` and regenerate.

## Wiring pattern (`main.go`)

`main.go` should do wiring and nothing else: load config, open the DB pool,
construct the service/store/handler chain, start the server, handle shutdown
signals. No business logic, no HTTP logic.

```go
// Command widgetsvc runs the widgets REST API.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jon23d/widgetsvc/internal/api"
	"github.com/jon23d/widgetsvc/internal/config"
	"github.com/jon23d/widgetsvc/internal/store"
	"github.com/jon23d/widgetsvc/internal/widget"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	if err := run(logger); err != nil {
		logger.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		return err
	}

	svc := widget.NewService(store.New(pool))
	handlers := api.NewWidgetHandlers(svc, logger)
	router := api.NewRouter(handlers, logger)

	// Bind with ":PORT" (empty host) so the server listens on all
	// interfaces, not just loopback. Do NOT hardcode "0.0.0.0:PORT" -
	// ":PORT" already means "all interfaces" in Go's net package, and is
	// the more portable form (see "The bind-address rule" below).
	addr := ":" + cfg.Port
	srv := &http.Server{
		Addr:              addr,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Info("listening", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
			return
		}
		errCh <- nil
	}()

	select {
	case <-ctx.Done():
		logger.Info("shutdown_signal_received")
	case err := <-errCh:
		if err != nil {
			return err
		}
		return nil
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	logger.Info("shutdown_complete")
	return nil
}
```

Note the graceful-shutdown path: `signal.NotifyContext` + `srv.Shutdown`.
This only works correctly against a **built binary** — see the `go run`
gotcha under "Confirmed gotchas" below.

## The bind-address rule

**Bind the dev/prod server with `:PORT` (empty host), never a literal
`0.0.0.0:PORT`.** This was empirically confirmed: `:PORT` already listens on
all interfaces (`ss -ltnp` shows `LISTEN *:8080`), and the service was
reachable via `127.0.0.1`, the host's real LAN IP, and the Docker bridge IP
— all from the same `:PORT` bind, no extra config. `:PORT` is also the more
portable dual-stack form; explicitly writing `0.0.0.0` can, on some
platforms, produce IPv6-binding behavior that differs from the plain form.
Use `:PORT`. This satisfies "reachable from outside localhost" (works
through Docker networking, SSH-forwarded ports, a remote dev box) without
the literal `0.0.0.0` that's sometimes reached for defensively.

## Middleware (stdlib `net/http` has no built-in story for this)

Go 1.22+'s `ServeMux` handles method+pattern routing well, but has **no**
built-in middleware chaining, route grouping, or sub-routing. Use a small,
explicit `Chain` helper rather than reaching for a router library just to
get middleware — reserve chi/gin/echo for services with genuinely advanced
routing needs (regex constraints, deep route grouping), not as a default.

```go
// Package api wires HTTP handlers, routing and middleware for widgetsvc.
package api

import (
	"log/slog"
	"net/http"
	"time"
)

// Middleware wraps an http.Handler to produce a new http.Handler, typically
// adding cross-cutting behavior (logging, recovery, auth, etc.) around it.
type Middleware func(http.Handler) http.Handler

// Chain applies middleware to h in the order given, so that mw[0] is the
// outermost (first to see the request, last to see the response) and
// mw[len(mw)-1] is the innermost, closest to h.
//
// Example:
//
//	handler := Chain(mux, RequestLogger(logger), Recoverer(logger))
func Chain(h http.Handler, mw ...Middleware) http.Handler {
	for i := len(mw) - 1; i >= 0; i-- {
		h = mw[i](h)
	}
	return h
}

// statusRecorder captures the status code written to the underlying
// ResponseWriter so middleware can log it after the handler returns.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

// RequestLogger returns a middleware that logs method, path, status code
// and duration for every request.
func RequestLogger(logger *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

			next.ServeHTTP(rec, r)

			logger.Info("http_request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"duration_ms", time.Since(start).Milliseconds(),
			)
		})
	}
}

// Recoverer returns a middleware that recovers from panics in downstream
// handlers, logs them, and responds with 500 instead of crashing the
// server.
func Recoverer(logger *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					logger.Error("panic_recovered", "error", rec, "path", r.URL.Path)
					w.WriteHeader(http.StatusInternalServerError)
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}
```

`router.go` wires this with `http.NewServeMux()` and 1.22+ patterns, e.g.
`mux.HandleFunc("POST /widgets", h.Create)`, `mux.HandleFunc("GET /widgets/{id}", h.Get)`,
then returns `Chain(mux, RequestLogger(logger), Recoverer(logger))`.

## Task runner: `just`, not `make`

`just` is the decided default over Make or Mage — better developer
experience (no tab-sensitivity footguns, `just --list` self-documents
available commands the same way `pnpm run` does, cleaner syntax) at the cost
of one extra dev-machine dependency, which is an accepted tradeoff here.
Install via the OS package manager (`apt install just`, `brew install just`,
etc.).

```
set dotenv-load := true

export DATABASE_URL := env_var_or_default("DATABASE_URL", "postgres://widgetsvc:widgetsvc@localhost:55432/widgetsvc?sslmode=disable")
export PORT := env_var_or_default("PORT", "8080")

# List available recipes.
default:
    just --list

# Run the service with live-reload via air. Binds all interfaces (":PORT").
dev:
    air -c .air.toml

# Build the service binary.
build:
    go build -o bin/widgetsvc ./cmd/widgetsvc

# Run unit tests, then DB-backed integration tests (testcontainers-go).
# -count=1 disables the test result cache defensively: it guards against
# external state (e.g. DB content) changing without a Go-visible signal
# changing — see tdd/references/golang.md for the full explanation.
test:
    go test ./... -count=1
    go test -tags=integration ./... -count=1

# Run only the fast unit tests (no Docker required).
test-unit:
    go test ./... -count=1

# Run only the DB-backed integration tests (requires a Docker daemon).
test-integration:
    go test -tags=integration ./... -count=1 -v

# Lint with golangci-lint v2. --build-tags is required or build-tagged test
# files (like integration tests) are silently skipped — see the gotcha below.
lint:
    golangci-lint run --build-tags=integration ./...

# Format with gofumpt (a stricter superset of gofmt).
fmt:
    gofumpt -l -w .

# Apply all pending goose migrations.
migrate-up:
    goose -dir db/migrations postgres "$DATABASE_URL" up

# Roll back the most recently applied goose migration.
migrate-down:
    goose -dir db/migrations postgres "$DATABASE_URL" down

# Create a new empty goose migration: just migrate-create add_foo_column
migrate-create name:
    goose -dir db/migrations create {{name}} sql

# Regenerate sqlc typed query code from db/queries + db/migrations.
sqlc-generate:
    sqlc generate
```

## Linting and formatting

`golangci-lint` **v2** (confirm the config's `version: "2"` key before
trusting any example found online — v1 configs are not compatible, and most
existing blog posts/examples are still v1-shaped) + `gofumpt` (a strict
superset of `gofmt` — anything gofumpt-clean is automatically gofmt-clean
too, so there's no downside to the stricter tool).

```yaml
version: "2"

run:
  timeout: 5m
  tests: true

linters:
  default: standard
  enable:
    - bodyclose
    - errorlint
    - gosec
    - noctx
    - revive
    - unconvert
    - unparam
    - unused
  settings:
    revive:
      rules:
        - name: exported
          disabled: false
  exclusions:
    rules:
      - path: _test\.go
        linters:
          - gosec
          - unparam

formatters:
  enable:
    - gofumpt
    - goimports
  settings:
    goimports:
      local-prefixes:
        - github.com/<org>/<service>

issues:
  max-issues-per-linter: 0
  max-same-issues: 0
```

Two things confirmed the hard way while verifying this config: `gosec`'s
`G109` check rejects `int32(n)` conversions even after an explicit bounds
check (it doesn't do range analysis) — use `strconv.ParseInt(v, 10, 32)`
instead of `Atoi` + a manual guard, since that's bounded by construction.
And `golangci-lint run ./...` **silently skips build-tagged test files**
(like an `integration` build tag) unless you pass `--build-tags=integration`
— see the `just lint` recipe below, and `tdd/references/golang.md` for more.

## Local Postgres (`docker-compose.yml`)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: widgetsvc
      POSTGRES_PASSWORD: widgetsvc
      POSTGRES_DB: widgetsvc
    ports:
      - "55432:5432"
    volumes:
      - widgetsvc-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U widgetsvc -d widgetsvc"]
      interval: 2s
      timeout: 3s
      retries: 10

volumes:
  widgetsvc-pgdata:
```

Note the host port is `55432`, not the default `5432` — pick whatever's free
on the dev machine; a second local Postgres-backed project on the same
machine is a real, common collision. Name the container/volume/network after
the service (via the compose file's default project-naming, i.e. the
directory basename) and **always invoke `docker compose` from the repo
root**, never via `-f /path/to/compose.yml` from elsewhere — compose derives
its project name from the invocation directory, and a fixed `container_name`
will collide across two different project names for the same file.

## Confirmed gotchas (empirically verified, not theoretical)

- **`go run` breaks graceful shutdown.** Sending `SIGTERM` to a `go run`
  wrapper process kills only the wrapper — the compiled child process never
  receives the signal and keeps the port bound (confirmed via `ps --ppid` /
  `ss -ltnp` before and after). Always build a binary and signal that
  instead; this is exactly why `just build` + running `bin/widgetsvc`
  directly is the pattern, not `go run ./cmd/widgetsvc`.
- **Port collisions with other local projects are real**, not hypothetical —
  hit directly during verification (another project's Postgres already held
  5432). Don't hardcode the "obvious" port; make it easy to remap.
- **`docker compose down` (no `-v`) preserves the named volume** — data
  survives a stop/recreate cycle. `down -v` destroys it. Use `-v` only when
  you actually want a from-scratch database (e.g. testing migrations from
  zero).
