---
name: postgres-schema-design
description: Use when designing or modifying a PostgreSQL database schema, adding tables or columns, creating indexes, or making any structural database change.
---

# Postgres Schema Design

## Core rule

**All schema changes go through migrations. Never apply raw DDL directly to the database.**

The migration tool is the source of truth for schema state.

---

## Schema Quality Rules

### Column types

- **PKs:** `UUID` (`gen_random_uuid()`) — not `SERIAL`/`BIGSERIAL`
- **Timestamps:** `TIMESTAMPTZ` — not `TIMESTAMP` (always UTC)
- **Enums:** DB-level `ENUM` type — not `VARCHAR` + app validation
- **Structured data:** `JSONB` — not `TEXT` storing JSON
- **Bounded strings:** `VARCHAR(n)` when max length is meaningful
- **Money:** `NUMERIC(precision, scale)` — never `FLOAT`/`REAL`
- **Booleans:** `BOOLEAN NOT NULL DEFAULT false` — not integer flags

### Naming conventions (snake_case everywhere)

- **Tables:** plural nouns — `users`, `organizations`, `audit_logs`
- **Foreign keys:** `<referenced_table_singular>_id` — `organization_id`, `user_id`
- **Booleans:** `is_`/`has_` prefix — `is_active`, `has_verified_email`
- **Timestamps:** `_at` suffix — `created_at`, `updated_at`, `deleted_at`
- **Indexes:** `idx_<table>_<columns>` — `idx_users_organization_id`
- **Unique constraints:** `uq_<table>_<columns>`
- **FK constraints:** `fk_<table>_<column>`
- **Check constraints:** `chk_<table>_<description>`

### Audit columns — add to every table

```sql
created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
deleted_at  TIMESTAMPTZ  -- soft delete; NULL means active
```

### Constraints

- Every FK must have an explicit `ON DELETE` clause: `CASCADE` (child meaningless without parent), `SET NULL` (optional relationship), `RESTRICT` (guarded deletion)
- `NOT NULL` by default; nullable only when NULL has distinct meaning
- `CHECK` constraints for bounded values (e.g. `CHECK (amount > 0)`)
- `UNIQUE` at DB level, not just application code

### Indexing

- Index every FK column
- `UNIQUE INDEX` for natural keys (email, slug)
- Partial indexes for filtered queries (`WHERE deleted_at IS NULL`)
- Composite index column order: highest-cardinality or equality-filter columns first
- Do not index low-cardinality boolean columns alone

### Multi-tenancy

- Every tenant-scoped table must have `organization_id` FK
- Index `organization_id` on every scoped table
- Consider Postgres RLS for strict DB-layer isolation:
  ```sql
  ALTER TABLE users ENABLE ROW LEVEL SECURITY;
  CREATE POLICY users_tenant_isolation ON users
      USING (organization_id = current_setting('app.current_org_id')::uuid);
  ```

### Soft delete pattern

- Filter with `WHERE deleted_at IS NULL`
- Add partial index: `CREATE INDEX idx_<table>_active ON <table> (id) WHERE deleted_at IS NULL`
- Never hard-delete rows referenced by audit/history tables

---

## What not to do

- Do not create a `schema.sql` canonical file — it drifts
- Do not hand-write raw numbered `.sql` files unless explicitly using Flyway/raw SQL runner
- Do not apply schema changes directly with `psql` — generate migration first
- Do not commit a migration without the model change (or vice versa)

## Red flags — stop and check

- About to create a `.sql` file outside the migrations folder → use the framework
- About to run `CREATE TABLE` in a scratch SQL block → use the schema file
- Model edited but no migration generated → incomplete

## Stack-specific guidance

Read `references/typescript.md` for TypeScript/Node-specific implementation detail, or `references/golang.md` for Go-specific implementation detail (pgx + sqlc + goose), before applying this skill.
