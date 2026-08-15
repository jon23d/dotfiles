# Prisma Migration Workflow Reference

## Full Migration Lifecycle

### 1. Local Development: Schema Change to Migration

```bash
# Step 1: Edit schema.prisma
# Example: Add subscription field to User model

# Step 2: Generate migration
prisma migrate dev --name add_subscription_field

# This does:
# - Runs existing migrations
# - Compares your schema to database
# - Generates SQL migration file
# - Applies migration to dev database
# - Regenerates Prisma Client
```

### 2. Migration File

Generated file path: `prisma/migrations/20240308143000_add_subscription_field/`

```sql
-- prisma/migrations/20240308143000_add_subscription_field/migration.sql

-- AlterTable
ALTER TABLE "User" ADD COLUMN "subscriptionTier" TEXT NOT NULL DEFAULT 'free';

-- CreateIndex
CREATE INDEX "User_subscriptionTier_idx" ON "User"("subscriptionTier");
```

**Key points:**

- Filename includes timestamp (ensures order)
- Readable migration name follows timestamp
- SQL is database-specific (PostgreSQL example above)
- Default values applied to existing rows automatically
- Indexes created for performance

### 3. Code Review & Commit

```bash
# Review the generated SQL
git diff prisma/migrations/

# If SQL looks wrong, delete migration and try again
rm -rf prisma/migrations/20240308143000_add_subscription_field/
prisma migrate dev --name add_subscription_field

# Once approved, commit
git add prisma/migrations/
git add prisma/schema.prisma
git commit -m "feat: add subscription tier field to User"
```

### 4. Team Collaboration

Team member pulls your changes:

```bash
# Pull your migration
git pull

# Apply pending migrations to their dev database
prisma migrate dev

# Their schema.prisma and database are now in sync
```

### 5. Production Deployment

In your CI/CD pipeline:

```yaml
# .github/workflows/deploy.yml
- name: Install dependencies
  run: npm ci

- name: Run migrations
  run: npx prisma migrate deploy
  env:
    DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}

- name: Deploy application
  run: npm run build && npm start
```

**Why `migrate deploy` in production:**

- Runs all pending migrations in order
- Fails if any migration fails (stops deployment)
- Creates `_prisma_migrations` tracking table automatically
- Never creates new migration files (safe in production)

## Migration Naming Conventions

Good migration names are:

- Descriptive: `add_email_verification_field`
- Passive: `add_` / `remove_` / `rename_` / `create_`
- Specific: `add_email_field_to_user` (not just `update`)

```bash
# GOOD names
prisma migrate dev --name add_stripe_customer_id
prisma migrate dev --name create_organization_members_table
prisma migrate dev --name rename_posts_to_articles
prisma migrate dev --name add_soft_delete_timestamp

# AVOID these
prisma migrate dev --name changes
prisma migrate dev --name fix_bug
prisma migrate dev --name update
```

## Breaking Schema Changes

Breaking changes require multi-step migrations to avoid downtime.

### Problem: Renaming a Populated Column

Direct rename causes data loss if done wrong. Use expand-contract pattern:

```prisma
// WRONG: Direct rename causes data loss
model User {
  // ...
  // oldColumn → newColumn
}
```

### Solution: Multi-Step Migration

**Step 1: Add new column** (while old column still exists)

```bash
prisma migrate dev --name add_email_address_column
```

```prisma
model User {
  id    String @id
  email String @unique // OLD
  emailAddress String? // NEW
}
```

**Step 2: Backfill data**

```bash
# Create manual migration for backfill
npx prisma migrate dev --name backfill_email_address
```

Edit the generated migration:

```sql
-- Backfill new column from old column
UPDATE "User" SET "emailAddress" = "email" WHERE "emailAddress" IS NULL;
```

**Step 3: Remove old column** (in separate deployment)

```bash
prisma migrate dev --name remove_email_column
```

```prisma
model User {
  id    String @id
  emailAddress String @unique // NEW, now primary
}
```

**Why multi-step?**

- Old code can read/write both columns during transition
- Zero downtime
- Safe rollback at each step

## Common Migration Scenarios

### Adding a Required Field to Populated Table

```prisma
// This is problematic:
model Post {
  // ...
  slug String // Required, but existing posts have no slug!
}
```

**Solution: Make optional first, then backfill**

Step 1: Make optional with default

```bash
prisma migrate dev --name add_slug_field
```

```prisma
model Post {
  id    String @id
  title String
  slug  String? @unique // Optional initially
}
```

Step 2: Backfill with data

```sql
-- migrations/20240308143100_backfill_post_slugs/migration.sql
UPDATE "Post"
SET "slug" = LOWER(REPLACE("title", ' ', '-'))
WHERE "slug" IS NULL;
```

Step 3: Make required

```bash
prisma migrate dev --name make_slug_required
```

```prisma
model Post {
  id    String @id
  title String
  slug  String @unique // Now required
}
```

### Changing Field Type

```prisma
// PostgreSQL: INT to TEXT
model Product {
  // sku: Int // OLD type
  sku: String // NEW type
}
```

Generated migration with casting:

```sql
ALTER TABLE "Product" ALTER COLUMN "sku" TYPE TEXT USING "sku"::text;
```

## Dealing with Migration Conflicts

### Scenario: Two Developers Create Conflicting Migrations

Developer A creates: `20240308_add_user_phone.sql`
Developer B creates: `20240308_add_user_api_key.sql`

Both timestamps are similar, causing ordering issues.

**Solution:**

```bash
# Option 1: Squash into single migration (if not yet pushed)
rm -rf prisma/migrations/20240308_add_user_phone
rm -rf prisma/migrations/20240308_add_user_api_key
# Reapply both schema changes
prisma migrate dev --name add_user_phone_and_api_key

# Option 2: Rebase migrations (advanced)
# Delete both, let one dev regenerate theirs
```

## Baseline: Existing Database

When starting Prisma on an existing database:

```bash
# 1. Introspect existing database
prisma db pull

# 2. Review generated schema.prisma
cat prisma/schema.prisma

# 3. Create baseline migration
prisma migrate resolve --applied 20240308_baseline

# This creates prisma/migrations/20240308_baseline/migration.sql
# (empty file, just marks that your current schema is "baseline")

# 4. From now on, use normal workflow
prisma migrate dev --name add_new_field
```

**Without baseline:** Prisma thinks your existing database is unmanaged, tries to recreate everything.

## Production Migration Deployment

### Pre-Deployment Checks

```bash
# Validate migrations can run
npx prisma migrate deploy --dry-run

# Show pending migrations
npx prisma migrate status
```

### Handling Long-Running Migrations

For tables with millions of rows, migrations can lock tables:

```sql
-- This locks the entire table, causing downtime:
ALTER TABLE "Post" ADD COLUMN "searchVector" tsvector;

-- Better: Add column unlogged, index separately
ALTER TABLE "Post" ADD COLUMN "searchVector" tsvector;
CREATE INDEX CONCURRENTLY "Post_searchVector_idx" ON "Post" USING GIN("searchVector");
```

```prisma
// In schema.prisma, use @@index to create CONCURRENTLY
model Post {
  // ...
  searchVector String? @db.Unsupported("tsvector")
  @@fulltext([searchVector]) // PostgreSQL full-text search
}
```

### Rollback: No Native Support

Prisma doesn't support rollback (by design). Instead:

**Option 1: Manual SQL Rollback**

```sql
-- If migration created a table, drop it:
DROP TABLE "NewTable";

-- If migration added a column, remove it:
ALTER TABLE "User" DROP COLUMN "newField";

-- If migration dropped data, restore from backup
```

**Option 2: Create Reverse Migration**

```bash
# Instead of rolling back, create new migration undoing changes
prisma migrate dev --name undo_add_subscription_field
```

Then edit migration to undo changes:

```sql
-- migrations/20240308143200_undo_add_subscription_field/migration.sql
ALTER TABLE "User" DROP COLUMN "subscriptionTier";
```

## Shadow Database

The shadow database is a temporary database Prisma uses to check if migrations work before applying to real database.

### When Needed

- MySQL (required)
- SQL Server (required)
- PostgreSQL (optional, but recommended for production)

### Configuration

```prisma
// prisma/schema.prisma
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
  shadowDatabaseUrl = env("SHADOW_DATABASE_URL") // Required for MySQL
}
```

```bash
# .env
DATABASE_URL="mysql://user:password@localhost:3306/myapp"
SHADOW_DATABASE_URL="mysql://user:password@localhost:3306/myapp_shadow"
```

### How It Works

```
1. Prisma reads your schema
2. Applies migrations to shadow database
3. Compares schema to shadow database
4. If valid, applies to real database
5. Shadow database is cleaned up
```

**Why it matters:**

- Catches SQL errors before touching production
- Validates indexes, constraints work
- Required for some database systems

## Migration Best Practices

1. **Always run `migrate dev` after schema changes** — ensures migration is generated
2. **Review generated SQL** — catch unexpected changes
3. **Name migrations clearly** — future you will thank you
4. **Commit migration files to git** — they're part of your codebase
5. **Never edit migration files manually** — recreate migration instead
6. **Use multi-step migrations for breaking changes** — zero-downtime deploys
7. **Test migrations on staging** — before production
8. **Keep migrations small and focused** — easier to debug issues
9. **Use `migrate deploy --dry-run`** — check what will run
10. **Monitor production migrations** — long-running migrations can block app

## Troubleshooting

### "Migrations are out of sync with database"

```bash
# See what Prisma thinks is deployed
prisma migrate status

# Reset dev database (loses data!)
prisma migrate reset

# Or manually sync:
prisma migrate resolve --applied 20240308_migration_name
```

### "Migration failed, but I can't rollback"

```bash
# Check _prisma_migrations table to see what ran
SELECT * FROM "_prisma_migrations" ORDER BY "startedAt" DESC;

# Manually fix database, then mark migration as applied
prisma migrate resolve --rolled-back 20240308_migration_name
```

### "Shadow database permission denied"

```bash
# Ensure shadow database user has full permissions
GRANT ALL PRIVILEGES ON myapp_shadow.* TO user@localhost;
FLUSH PRIVILEGES;
```

### "Prisma Client out of sync"

```bash
# Regenerate Prisma Client after migration
npx prisma generate

# Or this happens automatically with:
prisma migrate dev
```

## Quick Reference

| Command                                  | Use Case                                 |
| ---------------------------------------- | ---------------------------------------- |
| `prisma migrate dev --name X`            | Create migration locally                 |
| `prisma migrate deploy`                  | Apply pending migrations (production)    |
| `prisma db push`                         | Direct schema sync (prototyping only)    |
| `prisma migrate reset`                   | Nuke and restart dev database            |
| `prisma migrate status`                  | See pending migrations                   |
| `prisma migrate resolve --applied X`     | Mark migration as applied (baseline)     |
| `prisma migrate resolve --rolled-back X` | Mark migration as rolled back (recovery) |
| `prisma db pull`                         | Introspect existing database             |

## Example: Complete SaaS Workflow

```bash
# 1. Developer adds feature
# Edit schema.prisma: Add 'apiKey' field to User

# 2. Generate and test migration
prisma migrate dev --name add_user_api_key

# 3. Verify generated SQL
cat prisma/migrations/20240308143000_add_user_api_key/migration.sql
# ✓ Looks good

# 4. Commit to git
git add -A && git commit -m "feat: add API key support to users"
git push origin feature/api-keys

# 5. Open PR, get code review
# Reviewer checks:
# - Schema changes make sense
# - Migration SQL is correct
# - No production data at risk

# 6. Merge to main
git merge --no-ff feature/api-keys

# 7. Deploy to production
# CI/CD runs:
npx prisma migrate deploy

# 8. Team member pulls changes
git pull
prisma migrate dev
# ✓ Their local database updated automatically
```
