# Prisma Queries Reference

## Filtering with `where`

### Basic Filters

```typescript
// Exact match
await prisma.user.findMany({
  where: { email: 'user@example.com' },
});

// Multiple conditions (implicit AND)
await prisma.user.findMany({
  where: {
    email: 'user@example.com',
    status: 'active',
  },
});

// Explicit AND / OR / NOT
await prisma.user.findMany({
  where: {
    AND: [{ status: 'active' }, { role: 'admin' }],
  },
});

await prisma.user.findMany({
  where: {
    OR: [{ email: 'user@example.com' }, { username: 'user' }],
  },
});

await prisma.user.findMany({
  where: {
    NOT: {
      status: 'deleted',
    },
  },
});
```

### String Filters

```typescript
// Case-insensitive search (if enabled in schema)
await prisma.user.findMany({
  where: {
    email: { mode: 'insensitive', contains: 'example.com' },
  },
});

// Prefix match
await prisma.user.findMany({
  where: {
    email: { startsWith: 'admin' },
  },
});

// Suffix match
await prisma.user.findMany({
  where: {
    name: { endsWith: 'Smith' },
  },
});

// Substring (anywhere in string)
await prisma.user.findMany({
  where: {
    bio: { contains: 'TypeScript' },
  },
});
```

### Numeric Filters

```typescript
// Comparisons
await prisma.post.findMany({
  where: {
    viewCount: { gt: 1000 }, // greater than
  },
});

await prisma.post.findMany({
  where: {
    viewCount: { gte: 1000 }, // greater than or equal
  },
});

await prisma.post.findMany({
  where: {
    viewCount: { lt: 100 }, // less than
  },
});

// In range
await prisma.post.findMany({
  where: {
    viewCount: { gte: 100, lte: 1000 },
  },
});
```

### List Filters

```typescript
// In array
await prisma.post.findMany({
  where: {
    id: { in: [postId1, postId2, postId3] },
  },
});

// Not in array
await prisma.post.findMany({
  where: {
    status: { notIn: ['draft', 'deleted'] },
  },
});

// Check if list contains value
await prisma.user.findMany({
  where: {
    roles: { has: 'admin' }, // For string array field
  },
});
```

### Date Filters

```typescript
// After date
await prisma.post.findMany({
  where: {
    createdAt: { gte: new Date('2024-01-01') },
  },
});

// Date range (last 30 days)
const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
await prisma.post.findMany({
  where: {
    createdAt: { gte: thirtyDaysAgo, lt: new Date() },
  },
});

// Before date
await prisma.post.findMany({
  where: {
    createdAt: { lt: new Date('2024-01-01') },
  },
});
```

### Null Checks

```typescript
// Field is null
await prisma.user.findMany({
  where: {
    deletedAt: null,
  },
});

// Field is not null
await prisma.user.findMany({
  where: {
    deletedAt: { not: null },
  },
});

// Optional relation is connected
await prisma.user.findMany({
  where: {
    subscription: {
      isNot: null, // Has a subscription
    },
  },
});
```

### Relation Filters

```typescript
// Filter by related record properties
await prisma.post.findMany({
  where: {
    author: {
      email: 'author@example.com',
    },
  },
});

// Many-to-many: has related record
await prisma.post.findMany({
  where: {
    tags: {
      some: {
        name: 'typescript',
      },
    },
  },
});

// Many-to-many: none match condition
await prisma.post.findMany({
  where: {
    tags: {
      none: {
        name: 'archived',
      },
    },
  },
});

// Many-to-many: all match condition
await prisma.post.findMany({
  where: {
    tags: {
      every: {
        status: 'active',
      },
    },
  },
});

// Has any related records
await prisma.author.findMany({
  where: {
    posts: {
      some: {}, // Any posts exist
    },
  },
});

// Has no related records
await prisma.author.findMany({
  where: {
    posts: {
      none: {},
    },
  },
});
```

## Full-Text Search

### Simple Full-Text Search

```typescript
// PostgreSQL
await prisma.post.findMany({
  where: {
    content: {
      search: 'typescript orm',
    },
  },
  orderBy: {
    _relevance: {
      fields: ['title', 'content'],
      search: 'typescript orm',
      sort: 'desc',
    },
  },
});

// MySQL (requires FULLTEXT index in schema)
await prisma.post.findMany({
  where: {
    content: {
      search: 'typescript',
    },
  },
});
```

### Relevance Ranking

```typescript
// Include relevance score in results
const results = await prisma.post.findMany({
  where: {
    OR: [{ title: { search: 'typescript' } }, { content: { search: 'typescript' } }],
  },
  orderBy: {
    _relevance: {
      fields: ['title', 'content'],
      search: 'typescript',
      sort: 'desc',
    },
  },
  take: 10,
});
```

## Create Operations

### Simple Create

```typescript
await prisma.user.create({
  data: {
    email: 'user@example.com',
    name: 'User Name',
  },
});
```

### Create with Relations

```typescript
// Create user and organization together
await prisma.user.create({
  data: {
    email: 'user@example.com',
    name: 'User Name',
    organization: {
      create: {
        name: 'My Org',
        slug: 'my-org',
      },
    },
  },
  include: {
    organization: true,
  },
});

// Connect to existing organization
await prisma.user.create({
  data: {
    email: 'user@example.com',
    name: 'User Name',
    organizationId: existingOrgId,
  },
});
```

### Batch Create

```typescript
await prisma.post.createMany({
  data: [
    { title: 'Post 1', authorId: userId },
    { title: 'Post 2', authorId: userId },
    { title: 'Post 3', authorId: userId },
  ],
  skipDuplicates: true, // Skip if unique constraint fails
});
```

### Upsert (Create or Update)

```typescript
// Create if not exists, update if exists
const user = await prisma.user.upsert({
  where: { email: 'user@example.com' },
  update: { lastLoginAt: new Date() },
  create: {
    email: 'user@example.com',
    name: 'New User',
  },
});
```

### CreateOrConnect

For relations, connect existing or create if not found:

```typescript
await prisma.post.create({
  data: {
    title: 'New Post',
    author: {
      connectOrCreate: {
        where: { email: 'author@example.com' },
        create: {
          email: 'author@example.com',
          name: 'New Author',
        },
      },
    },
  },
});
```

## Update Operations

### Simple Update

```typescript
await prisma.user.update({
  where: { id: userId },
  data: {
    name: 'Updated Name',
  },
});
```

### Increment/Decrement Numeric Fields

```typescript
// Increment
await prisma.user.update({
  where: { id: userId },
  data: {
    credits: { increment: 100 },
  },
});

// Decrement
await prisma.user.update({
  where: { id: userId },
  data: {
    credits: { decrement: 50 },
  },
});

// Multiply
await prisma.post.update({
  where: { id: postId },
  data: {
    viewCount: { multiply: 2 },
  },
});

// Divide
await prisma.post.update({
  where: { id: postId },
  data: {
    score: { divide: 2 },
  },
});
```

### Update Relations

```typescript
// Connect to existing relation
await prisma.post.update({
  where: { id: postId },
  data: {
    author: {
      connect: { id: newAuthorId },
    },
  },
});

// Disconnect relation
await prisma.post.update({
  where: { id: postId },
  data: {
    author: {
      disconnect: true,
    },
  },
});

// Set many-to-many relations
await prisma.post.update({
  where: { id: postId },
  data: {
    tags: {
      set: [{ id: tag1Id }, { id: tag2Id }],
    },
  },
});

// Add to many-to-many
await prisma.post.update({
  where: { id: postId },
  data: {
    tags: {
      connect: [{ id: tagId }],
    },
  },
});

// Remove from many-to-many
await prisma.post.update({
  where: { id: postId },
  data: {
    tags: {
      disconnect: [{ id: tagId }],
    },
  },
});
```

### Update Many

```typescript
await prisma.post.updateMany({
  where: {
    status: 'draft',
    createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
  },
  data: {
    status: 'archived',
  },
});
```

## Delete Operations

### Simple Delete

```typescript
await prisma.user.delete({
  where: { id: userId },
});
```

### Delete Many

```typescript
await prisma.post.deleteMany({
  where: {
    authorId: userId,
    status: 'draft',
  },
});
```

### Delete All (Be Careful!)

```typescript
// Delete all records
await prisma.post.deleteMany({});
```

## Aggregations

### Count

```typescript
// Count all
const total = await prisma.post.count();

// Count with filter
const draftCount = await prisma.post.count({
  where: { status: 'draft' },
});

// Count distinct values
const uniqueAuthors = await prisma.post.count({
  distinct: ['authorId'],
});
```

### Sum, Average, Min, Max

```typescript
const stats = await prisma.post.aggregate({
  where: { status: 'published' },
  _sum: { viewCount: true },
  _avg: { viewCount: true },
  _min: { viewCount: true },
  _max: { viewCount: true },
});

console.log(stats._sum.viewCount); // Total views
console.log(stats._avg.viewCount); // Average views
```

### Group By

```typescript
// Group posts by status, count each group
const statusGroups = await prisma.post.groupBy({
  by: ['status'],
  _count: {
    id: true,
  },
  orderBy: {
    _count: {
      id: 'desc',
    },
  },
});

// Result: [{ status: 'published', _count: { id: 150 } }, ...]
```

### Group By with Multiple Fields

```typescript
// Count posts per author per status
const authorStatus = await prisma.post.groupBy({
  by: ['authorId', 'status'],
  _count: {
    id: true,
  },
  _sum: {
    viewCount: true,
  },
  having: {
    _count: {
      id: { gt: 5 }, // Having more than 5 posts
    },
  },
});
```

## Raw Queries

### Raw Query (SELECT)

Always use parameterized queries to prevent SQL injection:

```typescript
// Correct: Parameterized
const users = await prisma.$queryRaw<User[]>`
  SELECT * FROM "User" WHERE email = ${email}
`;

// WRONG: String concatenation (SQL injection!)
// const users = await prisma.$queryRaw(`SELECT * FROM User WHERE email = '${email}'`);
```

### Raw Execute (INSERT, UPDATE, DELETE)

```typescript
const result = await prisma.$executeRaw`
  UPDATE "User" SET credits = credits + ${amount} WHERE id = ${userId}
`;

console.log(result); // Number of rows affected
```

### Raw with Objects

```typescript
const userId = '123';
const increment = 100;

await prisma.$executeRaw`
  UPDATE "User"
  SET credits = credits + ${increment}
  WHERE id = ${userId}
`;
```

## Complex Query Patterns

### Conditional Include

```typescript
const includeAuthor = true;

const post = await prisma.post.findUnique({
  where: { id: postId },
  include: {
    author: includeAuthor, // Include only if true
    comments: { take: 5 }, // Always include last 5 comments
  },
});
```

### Dynamic Where Clause

```typescript
interface FilterOptions {
  status?: string;
  authorId?: string;
  minViews?: number;
}

function buildWhereClause(filters: FilterOptions) {
  const where: Prisma.PostWhereInput = {};

  if (filters.status) where.status = filters.status;
  if (filters.authorId) where.authorId = filters.authorId;
  if (filters.minViews) where.viewCount = { gte: filters.minViews };

  return where;
}

const posts = await prisma.post.findMany({
  where: buildWhereClause({ status: 'published', minViews: 100 }),
});
```

### Pagination with Count

```typescript
const pageSize = 20;
const pageNumber = 1;

const [posts, total] = await prisma.$transaction([
  prisma.post.findMany({
    where: { status: 'published' },
    orderBy: { createdAt: 'desc' },
    take: pageSize,
    skip: (pageNumber - 1) * pageSize,
  }),
  prisma.post.count({
    where: { status: 'published' },
  }),
]);

const totalPages = Math.ceil(total / pageSize);
```

### Finding Duplicates

```typescript
const duplicates = await prisma.user.groupBy({
  by: ['email'],
  having: {
    email: {
      _count: {
        gt: 1,
      },
    },
  },
});
```

### Recent Activity

```typescript
const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const recentPosts = await prisma.post.findMany({
  where: {
    createdAt: { gte: oneWeekAgo },
  },
  orderBy: { createdAt: 'desc' },
});
```

## Tips & Best Practices

1. **Always use parameterized queries** — `$queryRaw` with template literals prevents SQL injection
2. **Avoid N+1** — use `include` or `select` to load relations upfront
3. **Use cursor pagination** — more efficient than offset
4. **Batch operations** — `createMany`, `updateMany` reduce round trips
5. **Type your selects** — use `Prisma.validator()` for consistency
6. **Index filter fields** — add `@@index` in schema for fields you frequently filter on
7. **Use `take` and `skip`** — limit results for large tables
8. **Aggregate efficiently** — let database do counting, not your application
9. **Test with data** — N+1 problems show up at scale
10. **Monitor slow queries** — enable `log: ['query']` in development
