---
name: prisma
description: Prisma ORM implementation guide for TypeScript. Load whenever working with database access, models, migrations, or queries in a project that uses Prisma. Covers the client singleton, migration workflow, relationship loading, N+1 avoidance, transactions, soft deletes, pagination, and error handling. Use alongside postgres-schema-design for schema decisions.
---

# Prisma ORM Implementation Guide

## Client Singleton Pattern

The most critical pattern in Prisma is the client singleton. In development (especially Next.js with hot reload), creating multiple `PrismaClient` instances exhausts the connection pool. Use `globalThis` to reuse the same instance across module reloads.

**File: `lib/prisma.ts`**

```typescript
import { PrismaClient } from '@prisma/client';

// Prevent multiple instances in development hot reload
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
```

**Why this pattern?**

- Next.js hot reload re-evaluates modules. Without `globalThis`, you get a new `PrismaClient` each reload, quickly exhausting your connection pool (default 10 connections).
- Connection pool exhaustion causes `ENOTFOUND` or timeout errors that are hard to debug.
- In production, Node.js doesn't hot reload, so a regular `new PrismaClient()` is fine, but the pattern works everywhere.

**Usage in your application:**

```typescript
import { prisma } from '@/lib/prisma';

// Use everywhere
const user = await prisma.user.findUnique({
  where: { id: userId },
});
```

**In middleware (Next.js):**

```typescript
// middleware.ts
import { prisma } from '@/lib/prisma';

export async function middleware(request: Request) {
  const userId = request.headers.get('x-user-id');
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    // attach to request context
  }
}
```

## Migration Workflow

Prisma offers three migration commands for different scenarios. Understanding when to use each prevents common mistakes.

### `prisma migrate dev`

**When to use:** During local development when you're changing your schema.

```bash
# 1. Edit schema.prisma
# 2. Run this command
prisma migrate dev --name add_subscription_tier

# This does three things:
# 1. Runs existing migrations (if any)
# 2. Detects your schema changes
# 3. Generates a new migration file and applies it
```

**Generated migration example:**

```sql
-- migrations/20240308120000_add_subscription_tier/migration.sql
ALTER TABLE "User" ADD COLUMN "subscriptionTier" TEXT NOT NULL DEFAULT 'free';
CREATE INDEX "User_subscriptionTier_idx" ON "User"("subscriptionTier");
```

**Why meaningful names matter:** Migration filenames are part of your codebase history. Use `add_subscription_tier`, not `changes`. This helps when debugging: "when did we add that column?"

### `prisma db push`

**When to use:** Prototyping or when you don't need explicit migration files (rapid iteration, small team).

```bash
# Pushes schema directly to database without creating migration files
prisma db push
```

**Never use in production.** You lose the migration history, making it impossible to deploy to new environments or rollback.

### `prisma migrate deploy`

**When to use:** Production deployments in your CI/CD pipeline.

```bash
# In your deployment script (CI/CD pipeline, etc)
prisma migrate deploy

# This runs all pending migrations in order
# Fails if any migration fails (safer than db push)
```

**Deployment workflow:**

```yaml
# .gitea/workflows/deploy.yml
- name: Run migrations
  run: npx prisma migrate deploy
  env:
    DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
```

### Common Mistakes

1. **Editing migration files manually** — Don't. If you made a mistake, create a new migration.

   ```bash
   # WRONG: manually edit migrations/20240308120000_*/migration.sql
   # RIGHT: Fix schema.prisma, run migrate dev with a new name
   ```

2. **Running `migrate dev` in production** — This creates new migration files from your code, which breaks version control.

   ```bash
   # WRONG: running 'migrate dev' in prod resets the database
   # RIGHT: only use 'migrate deploy'
   ```

3. **Mixing migration approaches** — Use `migrate dev` locally, `migrate deploy` in production. Never use `db push` for persistent environments.

## Seeding

Seeding populates your database with initial data. In a SaaS, this typically means creating test accounts, default plans, or demo data.

**File: `prisma/seed.ts`**

```typescript
import { PrismaClient } from '@prisma/client';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

async function main() {
  // Seed subscription plans (idempotent)
  const freePlan = await prisma.subscriptionPlan.upsert({
    where: { name: 'free' },
    update: {}, // Do nothing if it exists
    create: {
      name: 'free',
      priceInCents: 0,
      monthlyQuota: 100,
    },
  });

  const proPlan = await prisma.subscriptionPlan.upsert({
    where: { name: 'pro' },
    update: {
      priceInCents: 2999, // Update price if needed
    },
    create: {
      name: 'pro',
      priceInCents: 2999,
      monthlyQuota: 10000,
    },
  });

  // Seed demo user (only in development)
  if (process.env.NODE_ENV === 'development') {
    const demoOrg = await prisma.organization.upsert({
      where: { slug: 'acme-corp' },
      update: {},
      create: {
        name: 'ACME Corp',
        slug: 'acme-corp',
        owner: {
          create: {
            email: 'demo@acme.local',
            name: 'Demo User',
            passwordHash: 'bcrypt-hash-here',
          },
        },
      },
    });

    console.log(`Seeded: ${freePlan.name}, ${proPlan.name}, org: ${demoOrg.slug}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

**Configure in `package.json`:**

```json
{
  "prisma": {
    "seed": "ts-node prisma/seed.ts"
  }
}
```

**Run seed:**

```bash
# After running migrations
prisma db seed

# Or combined
prisma migrate dev && prisma db seed
```

**Why idempotent seeds?** Your seed must be safe to run multiple times. Use `upsert` (update if exists, create if not) instead of raw `create`. This lets developers run `prisma migrate dev` repeatedly without errors.

## Selecting Data: `select` vs `include`

Prisma's `select` and `include` control what fields you fetch. Over-fetching (loading fields you don't use) wastes bandwidth and creates security issues.

### `include` — Load relations alongside base fields

```typescript
// Includes all User fields PLUS related posts
const user = await prisma.user.findUnique({
  where: { id: userId },
  include: {
    posts: true,
    subscription: true,
  },
});

// user.id, user.email, user.name (all User fields)
// user.posts (array of posts)
// user.subscription (subscription object)
```

### `select` — Load only specified fields

```typescript
// Load ONLY email and organization name (not all User fields)
const user = await prisma.user.findUnique({
  where: { id: userId },
  select: {
    id: true,
    email: true,
    organization: {
      select: {
        name: true,
      },
    },
  },
});

// user.id, user.email
// user.organization.name
// Everything else is undefined
```

**When to use each:**

- **`include`**: You want all base fields. Used in ~80% of cases.
- **`select`**: You need specific fields (API serialization, reducing payload size).

### Computed Selects with Type Safety

For API responses, create typed select helpers to ensure consistency:

```typescript
// lib/selects.ts
import { Prisma } from '@prisma/client';

export const userPublicSelect = {
  id: true,
  email: true,
  name: true,
  avatar: true,
  createdAt: true,
} as const satisfies Prisma.UserSelect;

export type UserPublic = Prisma.UserGetPayload<{
  select: typeof userPublicSelect;
}>;

// Usage:
const user = await prisma.user.findUnique({
  where: { id: userId },
  select: userPublicSelect,
});

// user is now typed as UserPublic automatically
```

This pattern ensures your API returns consistent fields and catches type errors at compile time.

### Avoiding N+1 with Nested `select`

```typescript
// WRONG: N+1 problem
const users = await prisma.user.findMany();
for (const user of users) {
  const org = await prisma.organization.findUnique({
    where: { id: user.organizationId },
  });
  // This runs one query per user
}

// RIGHT: Load all relations in one query
const users = await prisma.user.findMany({
  include: {
    organization: true,
  },
});

// All organizations loaded in a single batched query
```

## Relationship Loading and N+1 Prevention

N+1 queries are the #1 performance killer in ORMs. Load all relations you need upfront.

### Nested Include Pattern

```typescript
const organization = await prisma.organization.findUnique({
  where: { id: orgId },
  include: {
    owner: true,
    members: {
      where: { role: 'admin' },
      select: {
        id: true,
        email: true,
      },
    },
    subscriptions: {
      include: {
        plan: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5, // Last 5 subscriptions
    },
  },
});

// Access nested data
console.log(organization.owner.email);
console.log(organization.members[0].email);
console.log(organization.subscriptions[0].plan.name);
```

### When Separate Queries Are Better

For very large datasets, separate queries can be more efficient:

```typescript
const organization = await prisma.organization.findUnique({
  where: { id: orgId },
});

// Load posts separately with pagination
const posts = await prisma.post.findMany({
  where: { organizationId: orgId },
  orderBy: { createdAt: 'desc' },
  take: 20,
  skip: 0,
});

// Why? If organization has 10k posts, including them all is wasteful.
// Separate query lets you paginate.
```

### Batch Loading for Efficiency

When you have multiple objects needing the same relation:

```typescript
// Instead of including members on every user...
const users = await prisma.user.findMany({
  include: { organization: true }, // Inefficient if you only need org once
});

// Batch load organizations separately
const userIds = users.map((u) => u.id);
const orgs = await prisma.organization.findMany({
  where: { id: { in: userIds } },
});

const orgMap = Object.fromEntries(orgs.map((o) => [o.id, o]));
// Reuse orgMap for all users
```

## Transactions

Transactions ensure multiple operations succeed or fail together. Essential in SaaS for payments, subscriptions, multi-step operations.

### Sequential Transactions

For simple operations that must all succeed or all rollback:

```typescript
// Transfer credits between users (must be atomic)
await prisma.$transaction([
  prisma.user.update({
    where: { id: fromUserId },
    data: { credits: { decrement: amount } },
  }),
  prisma.user.update({
    where: { id: toUserId },
    data: { credits: { increment: amount } },
  }),
  prisma.creditLog.create({
    data: {
      fromUserId,
      toUserId,
      amount,
    },
  }),
]);
```

If any operation fails, all are rolled back. Atomicity is guaranteed.

### Interactive Transactions

For complex logic requiring conditionals (e.g., "update if condition, otherwise create new"):

```typescript
const result = await prisma.$transaction(async (tx) => {
  // Check current balance
  const user = await tx.user.findUnique({
    where: { id: userId },
  });

  if (user.credits < amount) {
    throw new Error('Insufficient credits');
  }

  // Only then proceed
  await tx.user.update({
    where: { id: userId },
    data: { credits: { decrement: amount } },
  });

  const transaction = await tx.transaction.create({
    data: { userId, amount, type: 'debit' },
  });

  return transaction;
});
```

**When to use each:**

- **Sequential `$transaction([...])`**: Operations don't depend on results (payments, ledger entries).
- **Interactive `$transaction(async (tx) => {...})`**: Conditional logic, reads before writes.

### Timeout Configuration

Interactive transactions timeout after 5 seconds by default. For long operations:

```typescript
const result = await prisma.$transaction(
  async (tx) => {
    // ... long operation
  },
  {
    timeout: 30000, // 30 seconds
    isolationLevel: 'Serializable', // Highest level
  },
);
```

## Pagination

SaaS requires efficient pagination. Cursor-based pagination (keyset pagination) is faster and more reliable than offset.

### Cursor-Based Pagination (Recommended)

```typescript
// Fetch 20 posts after a cursor
const posts = await prisma.post.findMany({
  where: { organizationId: orgId },
  orderBy: { id: 'desc' }, // Must order by a unique field
  take: 21, // Fetch one extra to know if there's a next page
  cursor: lastPostId ? { id: lastPostId } : undefined,
  skip: lastPostId ? 1 : 0, // Skip the cursor itself
});

// Determine if there's a next page
const hasNextPage = posts.length > 20;
const items = posts.slice(0, 20);
const nextCursor = hasNextPage ? items[items.length - 1].id : null;

return {
  items,
  nextCursor,
  hasNextPage,
};
```

**Why cursor pagination?**

- **Efficient:** Uses indexed fields, doesn't count total rows.
- **Stable:** Results don't shift if data is inserted/deleted during pagination.
- **Scales:** Works with millions of records without performance degradation.

### Offset Pagination (Legacy)

```typescript
const page = 1;
const pageSize = 20;

const [items, total] = await prisma.$transaction([
  prisma.post.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: 'desc' },
    take: pageSize,
    skip: (page - 1) * pageSize,
  }),
  prisma.post.count({
    where: { organizationId: orgId },
  }),
]);

return {
  items,
  total,
  page,
  pages: Math.ceil(total / pageSize),
};
```

**Downsides:** Requires COUNT query (slow on large tables), results shift if data changes.

### Reusable Pagination Helper

```typescript
// lib/pagination.ts
export async function cursorPaginatedQuery<T>(
  query: (props: { take: number; cursor?: { id: string } }) => Promise<T[]>,
  cursor?: string,
  pageSize: number = 20,
) {
  const items = await query({
    take: pageSize + 1,
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
  });

  const hasNextPage = items.length > pageSize;
  return {
    items: items.slice(0, pageSize),
    nextCursor: hasNextPage ? items[pageSize - 1].id : null,
    hasNextPage,
  };
}

// Usage:
const result = await cursorPaginatedQuery(
  (props) =>
    prisma.post.findMany({
      ...props,
      where: { organizationId: orgId },
      orderBy: { id: 'desc' },
    }),
  cursor,
);
```

## Error Handling

Prisma throws `PrismaClientKnownRequestError` with error codes. Handle them gracefully to provide meaningful API responses.

### Common Error Codes

- **P2002:** Unique constraint violation (duplicate email, username, etc.)
- **P2025:** Record not found (finding a user that doesn't exist)
- **P2003:** Foreign key constraint violation (deleting organization with users)
- **P2014:** Required relation violation (deleting field that other records depend on)
- **P2016:** Query interpretation error (malformed query)

### Error Handler Utility

```typescript
// lib/prisma-error.ts
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

export class PrismaError extends Error {
  constructor(
    public code: string,
    public field?: string,
    message?: string,
  ) {
    super(message);
  }
}

export function handlePrismaError(error: unknown): never {
  if (error instanceof PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        const field = error.meta?.target?.[0] || 'field';
        throw new PrismaError('UNIQUE_CONSTRAINT', field, `${field} already exists`);

      case 'P2025':
        throw new PrismaError('NOT_FOUND', undefined, 'Record not found');

      case 'P2003':
        throw new PrismaError(
          'FOREIGN_KEY_CONSTRAINT',
          undefined,
          'Cannot delete: related records exist',
        );

      default:
        throw new PrismaError('DATABASE_ERROR', undefined, error.message);
    }
  }

  throw error;
}

// Usage in API routes:
export async function getUserOrThrow(id: string) {
  try {
    return await prisma.user.findUniqueOrThrow({
      where: { id },
    });
  } catch (error) {
    handlePrismaError(error);
  }
}
```

## Soft Deletes

SaaS often needs to keep deleted data for auditing, recovery, or legal reasons. Soft deletes mark records as deleted without removing them.

### Schema Pattern

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String
  deletedAt DateTime? // NULL = not deleted, DateTime = deleted at this time

  @@index([deletedAt])
}
```

### Middleware Filter

```typescript
// lib/prisma-soft-delete.ts
import { PrismaClient } from '@prisma/client';

export function applySoftDeleteMiddleware(prisma: PrismaClient) {
  prisma.$use(async (params, next) => {
    // For read queries, exclude soft-deleted records
    if (params.action === 'findUnique' || params.action === 'findMany') {
      params.args ??= {};
      params.args.where ??= {};
      params.args.where.deletedAt = null;
    }

    // For updateMany/deleteMany, set deletedAt instead of actual delete
    if (params.action === 'delete') {
      params.action = 'update';
      params.args.data = { deletedAt: new Date() };
    }

    if (params.action === 'deleteMany') {
      params.action = 'updateMany';
      params.args.data = { deletedAt: new Date() };
    }

    return next(params);
  });
}

// Initialize in lib/prisma.ts
import { applySoftDeleteMiddleware } from './prisma-soft-delete';

const prisma = new PrismaClient();
applySoftDeleteMiddleware(prisma);
```

### Hard Delete Escape Hatch

```typescript
// Hard delete when you truly need it (account deletion, GDPR request)
await prisma.user.deleteMany({
  where: {
    email: userEmail,
    deletedAt: { not: null }, // Only delete already-soft-deleted
  },
});
```

## Prisma Client Extensions (v5+)

Extend Prisma with custom methods for domain logic:

```typescript
// lib/prisma-extensions.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient().$extends({
  model: {
    user: {
      // Add custom methods to User model
      async softDelete(userId: string) {
        return this.update({
          where: { id: userId },
          data: { deletedAt: new Date() },
        });
      },

      async hardDelete(userId: string) {
        return this.delete({
          where: { id: userId },
        });
      },

      async restore(userId: string) {
        return this.update({
          where: { id: userId },
          data: { deletedAt: null },
        });
      },
    },

    subscription: {
      async cancelAndRefund(subscriptionId: string) {
        return this.update({
          where: { id: subscriptionId },
          data: {
            status: 'canceled',
            canceledAt: new Date(),
          },
        });
      },
    },
  },
});

export default prisma;
```

**Usage:**

```typescript
// Now you can call custom methods
await prisma.user.softDelete(userId);
await prisma.subscription.cancelAndRefund(subscriptionId);
```

## Type Utilities

Leverage Prisma's type inference to ensure type safety at compile time.

### Infer Response Types

```typescript
import { Prisma } from '@prisma/client';

// Define what you're selecting
const userWithPosts = Prisma.validator<Prisma.UserArgs>()({
  include: {
    posts: true,
    subscription: true,
  },
});

// Infer the type automatically
export type UserWithPosts = Prisma.UserGetPayload<typeof userWithPosts>;

// Usage ensures you only access fields that exist
const user: UserWithPosts = await prisma.user.findUnique({
  where: { id: userId },
  include: {
    posts: true,
    subscription: true,
  },
});

// This works
console.log(user.posts[0].title);

// This errors at compile time (posts not included)
// console.log(user.comments[0].text);
```

### Input Type Validation

```typescript
const createUserInput = Prisma.validator<Prisma.UserCreateInput>()({
  email: 'user@example.com',
  name: 'User Name',
  // IDEs show autocomplete for all required fields
});

export type CreateUserInput = Prisma.UserCreateInput;
```

### Using `satisfies` for Validation

```typescript
import type { Prisma } from '@prisma/client';

// Validates the select without creating extra types
const userSelect = {
  id: true,
  email: true,
  name: true,
} satisfies Prisma.UserSelect;

// Type errors if you reference fields that don't exist
const posts = {
  id: true,
  title: true,
  notAField: true, // Type error!
} satisfies Prisma.PostSelect;
```

## Key Takeaways

1. **Always use the client singleton** — prevents connection pool exhaustion.
2. **Use `migrate dev` locally, `migrate deploy` in production** — never mix.
3. **Seed idempotently** — use `upsert`, not `create`.
4. **Avoid N+1** — load relations upfront with `include`/`select`.
5. **Use cursor pagination** — scales better than offset.
6. **Handle errors with codes** — P2002, P2025, P2003 are your friends.
7. **Soft delete for audit trails** — use middleware to filter automatically.
8. **Extend Prisma for domain logic** — custom methods keep code clean.
9. **Infer types from selects** — `Prisma.UserGetPayload` catches type errors early.
10. **Transactions for multi-step operations** — use sequential for simple cases, interactive for conditionals.

See `references/queries.md` for filtering, aggregation, and batch operation patterns.
See `references/migrations.md` for detailed migration workflow and troubleshooting.
