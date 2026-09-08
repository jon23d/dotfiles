---
name: openapi-codegen
description: Use whenever a backend endpoint is created or modified, or whenever a frontend needs to call an API, or when verifying that the OpenAPI spec matches the running API. Covers spec-first contract design, codegen, the service layer, spec verification against the running API, and documentation UI checks.
---

# OpenAPI Codegen — Type-Safe API Contracts

This skill enforces a spec-first, codegen-driven contract between backend and frontend packages. The OpenAPI spec is the source of truth. The generated client is the only way the frontend calls the backend. Hand-written types for API shapes are never acceptable.

---

## The OpenAPI Spec (Auto-Generated)

The spec should be generated from the backend's own route definitions and validation logic — never hand-authored — so it cannot drift from the actual implementation. The backend framework should derive the spec directly from the same schemas used for runtime validation, and expose it at a well-known endpoint.

**What this requires of backend engineers:**

- Every route must be decorated with enough schema information for a complete spec entry: request params/body shape, all response shapes (including errors), and auth requirements.
- Every route must have a stable operation identifier.
- Error response schemas must be registered as named, reusable components.

See the stack-specific guidance for a concrete framework example.

---

## Generation

Codegen must be run after any backend schema or route change, and the resulting generated client artifact committed alongside the backend change. Two generation sources are typical:

- **From the running dev server** (local development) — point the codegen tool at the live spec endpoint.
- **From a static export** (CI / no running server required) — export the spec to a file first, then generate from that file.

---

## The Full Contract (Summary)

```
openapi spec          ← backend writes this first (spec-first)
     ↓  codegen
generated client code ← never touch by hand
     ↓  imported by
service layer          ← transforms API calls into typed domain functions
     ↓  imported by
UI / consumers          ← consume only the service layer, never anything below
```

Any shortcut in this chain is a contract violation.

---

## CI Integration

CI must fail if the generated client is out of date relative to the spec:

```yaml
- name: Export the OpenAPI spec from the backend
  run: <export-spec command>

- name: Verify the generated client is up to date
  run: |
    <codegen command>
    git diff --exit-code <path to generated client file>
```

---

## Backend Engineer Responsibilities

1. Design schemas before writing handlers.
2. Fully decorate every route — operation id, all shapes, auth.
3. Run codegen after any route/schema change and commit alongside the backend change.
4. Treat schema changes as breaking changes.

## Frontend Engineer Responsibilities

1. Run codegen before writing any code that touches a new/modified endpoint.
2. Regenerate the client whenever you pull changes that include spec updates.
3. Type errors from the generated types are intentional signals — resolve them, don't work around them with an unsafe cast.

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

## Stack-specific guidance

Read `references/typescript.md` for TypeScript/Node-specific implementation detail before applying this skill to a TypeScript repo. A Go equivalent (`references/golang.md`) does not exist yet — if this skill applies to a Go repo, flag the gap rather than force-fitting the TypeScript reference.
