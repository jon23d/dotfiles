---
name: zod-env
description: Use when adding or modifying environment variable handling in TypeScript projects or monorepos — especially when using process.env directly, missing startup validation, sharing env schemas across packages, or encountering "undefined is not a string" errors at runtime from missing env vars.
---

# Zod Env Validation

## Overview

Validate all environment variables at process startup with Zod. The process dies immediately with a clear error listing every missing variable — before handling a single request. `process.env` is never accessed directly outside the env module.

## When to use

- Setting up env handling in any new TypeScript service or monorepo package
- Adding a new environment variable to an existing service
- Refactoring raw `process.env` access scattered across a codebase
- Seeing `Cannot read properties of undefined` or `NaN` errors traced back to missing env vars

## The pattern

### 1. Shared `packages/env` — define once, compose everywhere

```typescript
// packages/env/src/index.ts
import { z, ZodObject, ZodRawShape, ZodError } from 'zod';

// Reusable schema fragments — compose with .merge() / .extend()
export const sharedSchema = {
  database: z.object({ DATABASE_URL: z.string().url() }),
  node: z.object({ NODE_ENV: z.enum(['development', 'test', 'production']) }),
};

export function createEnv<T extends ZodRawShape>(schema: ZodObject<T>): z.infer<ZodObject<T>> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const lines = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n\n${lines}\n`);
  }
  return result.data;
}
```

`packages/env/package.json` — declare `zod` here only:

```json
{
  "name": "@myorg/env",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "dependencies": { "zod": "^3.23.0" }
}
```

Each consumer adds `"@myorg/env": "workspace:*"` — **do not add `zod` directly** to consumers. All `z` usage flows through `@myorg/env` to prevent version drift.

### 2. Per-package `env.ts` — compose, don't copy

```typescript
// apps/api/src/env.ts
import { z } from 'zod';
import { createEnv, sharedSchema } from '@myorg/env';

export const env = createEnv(
  sharedSchema.database.merge(sharedSchema.node).extend({
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be ≥ 32 chars'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  }),
);
```

Only include variables the package actually uses. `packages/mailer` should not validate `DATABASE_URL` if it never queries the database.

### 3. Entry point order — `dotenv` before env module

```typescript
// apps/api/src/index.ts  ← app entry point
import 'dotenv/config'; // ← FIRST line: loads .env for local dev
import { env } from './env'; // ← SECOND: validation runs; process exits if invalid

import express from 'express';
// ... rest of app
```

`dotenv` is a dev dependency only: `pnpm add -D dotenv --filter api`

In production (CI/CD, containers) — real env vars are already set; `dotenv/config` is a no-op. **Never commit `.env` files. Always commit `.env.example`.**

### 4. Never access `process.env` outside env modules

```typescript
// BAD — scattered throughout the codebase
const client = new Resend(process.env.RESEND_API_KEY);

// GOOD — validated and typed at startup
import { env } from './env';
const client = new Resend(env.RESEND_API_KEY);
```

If a variable is accessed via raw `process.env` anywhere other than the env module, it is unvalidated and untyped. Move it into the schema.

### 5. Test isolation — `vi.stubEnv` / `jest.replaceProperty`

Never mutate `process.env` directly in tests — it leaks across test cases.

```typescript
// Vitest
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('when DATABASE_URL is missing', () => {
  it('throws at createEnv call', () => {
    vi.stubEnv('DATABASE_URL', ''); // restored automatically after each test
    expect(() => createEnv(sharedSchema.database)).toThrow('DATABASE_URL');
  });
});
```

```typescript
// Jest
describe('when DATABASE_URL is missing', () => {
  const original = process.env.DATABASE_URL;
  afterEach(() => {
    process.env.DATABASE_URL = original;
  });

  it('throws at createEnv call', () => {
    delete process.env.DATABASE_URL;
    expect(() => createEnv(sharedSchema.database)).toThrow('DATABASE_URL');
  });
});
```

## Common mistakes

- **Lazy access** — `process.env.DATABASE_URL` inside a function body, not at startup. Validation then never runs until that code path is hit in production.
- **`.parse()` instead of `.safeParse()`** — Zod's `.parse()` throws one issue at a time; `.safeParse()` + manual formatting shows all failures in one startup crash.
- **`z.string()` for PORT** — PORT arrives as a string from `process.env`; use `z.coerce.number()` or the process crashes with `Expected number, received string`.
- **`dotenv` as a regular dependency** — it only applies locally. It belongs in `devDependencies`.
- **Validating too much in shared schemas** — shared fragments (`sharedSchema.database`) should only include what truly all consumers share. Over-broad shared schemas force unrelated packages to set variables they don't use.

## `.env.example` — keep it in sync

Every time a variable is added to a schema, add it to `.env.example` in the same commit. This file is committed, `.env` is not.

```bash
# .env.example
DATABASE_URL=postgresql://user:pass@localhost:5432/mydb
NODE_ENV=development
JWT_SECRET=change-me-min-32-chars-xxxxxxxxxxx
PORT=3000
```

## Checklist

- [ ] `packages/env` owns the `zod` dependency; consumers use `workspace:*`
- [ ] `createEnv` uses `safeParse` and reports all failures in one throw
- [ ] `dotenv/config` is the first import in every app entry point (dev dep only)
- [ ] No `process.env.*` outside `env.ts` files
- [ ] Shared schema fragments composed with `.merge()` — no copy-paste across packages
- [ ] `z.coerce.number()` for numeric env vars (PORT, timeouts, pool sizes)
- [ ] Tests use `vi.stubEnv` or `jest.replaceProperty` — never direct `process.env` mutation
- [ ] `.env.example` updated in the same commit as schema changes
