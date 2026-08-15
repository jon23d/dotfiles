---
name: tdd
description: Use when writing any code — functions, modules, APIs, UI components, scripts, or any other implementation. Use when asked to "implement", "build", "write", "add", "create", or "refactor" anything that involves code. Also covers TypeScript/Vitest testing patterns, factories, mocking, and integration tests with testcontainers.
---

# TDD — Test-Driven Development

Write the test first. Run it. Watch it fail. Then write the code.

## The sequence — no skipping, no combining steps

**Step 1 — Write the test file only.** The implementation file must not exist. Write tests that describe the required behavior from the outside.

**Step 2 — Run the tests and show the failure output.** Do not proceed until you have run the test command and shown the failure.

**Step 3 — Write the minimum implementation to make the tests pass.**

**Step 4 — Run the tests again and show them passing.**

**Step 5 — Refactor if needed, keeping tests green.**

Writing tests and implementation in the same step is not tdd.

## Running tests

Run every test that CI will run — locally, before reporting back. No test suite is "CI only." This includes unit tests (`npx vitest run`), integration tests, type checking, and linting (`pnpm lint` or `npm run lint`). Zero errors required across all of them.

Whether a review follows, and who runs it, is the orchestrator's call, not this skill's — see `code-review` and `delegation`. This skill's scope ends at everything running clean.

---

## Bug fixes

**Step 1 — Write a regression test that exposes the bug.** The test fails with an assertion error (wrong output), not "module not found".

**Step 2 — Run and show the failure.**

**Step 3 — Fix the code.**

**Step 4 — Run and show all tests passing.**

## Adding features to existing files

**Step 1 — Write tests for the new feature only.** Existing code stays untouched.

**Step 2 — Run: existing pass, new tests fail.**

**Step 3 — Add minimum implementation.**

**Step 4 — Run all tests: all pass.**

## Refactoring — new structure means new tests

**The rule: if you create it, you test it.** A new class extracted from an existing function is new code. It doesn't matter that the logic existed before — the unit is new.

1. Run existing tests — must pass (safety net)
2. Perform the structural refactor
3. Run existing tests — must still pass
4. Identify every new public interface
5. For each new unit, apply the standard tdd sequence
6. Run all tests — existing and new must pass

"Existing tests pass" is Step 3. It is not Step 6.

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

## Universal test rules

- **Test behaviour, not implementation.** A test must survive an internal refactor.
- **One concept per `it`.** Multiple assertions OK if same logical outcome.
- **Tests must be hermetic.** No shared mutable state, no run-order dependency.
- **No logic in tests.** No conditionals, loops, or try/catch.
- **Name the scenario and outcome:** `returns false when order is shipped`.

## Mocking with vi.fn / vi.mock

Mock at module boundaries only: external services, database clients, filesystem. Prefer dependency injection over `vi.mock`. Create `vi.fn()` mocks inside each `it` block. For HTTP APIs, use MSW instead of `vi.fn()` — see the MSW section above.

## Async tests

Always `await` async calls. Never use `done` callbacks.

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

## Date-dependent test data

Never hardcode a calendar date tied to "the current year" (`` `${CURRENT_YEAR}-08-01` ``) or any other absolute date, when the code under test compares a date to "now" (past-date rejection, expiry checks, booking-window/cutoff logic). A hardcoded date silently goes stale the moment the calendar catches up to it — the test passes for months, then fails in CI with no code change, because the fixture is now wrong, not because of a regression. This has repeatedly bitten this codebase specifically in `checkIn`/`checkOut` reservation fixtures.

- **Compute dates relative to now.** Use or add a `daysFromNow(offsetDays)`-style helper (`new Date()` + `setUTCDate()` + `toISOString().slice(0, 10)`) instead of a literal string. Check the test file and sibling test files hitting the same endpoint for an existing helper before writing a new one.
- **Or freeze time** with `vi.setSystemTime()` / `vi.useFakeTimers()` when the test needs a fixed "today" to assert against — restore it in `afterEach`.
- When fixing one instance of this bug, grep the rest of the file for the same pattern (e.g. `grep -n '${CURRENT_YEAR}'` or a literal year). It tends to occur in clusters — one file with a good relative-date helper still has hardcoded dates scattered through other tests that were written without reusing it.

## React component tests

Use React Testing Library. Query by accessible role, label, or visible text. Never `getByTestId`. Use `userEvent` (not `fireEvent`). Test all three data states: loading, error, success.

## Coverage

Do not chase numbers. Aim for tests that would catch real regressions.

---

## Implementation ordering

This skill governs the red-green-refactor mechanics within a single test cycle. When a task involves multiple collaborating modules or services, also load the `outside-in-double-loop` skill — it governs the order in which you build those modules (outer test first, stub dependencies, then build each stub via its own tdd cycle).

## Red flags — stop and reassess

- About to write an implementation file without a failing test
- Wrote both files without running the test in between
- Showing passing tests without first showing failing ones
- Created new classes/functions in a refactor but wrote zero new tests
- About to mock Prisma instead of using testcontainers
- About to mock `fetch` or stub an HTTP client with `vi.fn()` instead of using MSW
- Wrote a test fixture with a hardcoded calendar date (`2026-08-01`, `` `${CURRENT_YEAR}-06-01` ``) for code that compares a date to "now" — use a relative-date helper or `vi.setSystemTime()` instead

## Rationalizations — and the responses

- **"It's too simple"** → Simple things break. Write it.
- **"I'll add tests after"** → Tests after prove what code does, not what it should do.
- **"We're in a hurry"** → Code without tests creates more delays.
- **"Setting up a container is complex"** → A Prisma mock tests nothing real.
- **"I'll just mock fetch, it's simpler"** → A fetch mock tests your mock, not your HTTP integration. MSW intercepts real requests.
- **"Existing tests cover the extracted code"** → They cover it through the old structure. New units need direct tests.
