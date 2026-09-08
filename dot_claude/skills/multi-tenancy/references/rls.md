# PostgreSQL Row-Level Security for Multi-Tenancy

Use this when you need DB-level tenant isolation in addition to (or instead of) the application-layer query-scoping approach.

## When RLS is appropriate

- Regulatory compliance requires DB-level enforcement (HIPAA, SOC 2 Type II, PCI-DSS)
- Direct DB access by admin tools or analytics queries that bypass the application
- Defense-in-depth: a compromised application layer still cannot read another tenant's rows

## Setup with PostgreSQL

### 1. Enable RLS on the table

```sql
-- Run in a migration file
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Project" FORCE ROW LEVEL SECURITY; -- applies to table owner too

CREATE POLICY tenant_isolation ON "Project"
  USING ("tenantId" = current_setting('app.tenant_id', true));
```

### 2. Set the tenant context per connection

Most ORMs/query layers don't natively support per-query session variables. Set it explicitly at the start of each transaction with a raw SQL command:

```sql
SELECT set_config('app.tenant_id', $1, true)
```

Run this as the first statement inside the same transaction as the queries it should apply to — see stack-specific guidance for how to wire this into your query layer.

### 3. Create a restricted role

```sql
-- Create an app role that cannot bypass RLS
CREATE ROLE app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

-- The superuser/owner role used for migrations should be separate
```

### 4. Connection configuration

Configure your application's database connection to use the restricted role for normal queries, and reserve a privileged role for running migrations only — never point the migration tooling and the application at the same role.

## Caveats

- **Performance:** RLS adds a policy evaluation step to every query. Index `tenantId` on every table.
- **Migrations:** Run migrations with a role that has `BYPASSRLS` or is the table owner. Don't use the app role for running migrations.
- **Testing:** RLS policies are bypassed by superusers. Test with the restricted app role.
- **`FORCE ROW LEVEL SECURITY`:** Without this, the table owner bypasses RLS. Always set it.

## Combining RLS with the application-layer approach

The recommended pattern is to use both:

- Application-layer query scoping (e.g. a Prisma client extension — see stack-specific guidance) — prevents developer mistakes, compile-time safety
- RLS (database layer) — defense-in-depth, protects against compromised application or direct DB access

The application-layer filters are redundant when RLS is active, but the redundancy is intentional.
