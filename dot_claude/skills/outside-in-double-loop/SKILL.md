---
name: outside-in-double-loop
description: Use when implementing any feature that requires multiple collaborating modules, services, or classes. Use when a task involves dependencies that do not yet exist. Use alongside the tdd skill.
---

# Outside-In Double Loop

Start from the user-facing surface. Stub everything behind it. Get the test green. Then build the stubs for real — one at a time, each with its own test-first cycle.

This skill governs **implementation ordering**. The `tdd` skill governs the red-green-refactor mechanics within each cycle. Both apply simultaneously.

## The two loops

**Outer loop** — the user-facing contract (endpoint, CLI command, UI interaction). Write a test for what the user sees. Every dependency behind it is a stub. Get this test green. The codebase is now in a passing state and the contract is locked.

**Inner loop** — one deferred dependency at a time. Pick the next item from the task queue. Write a test for it. Stub _its_ dependencies. Get the test green. Repeat until the queue is empty.

## The sequence

**Step 1 — Write the outer test.**
The test describes user-facing behavior: given this request, expect this response. Every collaborator is a `vi.fn()` / mock. Do not create interface files, type files, or "vocabulary" files yet. Let the test drive what types you need. Define stub shapes inline in the test file.

**Step 2 — Run the test. Watch it fail.**
The failure is typically "module not found" or "function not found." This is correct.

**Step 3 — Write the minimum to make the outer test pass.**
Create the implementation file (e.g., the route handler). Create interfaces or types _only as the implementation file demands them to compile_. Do not pre-define interfaces for dependencies you haven't reached yet.

**Step 4 — Run the test. Watch it pass.**
The outer loop is now green. Every dependency is a stub. The codebase is in a passing state.

**Step 5 — Record deferred tasks.**
For every dependency you stubbed, add an entry to the task queue. Write the queue as a comment block at the top of the file you are currently working in, or in your task tracking tool:

```
// Task queue:
// - [ ] TenantService (stubbed in acceptance test)
// - [ ] CustomerService (stubbed in acceptance test)
// - [ ] TaxService (stubbed in acceptance test)
// - [ ] InvoiceRepository (stubbed in acceptance test)
// - [ ] AuditService (stubbed in acceptance test)
```

**Step 6 — Pop the queue. Start an inner loop.**
Pick the next dependency. Write a test for it. If _it_ has dependencies that don't exist, stub them and add new entries to the queue. Get the test green. Mark the item done. Repeat.

**Step 7 — Stop when the queue is empty.**
Do not add work that was not driven by a stub. If no test stubs a dependency, that dependency does not need to exist.

## Rules

**Do not pre-define interfaces for dependencies you have not yet reached.**
Interfaces emerge from the test that needs them. When the outer test needs a `UserService` stub, define the stub shape inline. When you write the implementation file and need a typed parameter, _then_ extract the interface — not before.

- "I'll define all the interfaces first — it's just design" → It's speculation. You are guessing at contracts before any test has forced them. Let the tests drive the shapes.

**Do not build a dependency before its consumer's test is green.**
When writing `TaxService` and you realize it needs a `TaxRateProvider`, do not go build `TaxRateProvider`. Stub it. Get `TaxService` green. Add `TaxRateProvider` to the queue. Build it later.

- "I'll build the leaf first since the parent depends on it" → The parent's _test_ does not depend on the real leaf. It depends on a stub. Build outside-in, not inside-out.

**Maintain an explicit task queue.**
Do not rely on memory. Write it down. Cross items off as you complete them.

- "I'll just remember what to build next" → You won't, especially not at depth 3 with 10+ dependencies. Write the queue.

**Do not expand scope beyond what stubs require.**
If the outer test passes with stubs and no inner implementation is needed for the task to be complete, stop. Do not write integration tests, real implementations, or "nice-to-haves" unless the task explicitly requires them.

- "I'll add an integration test to prove it all works together" → Only if the acceptance criteria say so. Unrequested work is scope creep.

**One file at a time. Finish before switching.**
Do not open a new file until the current file's test is green. If you discover a new dependency while implementing, stub it, add it to the queue, and keep working on the current file.

## Example — inner loop with nested dependencies

You are building `InvoiceRepository`. Its test stubs `SequenceGenerator`:

```ts
// invoice-repository.test.ts
const sequenceGenerator = { next: vi.fn().mockResolvedValue('INV-00001') };
const repo = new InMemoryInvoiceRepository(sequenceGenerator);
```

`InvoiceRepository` test goes green. Now update the queue:

```
// Task queue:
// - [x] TenantService
// - [x] CustomerService
// - [x] TaxService
// - [x] InvoiceRepository
// - [ ] SequenceGenerator  <-- added when InvoiceRepository stubbed it
// - [ ] AuditService
```

Pop `SequenceGenerator`. Write its test. It has no dependencies — no stubs needed. Get it green. Mark done. Continue.

## Red flags — stop and reassess

- You are about to create a file for a dependency before the consumer's test is green
- You are defining interfaces for modules you have not started testing yet
- You have no written task queue and are relying on memory
- You are writing code that no stub or test demanded
- You are switching files before the current test is green
- You are thinking "I'll just quickly build this dependency first"

## Checklist per task

- [ ] Outer test written with all dependencies stubbed (inline, not pre-defined interfaces)
- [ ] Outer test ran and failed
- [ ] Implementation written; interfaces extracted only as needed to compile
- [ ] Outer test ran and passed
- [ ] Task queue written with all stubbed dependencies
- [ ] Each inner loop: test written, stubs for its dependencies, test green, queue updated
- [ ] Queue empty — done
