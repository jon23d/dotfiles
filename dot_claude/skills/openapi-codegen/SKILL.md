---
name: openapi-codegen
description: Use whenever a backend endpoint is created or modified, or whenever a frontend needs to call an API, or when verifying that the OpenAPI spec matches the running API. Covers spec-first contract design, codegen, monorepo structure, the service/hook layer, spec verification against the running API, and documentation UI checks.
---

# OpenAPI Codegen — Type-Safe API Contracts

This skill enforces a spec-first, codegen-driven contract between backend and frontend packages in a monorepo. The OpenAPI spec is the source of truth. The generated client is the only way the frontend calls the backend. Hand-written types for API shapes are never acceptable.

---

## Toolchain

```bash
# Type generation (dev dependency, monorepo root or api-client package)
npm install -D openapi-typescript

# Typed fetch client (runtime dependency in frontend packages)
npm install openapi-fetch
```

- **`openapi-typescript`** — generates a `paths` and `components` type tree from your spec. Zero runtime footprint.
- **`openapi-fetch`** — a tiny fetch wrapper that binds to those generated types, giving you end-to-end type safety on every request and response.

---

## Monorepo Structure

```
packages/
  api-client/               # Shared package — generated types + typed client factory
    src/
      generated.d.ts        # AUTO-GENERATED. Never edit by hand.
      index.ts              # Exports the configured client instance
    package.json
apps/
  api/                      # Backend
    openapi.yaml            # Source of truth for the entire API contract
  web/                      # Frontend (or mobile/, admin/, etc.)
    src/
      services/             # Service layer — wraps api-client, returns domain types
      hooks/                # Custom hooks — wrap services via TanStack Query
```

---

## The OpenAPI Spec (Auto-Generated)

The spec is auto-generated from the backend's route definitions and validation schemas — it is never hand-authored. The backend framework derives the spec directly from the same TypeBox/Zod schemas used for runtime validation, and exposes it at a well-known endpoint (typically `/docs/json`).

**What this requires of backend engineers:**

- Every route must be decorated with enough schema information for a complete spec entry: request params/body shape, all response shapes (including errors), and auth requirements.
- Every route must have an `operationId`.
- Error response schemas must be registered as named components.

Example (Fastify + TypeBox):

```typescript
fastify.get(
  '/users/:id',
  {
    schema: {
      operationId: 'getUserById',
      params: Type.Object({ id: Type.String() }),
      response: {
        200: UserSchema,
        404: ErrorResponseSchema,
        401: ErrorResponseSchema,
      },
      security: [{ bearerAuth: [] }],
    },
  },
  handler,
);
```

---

## Generation Script

**Option A — from the running dev server (local development):**

```json
{
  "scripts": {
    "codegen": "openapi-typescript http://localhost:3000/docs/json -o ./packages/api-client/src/generated.d.ts"
  }
}
```

**Option B — from a static export (CI / no running server required):**

```json
{
  "scripts": {
    "export-spec": "node ./apps/api/scripts/export-spec.ts",
    "codegen": "npm run export-spec && openapi-typescript ./apps/api/openapi.json -o ./packages/api-client/src/generated.d.ts"
  }
}
```

Codegen must be run after any backend schema or route change, and the generated file committed alongside the backend change.

---

## The Typed Client (`packages/api-client/src/index.ts`)

```typescript
import createClient from 'openapi-fetch';
import type { paths } from './generated';

export const apiClient = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  credentials: 'include',
});

export type { paths, components } from './generated';
```

---

## Service Layer (`apps/web/src/services/`)

Services wrap the typed client and return domain-typed objects. They never expose raw `response` objects or `any`.

```typescript
import { apiClient } from '@myapp/api-client';
import type { components } from '@myapp/api-client';

export type User = components['schemas']['User'];

export async function fetchUser(id: string): Promise<User> {
  const { data, error } = await apiClient.GET('/users/{id}', {
    params: { path: { id } },
  });
  if (error) throw new Error(error.message ?? 'Failed to fetch user');
  return data;
}
```

**Rules:** Import from `@myapp/api-client`, always destructure `{ data, error }`, throw on error, derive return types from `components['schemas']`.

---

## Hook Layer (`apps/web/src/hooks/`)

Custom hooks wrap services using TanStack Query. Components import only hooks.

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchUser, updateUser } from '@/services/userService';

export const userKeys = {
  all: ['users'] as const,
  detail: (id: string) => ['users', 'detail', id] as const,
};

export function useUser(id: string) {
  return useQuery({
    queryKey: userKeys.detail(id),
    queryFn: () => fetchUser(id),
    enabled: !!id,
  });
}
```

---

## The Full Contract (Summary)

```
openapi.yaml          ← backend writes this first (spec-first)
     ↓  npm run codegen
generated.d.ts        ← never touch
     ↓  imported by
apiClient             ← one instance in @myapp/api-client
     ↓  imported by
services/             ← transform API calls into typed domain functions
     ↓  imported by
hooks/                ← wrap services in TanStack Query
     ↓  imported by
components            ← consume only hooks, never anything below
```

Any shortcut in this chain is a contract violation.

---

## CI Integration

```yaml
- name: Export OpenAPI spec from backend
  run: npm run export-spec

- name: Verify generated client is up to date
  run: |
    npm run codegen
    git diff --exit-code packages/api-client/src/generated.d.ts
```

---

## Backend Engineer Responsibilities

1. Design schemas before writing handlers.
2. Fully decorate every route — `operationId`, all shapes, auth.
3. Run codegen after any route/schema change and commit alongside the backend change.
4. Treat schema changes as breaking changes.

## Frontend Engineer Responsibilities

1. Run codegen before writing any code that touches a new/modified endpoint.
2. Regenerate the client whenever you pull changes that include spec updates.
3. TypeScript errors from the generated types are intentional signals — resolve them, don't cast.

---

## Spec Verification (QA)

When verifying that the spec matches the running API:

### Locating the spec file

Look for: `openapi.yaml`/`openapi.json` in project root, `docs/`, or `api/`. Missing spec is `critical`.

### Starting the dev server

Start with the project's dev command in the background. Poll the base URL every 2 seconds for up to 30 seconds. Always stop the server when finished.

### Authentication token

Attempt in order: `TEST_AUTH_TOKEN`/`API_TOKEN`/`AUTH_TOKEN` env vars → `.env.test`/`.env.local`/`.env.example` credentials → README test credentials → graceful degradation (verify protected endpoints return 401/403).

### Verification steps per changed endpoint

1. **Endpoint exists in spec** — path and method documented. Missing = `major`.
2. **Request shape matches** — body schema and query params match spec.
3. **Response shape matches** — all fields documented, types match, nested structures match. Mismatch = `major`.
4. **Status codes match** — success, 400, 401/403, 404 all documented. Undocumented status code = `major`.
5. **Auth requirements match** — spec matches actual auth behavior. Mismatch = `major`.

**Ignore:** minor formatting differences, optional fields present in response, endpoints not changed in this task.

### Documentation UI verification

Check these endpoints for a docs UI: `/docs`, `/api-docs`, `/swagger`, `/reference`, `/docs/`, `/api/docs`. At least one must return HTML with API docs evidence. Also check for raw spec at `/openapi.yaml`, `/openapi.json`, `/docs/openapi.yaml`, `/docs/openapi.json`, `/api-docs/openapi.yaml`, `/api/openapi.yaml`, `/api/openapi.json`. Verify consistency between UI spec and raw spec.

**Ignore:** visual styling, auth on docs endpoints, non-HTTP projects.
