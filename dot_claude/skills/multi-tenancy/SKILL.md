---
name: multi-tenancy
description: Use when building or modifying multi-tenant features — shared database with tenant isolation, per-request tenant context, tenant-scoped queries, or any code where one deployment serves multiple organizations/tenants. Triggers include tenantId, organizationId, workspace isolation, tenant-scoped queries, cross-tenant data leak risk, auth-token tenant claims.
---

# Multi-Tenancy

## Core principle

Tenant isolation must be **structural, not conventional**. If a developer can write a query that skips the tenant filter without getting a compile error, the isolation is fragile. In practice this means queries are scoped to the tenant by construction — a wrapped/scoped database client, middleware that always injects the filter, or an equivalent mechanism — so a handler cannot accidentally leak cross-tenant data just by forgetting a `WHERE` clause. The concrete mechanism is stack-specific; see below.

## Architecture overview

- A shared database with shared tables (the common case; see "When to use Row-Level Security" below for when DB-level isolation is also warranted)
- A tenant-id column on every tenant-scoped model, indexed
- Tenant identity comes from a verified auth-token claim (e.g. `request.user.tenantId` from a JWT), never from client-supplied input
- Queries are scoped to the tenant automatically by a query layer that enforces the filter structurally, not by every call site remembering to add it

---

## Schema — index the tenant id

Every tenant-scoped table needs a tenant-id column, **with an index covering it** — at minimum an index on the tenant-id column alone, plus composite indexes for any query that filters by tenant id + another column (e.g. tenant id + creation date, for a sorted/paginated listing).

---

## Tenant identity — never trust a client-supplied tenant id

Always read the tenant id from the verified auth-token claim populated by your auth middleware (e.g. a JWT claim), never from user-supplied input — not the request body, not query params, not headers. A client-supplied tenant id is a direct cross-tenant data leak.

---

## When to use PostgreSQL Row-Level Security instead

The shared-table + application-layer approach above is correct for most applications. Add PostgreSQL RLS only when:

- Regulatory requirements demand DB-level isolation (HIPAA, SOC 2 Type II)
- You have untrusted query paths (raw SQL, admin tools with direct DB access)
- A breach of the application layer must still not expose cross-tenant data

See `references/rls.md` for the RLS setup pattern (universal PostgreSQL SQL — applies regardless of implementation language).

## Stack-specific guidance

Read `references/typescript.md` for TypeScript/Node-specific implementation detail before applying this skill to a TypeScript repo. A Go equivalent (`references/golang.md`) does not exist yet — if this skill applies to a Go repo, flag the gap rather than force-fitting the TypeScript reference.
