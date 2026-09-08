# TDD — TypeScript

## Running tests

**During cycles:** run the single test file or a filtered subset (`npx vitest run path/to/file.test.ts`, or `-t` on the test name).

**Before reporting back:** run the tests and checks covering what you changed — the affected package only. Typically `pnpm --filter <package> test`, `typecheck`, `lint`, plus prettier on the files you touched. Zero errors required.

---

## When to use testcontainers vs MSW vs factories

- **Code that directly calls the database** (repositories, query functions) → **integration tests with testcontainers**. Mock nothing. Use a real PostgreSQL container.
- **Code that directly calls HTTP APIs** (API clients, services that call `fetch`, TanStack Query hooks) → **integration tests with MSW**. Mock nothing at the code level — MSW intercepts the network.
- **Everything else** (domain logic, handlers, utilities) → **unit tests with factories**.

Do not mock Prisma in unit tests — if the code calls Prisma, it belongs in a repository with an integration test.
Do not mock `fetch` or stub HTTP clients with `vi.fn()` — if the code makes HTTP requests, use MSW to intercept them at the network level.

---

## Integration tests with testcontainers + Prisma

Install: `npm install --save-dev @testcontainers/postgresql testcontainers`

### Container lifecycle (once per test file)

```ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const url = container.getConnectionUri();
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url } });
  prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$connect();
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
  await container.stop();
});
```

### Test isolation — transaction rollback per test

Each test runs inside an interactive transaction that is never committed:

```ts
let tx: Prisma.TransactionClient;
let rollback: (err: Error) => void;

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    rollback = reject;
    prisma
      .$transaction(async (t) => {
        tx = t;
        resolve();
        await new Promise<never>(() => {});
      })
      .catch(() => {});
  });
});

afterEach(() => {
  rollback(new Error('rollback'));
});
```

All queries within a test **must use `tx`**, not the global `prisma`.

---

## Integration tests with MSW

Install: `npm install --save-dev msw`

### Server lifecycle (once per test file)

```ts
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

`onUnhandledRequest: 'error'` makes any request without a handler fail the test — no silent network leaks.

### Define handlers per test

Define handlers inside each test (or `beforeEach` for a shared happy path). Keep handlers close to the assertions that depend on them:

```ts
it('returns the user profile', async () => {
  server.use(
    http.get('https://api.example.com/users/:id', ({ params }) => {
      return HttpResponse.json({
        id: params.id,
        name: 'Jane Doe',
        email: 'jane@example.com',
      });
    }),
  );

  const profile = await userService.getProfile('user-1');

  expect(profile).toEqual({
    id: 'user-1',
    name: 'Jane Doe',
    email: 'jane@example.com',
  });
});
```

### Error and edge-case scenarios

Use `server.use()` to override the happy path for individual tests:

```ts
it('throws on server error', async () => {
  server.use(
    http.get('https://api.example.com/users/:id', () => {
      return new HttpResponse(null, { status: 500 });
    }),
  );

  await expect(userService.getProfile('user-1')).rejects.toThrow('Server error');
});

it('handles network failure', async () => {
  server.use(
    http.get('https://api.example.com/users/:id', () => {
      return HttpResponse.error();
    }),
  );

  await expect(userService.getProfile('user-1')).rejects.toThrow();
});
```

### Rules

- **One `setupServer()` per test file.** Do not share server instances across files.
- **`onUnhandledRequest: 'error'`** is non-negotiable. Silent passthrough hides real bugs.
- **Define handlers in tests, not in shared fixture files.** The test must be readable without jumping to another file. Exception: a shared `handlers.ts` for a large API surface where every test uses the same happy path — but per-test overrides via `server.use()` still go in the test.
- **Do not assert on request details** (headers, body) unless the test is specifically about how the request is formed. Test the _outcome_ (what your code does with the response), not the _request_.
- **Use `HttpResponse.json()`, `HttpResponse.text()`, or `new HttpResponse()`** — never return plain objects.

---

## Factories

Every domain type has a factory in `test_utils/factories/`. **Never define factory functions inside a test file.** Always use `randomUUID()` for IDs.

**Use factories for test data setup — never call repository methods directly.** Exception: a repository's own test of a method may call that method directly, since the method itself is what's under test. All other test data, including setup for the entity being tested, goes through the factory.

**BaseFactory:**

```ts
export abstract class BaseFactory<T> {
  abstract build(overrides?: Partial<T>): T;
  buildList(count: number, overrides?: Partial<T>): T[] {
    return Array.from({ length: count }, () => this.build(overrides));
  }
}
```

**Domain factory:**

```ts
class UserFactory extends BaseFactory<User> {
  build(overrides: Partial<User> = {}): User {
    return {
      id: randomUUID(),
      name: 'Test User',
      email: `test-${randomUUID()}@example.com`,
      isAdmin: false,
      tier: 'free',
      ...overrides,
    };
  }
  admin(overrides: Partial<User> = {}): User {
    return this.build({ isAdmin: true, ...overrides });
  }
}
export const userFactory = new UserFactory();
```

For integration tests, use a thin `create` helper that inserts via `tx`:

```ts
async function createUser(overrides: Partial<User> = {}) {
  return tx.user.create({ data: userFactory.build(overrides) });
}
```

---

## Mocking with vi.fn / vi.mock

Mock at module boundaries only: external services, database clients, filesystem. Prefer dependency injection over `vi.mock`. Create `vi.fn()` mocks inside each `it` block. For HTTP APIs, use MSW instead of `vi.fn()` — see the MSW section above.

## Table-driven tests

```ts
it.each([
  ['free', 100, 100],
  ['pro', 100, 90],
  ['enterprise', 100, 80],
] as const)('applies correct discount for %s tier', (tier, input, expected) => {
  const user = userFactory.build({ tier });
  expect(applyDiscount(input, user)).toBe(expected);
});
```

## React component tests

Use React Testing Library. Query by accessible role, label, or visible text. Never `getByTestId`. Use `userEvent` (not `fireEvent`). Test all three data states: loading, error, success.

## Red flags — TypeScript specifics

- About to mock Prisma instead of using testcontainers
- About to mock `fetch` or stub an HTTP client with `vi.fn()` instead of using MSW

## Rationalizations — TypeScript specifics

- **"Setting up a container is complex"** → A Prisma mock tests nothing real.
- **"I'll just mock fetch, it's simpler"** → A fetch mock tests your mock, not your HTTP integration. MSW intercepts real requests.
