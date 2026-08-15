---
name: multi-tenancy
description: Use when building or modifying multi-tenant features in a TypeScript application — shared database with tenant isolation, per-request tenant context, Prisma query scoping, or any code where one deployment serves multiple organizations/tenants. Triggers include: tenantId, organizationId, workspace isolation, tenant-scoped queries, cross-tenant data leak risk, JWT tenant claims.
---

# Multi-Tenancy (Fastify + Prisma + PostgreSQL, TypeScript)

## Core principle

Tenant isolation must be **structural, not conventional**. If a developer can write a query that skips the tenant filter without getting a compile error, the isolation is fragile. Every pattern below enforces this.

## Architecture overview

- Single PostgreSQL database, shared tables
- `tenantId: String` column on every tenant-scoped model
- Tenant identity from a verified JWT claim (`request.user.tenantId`)
- Prisma client extension scopes all queries automatically
- Fastify plugin registers the scoped client on every request

---

## 1. Prisma schema

Every tenant-scoped model needs `tenantId` **with a composite index** covering the most common query patterns:

```prisma
model Project {
  id        String   @id @default(cuid())
  tenantId  String
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([tenantId])           // for listing all tenant projects
  @@index([tenantId, createdAt]) // for sorted/paginated listing
}
```

`@@index([tenantId])` alone is correct but not enough — add composite indexes for any query that filters by `tenantId` + another column.

---

## 2. Fastify type augmentation

Put this in `src/types/fastify.d.ts` — never inline it per-file:

```typescript
import 'fastify';
import { PrismaClient } from '@prisma/client';

declare module 'fastify' {
  interface FastifyRequest {
    user: {
      sub: string; // user ID
      tenantId: string;
      // add other JWT claims here
    };
    db: ReturnType<typeof createTenantClient>; // scoped Prisma client
  }
}
```

---

## 3. Scoped Prisma client factory

Create `src/lib/prisma.ts`:

```typescript
import { PrismaClient } from '@prisma/client';

// Singleton base client — registered as a Fastify plugin (see step 4)
export const prisma = new PrismaClient();

// Per-request scoped client: automatically injects tenantId into every query
export function createTenantClient(tenantId: string) {
  return prisma.$extends({
    query: {
      // Add every tenant-scoped model here
      project: {
        async findMany({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async findUnique({ args, query }) {
          // findUnique requires unique fields — use findFirst for tenant-scoped lookups
          // or assert tenantId on the result after the call
          return query(args);
        },
        async create({ args, query }) {
          args.data = { ...args.data, tenantId } as typeof args.data;
          return query(args);
        },
        async update({ args, query }) {
          args.where = { ...args.where, tenantId } as typeof args.where;
          return query(args);
        },
        async delete({ args, query }) {
          args.where = { ...args.where, tenantId } as typeof args.where;
          return query(args);
        },
        async updateMany({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async deleteMany({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async count({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
      },
      // Repeat the same block for each additional tenant-scoped model
    },
  });
}

export type TenantClient = ReturnType<typeof createTenantClient>;
```

**Why not middleware (`$use`)?** Prisma middleware is deprecated in v5+. Use `$extends` with `query` instead.

---

## 4. Fastify plugin — register Prisma + decorate request

Create `src/plugins/prisma.plugin.ts`:

```typescript
import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { prisma, createTenantClient } from '../lib/prisma.js';

export default fp(async (app: FastifyInstance) => {
  // Graceful shutdown
  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  // Decorate every request with a tenant-scoped Prisma client
  app.addHook('onRequest', async (request, reply) => {
    // request.user is populated by the JWT plugin before this hook runs
    // If tenantId is missing, reject early — never let a request proceed without it
    if (!request.user?.tenantId) {
      return reply.code(401).send({ error: 'Missing tenant context' });
    }
    request.db = createTenantClient(request.user.tenantId);
  });
});
```

Register it after your JWT plugin so `request.user` is already populated:

```typescript
// src/app.ts
await app.register(jwtPlugin); // populates request.user
await app.register(prismaPlugin); // reads tenantId, decorates request.db
```

---

## 5. Route handler

```typescript
import { FastifyInstance } from 'fastify';

export default async function projectRoutes(app: FastifyInstance) {
  app.get('/projects', async (request, reply) => {
    // request.db is already scoped to request.user.tenantId
    // No tenantId filter needed here — it's injected automatically
    const projects = await request.db.project.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20, // always paginate
    });

    return reply.send(projects);
  });
}
```

The handler cannot accidentally leak cross-tenant data — `request.db` only knows about the current tenant.

---

## Common mistakes

- **`findUnique` with tenant-scoped models** — `findUnique` requires the `where` clause to use a unique field; you can't add `tenantId` to it unless you have a `@@unique([tenantId, fieldName])` constraint. Use `findFirst` instead for tenant-scoped single-record lookups.
- **Forgetting to add new models to the extension** — when you add a new tenant-scoped model to the schema, add it to `createTenantClient` immediately. Leave a comment in the file: `// ADD NEW TENANT-SCOPED MODELS HERE`.
- **Using the base `prisma` client in route handlers** — always use `request.db`, never import and use `prisma` directly in handlers.
- **Registering the Prisma plugin before the JWT plugin** — `request.user` won't be populated yet; the 401 guard will fire on every request.
- **Trusting `tenantId` from the request body or query params** — always read from `request.user.tenantId` (JWT claim), never from user-supplied input.

---

## When to use PostgreSQL Row-Level Security instead

The shared-table + application-layer approach above is correct for most applications. Add PostgreSQL RLS only when:

- Regulatory requirements demand DB-level isolation (HIPAA, SOC 2 Type II)
- You have untrusted query paths (raw SQL, admin tools with direct DB access)
- A breach of the application layer must still not expose cross-tenant data

See `references/rls.md` for the RLS setup pattern.
