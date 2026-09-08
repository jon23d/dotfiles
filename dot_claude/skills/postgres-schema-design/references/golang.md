# Postgres Schema Design — Go

The universal rules in the main skill (all schema changes go through
migrations, column-type rules, snake_case naming, audit columns,
constraint/indexing rules, soft-delete pattern) apply as-is. This file
covers the Go-specific tooling: `pgx` + `sqlc` + `goose`, verified
end-to-end against a real Postgres (see `golang-project-layout` for the
surrounding project).

## Stack

- **Driver:** `pgx` (`jackc/pgx/v5`) — use its native `pgx.Pool`/`pgx.Conn`
  interface, not the `database/sql` compatibility shim (`pgx/v5/stdlib`).
  The shim exists mainly for interop with tools that require
  `database/sql`; sqlc's pgx driver targets native pgx by default and gets
  full feature access that way.
- **Query layer:** `sqlc` — SQL-first typed codegen, no ORM. This is an
  opinionated choice matching this skill set's "simple, stdlib-leaning,
  reviewer-legible SQL" bar, not a claim that it's more popular than GORM
  or Ent — both are legitimate for different priorities (GORM for rapid
  CRUD convenience, Ent for compile-time-safe complex schemas at scale).
  sqlc's tradeoff: you write real SQL by hand, and it generates a typed Go
  API from it — no runtime reflection, no query-building magic, and the
  actual SQL is always visible to a reviewer in the `.sql` file.
- **Migrations:** `goose` — SQL-first, pairs naturally with sqlc's
  philosophy. `golang-migrate` is an equally defensible substitute if a
  project already has a reason to prefer it; there's no strong community
  consensus pointing one over the other.

## `sqlc.yaml`

```yaml
version: "2"
sql:
  - engine: "postgresql"
    queries: "db/queries"
    schema: "db/migrations"
    gen:
      go:
        package: "store"
        out: "internal/store"
        sql_package: "pgx/v5"
        emit_json_tags: true
        emit_interface: true
        emit_exact_table_names: false
```

## Example migration (`db/migrations/00001_create_widgets.sql`)

```sql
-- +goose Up
-- +goose StatementBegin
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE widgets (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    description text NOT NULL DEFAULT '',
    sku         text NOT NULL,
    price_cents integer NOT NULL CHECK (price_cents >= 0),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX widgets_sku_key ON widgets (sku);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE widgets;
-- +goose StatementEnd
```

## Workflow

1. Write the migration SQL under `db/migrations/`, then `just migrate-up`
   (wraps `goose -dir db/migrations postgres "$DATABASE_URL" up`).
2. Write or update the query in `db/queries/*.sql`.
3. `just sqlc-generate` (wraps `sqlc generate`) — produces typed Go code in
   `internal/store/`. **Never hand-edit generated files** — edit the `.sql`
   and regenerate.
4. `just migrate-down` rolls back the most recent migration;
   `just migrate-create <name>` scaffolds a new empty one.

## Confirmed gotchas

- **goose tracks applied state by version number in a `goose_db_version`
  table, not by file content hash.** Editing an already-applied migration
  file in place does **nothing** on the next `goose up` — goose has no idea
  the file changed. A schema fix during development needs either a new
  migration, or a full volume reset (`docker compose down -v` then
  `migrate-up` again from scratch). This is a real, easy-to-hit trap:
  editing a migration and expecting `migrate-up` to pick up the change.
- **`docker compose down` (no `-v`) does not remove the named volume** — the
  database survives a stop/recreate cycle with all data intact. Only
  `down -v` forces a genuinely clean re-migration from empty. Know which one
  you want before running it.
- **Local port collisions are real** — confirmed directly during
  verification (another local project already held Postgres's default
  5432). Don't assume the default port is free; remap the host port in
  `docker-compose.yml` (see `golang-project-layout`) rather than fighting
  for the default.
