---
name: effective-typescript
description: Use when writing, reviewing, or refactoring TypeScript code — especially when tempted to use `any`, type assertions, unvalidated casts, or when designing types, generics, utility types, or tsconfig settings.
---

# Effective TypeScript

## Overview

TypeScript's value comes from the compiler catching bugs at build time. Every `any`, unchecked cast, or missing guard is a hole where runtime errors sneak through.

## When to use

- Writing new TypeScript code
- Converting JavaScript to TypeScript
- Designing interfaces, generics, or utility types
- Configuring tsconfig
- Handling data from APIs, external libraries, or user input

## Rules — follow these without exception

### 1. Never use `any`

`any` silences the compiler and makes type safety a lie. There is always a better alternative.

- Use `unknown` for values of uncertain type — then narrow before use
- Use `Record<string, unknown>` for plain objects with unknown shape
- Use generics (`<T>`) for code that must work across types
- Use `never` for exhaustiveness checks

**No exceptions:**

- "It's contained/explicit" → `any` still propagates. Use `unknown`.
- "The library types are bad" → Use `unknown` and narrow, or add a type declaration file.
- "It's just internal code" → `any` in internal code causes the same runtime errors.

### 2. Never use unchecked type assertions (`as T`)

`as T` is a promise to the compiler you cannot keep. If the data doesn't match `T`, you get silent undefined behavior.

- For API/network responses → validate with a schema library (Zod, Valibot, etc.) or write a type guard
- For `JSON.parse` → validate the result before asserting the type
- For external library data → use `unknown` + type guard, not `as T`

**Acceptable uses of `as`:**

- Narrowing within a type guard you've already proven: `(value as MyType).field` after checking `isMyType(value)`
- DOM types that the compiler can't infer: `document.getElementById('x') as HTMLInputElement`

**Rationalization to reject:**

- "The caller owns the assertion" → the caller cannot verify the runtime shape either
- "It's pragmatic" → pragmatic means it defers the bug, not eliminates it

### 3. Validate all external data at the boundary

Data from APIs, `JSON.parse`, `req.body`, user input, and third-party libraries is `unknown` until proven otherwise.

Pattern:

```typescript
// BAD
const user = (await response.json()) as User;

// GOOD — with Zod
import { z } from 'zod';
const UserSchema = z.object({ id: z.number(), name: z.string(), email: z.string() });
const user = UserSchema.parse(await response.json()); // throws on mismatch
```

If you can't use a schema library, write an explicit type guard:

```typescript
function isUser(val: unknown): val is User {
  return (
    typeof val === 'object' &&
    val !== null &&
    typeof (val as Record<string, unknown>).name === 'string'
  );
}
```

### 4. Use discriminated unions + exhaustiveness checks

Model variants with a literal `type` or `kind` field. Always add an exhaustiveness check.

```typescript
type Shape = { kind: 'circle'; radius: number } | { kind: 'rect'; width: number; height: number };

function area(s: Shape): number {
  switch (s.kind) {
    case 'circle':
      return Math.PI * s.radius ** 2;
    case 'rect':
      return s.width * s.height;
    default: {
      const _exhaustive: never = s; // compile error if a variant is unhandled
      throw new Error(`Unhandled: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
```

### 5. Generics over `any` for reusable code

When code must work across multiple types, use a type parameter — not `any`.

```typescript
// BAD
function first(arr: any[]): any {
  return arr[0];
}

// GOOD
function first<T>(arr: T[]): T | undefined {
  return arr[0];
}
```

Constrain generics when the type must satisfy a shape:

```typescript
function getField<T extends object, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
```

### 6. Use utility types — don't repeat type definitions

- `Partial<T>` — all fields optional
- `Required<T>` — all fields required
- `Readonly<T>` — immutable
- `Pick<T, K>` / `Omit<T, K>` — structural subsets
- `ReturnType<typeof fn>` — infer from function
- `Parameters<typeof fn>` — infer from function params
- `NonNullable<T>` — strip `null | undefined`

Don't re-declare types that can be derived. If `User` changes, derived types update automatically.

### 7. tsconfig — always use strict mode and path aliases

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"]
}
```

- `"strict": true` is not optional — enable it from day one, even for prototypes
- `noUncheckedIndexedAccess` — array index access returns `T | undefined`, not `T`
- `exactOptionalPropertyTypes` — distinguishes `{ x?: string }` from `{ x: string | undefined }`
- "It's just a prototype" → bugs built into prototypes ship to production
- **`baseUrl` + `paths` are required in every app.** Relative imports like `../../../hooks/useUser` are hard to read and break silently when files move. Always import via the alias instead:

```typescript
// Bad — fragile and hard to read
import { useUser } from '../../../hooks/useUser';
import { Button } from '../../components/Button';

// Good — clear and refactor-safe
import { useUser } from '@/hooks/useUser';
import { Button } from '@/components/Button';
```

Bundlers don't read `tsconfig.json` automatically — pair the alias definition with the appropriate plugin (`vite-tsconfig-paths` for Vite, `tsconfig-paths-webpack-plugin` for Webpack). TypeScript and the bundler must always agree on what `@/` resolves to.

### 8. Trust inference — don't annotate what the compiler already knows

TypeScript's inference is strong. Redundant annotations add noise and create maintenance burden when types change.

**Don't annotate:**

- Variables assigned from typed expressions: `const user = userFactory.build()` — not `const user: User = ...`
- Return types the body makes obvious: `function add(a: number, b: number) { return a + b }`
- Callback parameters: `.map((item) => ...)` — not `.map((item: SomeType) => ...)`
- Generic type parameters the compiler resolves: `useState(0)` — not `useState<number>(0)`

**Do annotate:**

- Exported function signatures — they're module boundaries and documentation
- When inference produces `any` or a wider type than intended
- Empty collections that need a specific type: `const items: User[] = []`
- Complex return types that aren't obvious from the function body

**Rationalization to reject:**

- "Explicit types are more readable" → redundant types are noise, not documentation. If the right-hand side says `new Map<string, User>()`, writing `const users: Map<string, User> =` repeats information.
- "It catches bugs earlier" → the compiler already caught it. You're just typing it twice.

## Common anti-patterns and fixes

- `as any` to do optional chaining on `unknown` → use a type guard or optional chaining on `unknown` after narrowing
- `parseJSON<T>` with `return JSON.parse(s) as T` → validate with Zod or a type guard
- `response.json() as SomeType` → use `SomeSchema.parse(await response.json())`
- `cache.get(key) as T` → document that callers must track what they stored; return `unknown` and let callers narrow
- Interfaces with `[key: string]: any` → use `Record<string, unknown>` or a proper discriminated union

## Red flags — stop and reassess

- About to write `any` → use `unknown` instead
- About to write `as SomeType` on external data → validate first
- `JSON.parse` result used directly → validate before use
- `switch` on a union with no `default: never` exhaustiveness check → add it
- `"strict": false` in tsconfig → set it to `true`
- Thinking "this is too complex to type properly" → use generics
- Thinking "I'll add proper types later" → types added later miss the bugs types were meant to catch
- Writing a relative import that traverses more than one directory (`../../`) → define or use a path alias instead
