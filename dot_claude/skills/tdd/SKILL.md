---
name: tdd
description: Use when writing any code — functions, modules, APIs, UI components, scripts, or any other implementation. Use when asked to "implement", "build", "write", "add", "create", or "refactor" anything that involves code. Also covers testing patterns, factories, mocking, and integration tests against real dependencies.
---

# TDD — Test-Driven Development

Write the test first. Run it. Watch it fail. Then write the code.

## The sequence — no skipping, no combining steps

**Step 1 — Write the test file only.** The implementation file must not exist. Write tests that describe the required behavior from the outside.

**Step 2 — Run the tests you wrote and show the failure output.** Do not proceed until you have run the test command and shown the failure.

**Step 3 — Write the minimum implementation to make the tests pass.**

**Step 4 — Run the tests again and show them passing.**

**Step 5 — Refactor if needed, keeping tests green.**

Writing tests and implementation in the same step is not tdd.

## The cycle unit is one behaviour

Complete Steps 1–4 for one behaviour before writing the test for the next. Never accumulate tests for several behaviours and satisfy them in one pass.

Batching breaks two of the steps: with many tests failing at once, Step 3's "minimum implementation" becomes the whole feature, and Step 2's failure output no longer identifies which behaviour is missing.

When a task arrives as a list — a multi-part feature, several review findings, a set of acceptance criteria — work the items one at a time.

When reporting back, state how many red→green cycles you ran and which behaviour each covered.

## Running tests

**During cycles:** run the single test file or a filtered subset for the behaviour you're working on — most test runners support running one file or filtering by test name.

**Before reporting back:** run the tests and checks covering what you changed — the affected package only: tests, typecheck, lint, plus the project's formatter on the files you touched. Zero errors required.

**Never run the full test suite.** The full gate is the orchestrator's job.

This skill's scope ends at everything you changed running clean.

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

## When to use integration tests vs unit tests with factories

- **Code that directly calls the database** (repositories, query functions) → **integration tests against a real database**, typically via a disposable container. Mock nothing at this layer.
- **Code that directly calls HTTP APIs** (API clients, services that make outbound requests) → **integration tests with real network interception.** Mock nothing at the code level — intercept the request at the network boundary.
- **Everything else** (domain logic, handlers, utilities) → **unit tests with factories.**

Do not mock the database client in unit tests — if the code queries the database, it belongs in a repository with an integration test.
Do not mock the HTTP client or stub HTTP calls with a bare fake function — if the code makes HTTP requests, intercept them at the network level.

---

## Factories

Every domain type has a factory (typically under a `test_utils/factories/`-style location). **Never define factory functions inside a test file.** Always generate unique values (e.g. a random ID) rather than hardcoding them.

**Use factories for test data setup — never call repository methods directly.** Exception: a repository's own test of a method may call that method directly, since the method itself is what's under test. All other test data, including setup for the entity being tested, goes through the factory.

A factory typically exposes a `build(overrides)` for a single instance and a `buildList(count, overrides)` for many, so tests can override only the fields relevant to the scenario. For integration tests, pair the factory with a thin `create` helper that inserts the built object through the transaction/connection the test is using.

---

## Universal test rules

- **Test behaviour, not implementation.** A test must survive an internal refactor.
- **One concept per test.** Multiple assertions OK if same logical outcome.
- **Tests must be hermetic.** No shared mutable state, no run-order dependency.
- **No logic in tests.** No conditionals, loops, or try/catch.
- **Name the scenario and outcome:** `returns false when order is shipped`.

## Mocking

Mock at module boundaries only: external services, database clients, filesystem. Prefer dependency injection over a mocking framework. Create mocks fresh inside each test case rather than sharing them across tests. For HTTP APIs, intercept at the network level instead of mocking the HTTP client — see the stack-specific guidance for the concrete mechanism.

## Async tests

Always await async calls before asserting on their result. Avoid callback-based async test patterns.

## Table-driven tests

When the same assertion logic applies across several input/output pairs, express it as one parameterized test with a table of cases rather than copy-pasting near-identical test bodies. Each row names the scenario (e.g. the tier) alongside its input and expected output, and the test body stays generic across all rows. Most test frameworks have a built-in construct for this (e.g. a "for each" or "each" form) — see the stack-specific guidance for the concrete syntax.

## Date-dependent test data

Never hardcode a calendar date tied to "the current year" (`` `${CURRENT_YEAR}-08-01` ``) or any other absolute date, when the code under test compares a date to "now" (past-date rejection, expiry checks, booking-window/cutoff logic). A hardcoded date silently goes stale the moment the calendar catches up to it — the test passes for months, then fails in CI with no code change, because the fixture is now wrong, not because of a regression. This has repeatedly bitten this codebase specifically in `checkIn`/`checkOut` reservation fixtures.

- **Compute dates relative to now.** Use or add a `daysFromNow(offsetDays)`-style helper instead of a literal string. Check the test file and sibling test files hitting the same endpoint for an existing helper before writing a new one.
- **Or freeze time** using your test framework's clock-control utility (e.g. `vi.setSystemTime()` / `vi.useFakeTimers()` in Vitest) when the test needs a fixed "today" to assert against — restore it afterward.
- When fixing one instance of this bug, grep the rest of the file for the same pattern (e.g. `grep -n '${CURRENT_YEAR}'` or a literal year). It tends to occur in clusters — one file with a good relative-date helper still has hardcoded dates scattered through other tests that were written without reusing it.

## Coverage

Do not chase numbers. Aim for tests that would catch real regressions.

---

## Implementation ordering

This skill governs the red-green-refactor mechanics within a single test cycle. When a task involves multiple collaborating modules or services, also load the `outside-in-double-loop` skill — it governs the order in which you build those modules (outer test first, stub dependencies, then build each stub via its own tdd cycle).

## Red flags — stop and reassess

- About to write an implementation file without a failing test
- Wrote both files without running the test in between
- Wrote tests for several behaviours before running any of them red
- Showing passing tests without first showing failing ones
- Created new classes/functions in a refactor but wrote zero new tests
- About to mock the database client instead of using a real database via an integration test
- About to mock `fetch` or stub an HTTP client instead of intercepting at the network level
- Wrote a test fixture with a hardcoded calendar date (`2026-08-01`, `` `${CURRENT_YEAR}-06-01` ``) for code that compares a date to "now" — use a relative-date helper or a clock-freezing utility instead

## Rationalizations — and the responses

- **"It's too simple"** → Simple things break. Write it.
- **"I'll add tests after"** → Tests after prove what code does, not what it should do.
- **"I'll write all the tests up front, then make them pass"** → Then "minimum implementation" is the whole feature, and the red run identifies nothing.
- **"We're in a hurry"** → Code without tests creates more delays.
- **"Setting up a container is complex"** → A mocked database client tests nothing real.
- **"I'll just mock fetch, it's simpler"** → A fetch mock tests your mock, not your HTTP integration. Network-level interception exercises the real request.
- **"Existing tests cover the extracted code"** → They cover it through the old structure. New units need direct tests.

## Stack-specific guidance

Read `references/typescript.md` for TypeScript/Node-specific implementation detail, or `references/golang.md` for Go-specific implementation detail (testify conventions, testcontainers-go, and several empirically-confirmed gotchas), before applying this skill.
