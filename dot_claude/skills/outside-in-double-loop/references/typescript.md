# Outside-In Double Loop — TypeScript

## Mocking collaborators

Every collaborator stubbed in the outer test is a `vi.fn()` / mock.

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
