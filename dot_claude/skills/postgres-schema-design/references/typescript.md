# Postgres Schema Design — TypeScript

This project uses Prisma.

## Step 1: Confirm Prisma is set up

Look for `prisma/schema.prisma`. If it does not exist, ask before proceeding.

---

## Prisma Workflows

### New project — initial schema

1. `npx prisma init` (creates `prisma/schema.prisma` and `.env`)
2. Set provider to `postgresql`
3. Define your models (see quality rules in `SKILL.md`)
4. `npx prisma migrate dev --name init`
5. Commit: `prisma/schema.prisma` + `prisma/migrations/` folder

### Adding or changing tables/columns

1. Edit `prisma/schema.prisma` — models, fields, relations, indexes, constraints
2. `npx prisma migrate dev --name <descriptive_name>` (e.g. `add_teams`, `add_stripe_customer_id_to_orgs`)
3. **Review** the generated `prisma/migrations/<timestamp>_<name>/migration.sql` — check for unintended `DROP` statements, correct `ON DELETE` clauses, FK indexes
4. Commit `prisma/schema.prisma` and the migration folder together
5. In CI: `npx prisma migrate deploy && npx prisma generate`

### Prisma schema patterns

**UUID primary key:**

```prisma
id String @id @default(uuid())
```

**Timestamps (audit columns):**

```prisma
createdAt DateTime  @default(now()) @map("created_at")
updatedAt DateTime  @updatedAt      @map("updated_at")
deletedAt DateTime?                 @map("deleted_at")
```

**FK with explicit delete behavior:**

```prisma
organizationId String       @map("organization_id")
organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
```

**Index on FK:**

```prisma
@@index([organizationId])
```

**Unique constraint:**

```prisma
@@unique([organizationId, email])
```

**Enum:**

```prisma
enum SubscriptionStatus {
  TRIALING
  ACTIVE
  PAST_DUE
  CANCELED
  PAUSED
}
```

**Explicit join table (preferred over implicit many-to-many):**

```prisma
model TeamMember {
  teamId    String   @map("team_id")
  userId    String   @map("user_id")
  team      Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now()) @map("created_at")

  @@id([teamId, userId])
  @@index([userId])
  @@map("team_members")
}
```

### Prisma — what not to do

- Do not hand-write `migration.sql` — Prisma tracks state via checksum
- Do not run `prisma db push` in production or development (unless prototyping with accepted DB reset)
- Do not use `SERIAL`/`BIGSERIAL` for PKs

## Red flags — TypeScript specifics

- Migration exists but `prisma generate` not done → client out of sync
