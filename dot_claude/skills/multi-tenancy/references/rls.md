# PostgreSQL Row-Level Security for Multi-Tenancy

Use this when you need DB-level tenant isolation in addition to (or instead of) the application-layer Prisma extension approach.

## When RLS is appropriate

- Regulatory compliance requires DB-level enforcement (HIPAA, SOC 2 Type II, PCI-DSS)
- Direct DB access by admin tools or analytics queries that bypass the application
- Defense-in-depth: a compromised application layer still cannot read another tenant's rows

## Setup with Prisma + PostgreSQL

### 1. Enable RLS on the table

```sql
-- Run in a migration file
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Project" FORCE ROW LEVEL SECURITY; -- applies to table owner too

CREATE POLICY tenant_isolation ON "Project"
  USING ("tenantId" = current_setting('app.tenant_id', true));
```

### 2. Set the tenant context per connection

Prisma doesn't natively support per-query session variables. Use `$executeRaw` to set the variable before each query, or use an interactive transaction:

```typescript
export async function withTenantRLS<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

// Usage in route handler
const projects = await withTenantRLS(request.user.tenantId, (tx) =>
  tx.project.findMany({ orderBy: { createdAt: 'desc' } }),
);
```

### 3. Create a restricted role

```sql
-- Create an app role that cannot bypass RLS
CREATE ROLE app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

-- The superuser/owner role used by Prisma migrations should be separate
```

### 4. Prisma connection string

```env
# Use the restricted role for application queries
DATABASE_URL="postgresql://app_user:password@localhost:5432/mydb"

# Use a privileged role for migrations only
MIGRATION_DATABASE_URL="postgresql://postgres:password@localhost:5432/mydb"
```

## Caveats

- **Performance:** RLS adds a policy evaluation step to every query. Index `tenantId` on every table.
- **Migrations:** Run migrations with a role that has `BYPASSRLS` or is the table owner. Don't use the app role for `prisma migrate deploy`.
- **Testing:** RLS policies are bypassed by superusers. Test with the restricted app role.
- **`FORCE ROW LEVEL SECURITY`:** Without this, the table owner bypasses RLS. Always set it.

## Combining RLS with the Prisma extension approach

The recommended pattern is to use both:

- Prisma client extension (application layer) — prevents developer mistakes, compile-time safety
- RLS (database layer) — defense-in-depth, protects against compromised application or direct DB access

The Prisma extension filters are redundant when RLS is active, but the redundancy is intentional.
