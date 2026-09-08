---
name: square
description: Square payments integration guide. Load whenever implementing Square card payments, the Web Payments SDK embedded card form, the Payments API (server-side charge creation), the Refunds API, or phone/MOTO card entry in the portal. Covers the tokenize-then-charge flow, idempotency, refund constraints, environment variables, and sandbox testing. Load when the task involves card payments, phone payments, or refunds of Square charges.
---

# Square Integration

Square is the payment processor used by this application. Unlike Stripe's hosted checkout (which redirects to a Stripe-owned page), Square uses an **embedded card form** powered by the Square Web Payments SDK. The customer never leaves the page.

## How Square payments work — the core flow

1. **Frontend:** Load the Square Web Payments SDK and render a card form inside your UI
2. **Frontend:** When the user submits, call `card.tokenize()` — Square validates the card details inside its PCI-compliant iframe and returns a **payment token** (a short-lived, single-use nonce). No raw card data ever touches your server.
3. **Frontend → Backend:** Send the payment token to your API along with the amount
4. **Backend:** Use the token to create a Square payment via the Payments API
5. **Backend:** Store Square's `payment.id` as `externalChargeId` in `AccountTransaction`; set `refundMethod: 'square_card'` to distinguish these from manual/check payments
6. **Refunds:** Use the stored `externalChargeId` to create refunds later via the Refunds API

This same flow applies to both self-service web checkout (sites app) and staff phone payments (portal app). For phone payments, the staff member types the card number as dictated by the guest — the technical flow is identical.

---

## 1. Environment Variables

```bash
# Required — all four needed for any Square integration
SQUARE_ACCESS_TOKEN=EAAAl...            # Secret — never expose to frontend. Sandbox starts EAAAl, production starts EAAAE
SQUARE_APPLICATION_ID=sandbox-sq0idb-... # Not a secret — needed by Web Payments SDK to init the card form
SQUARE_LOCATION_ID=LID...               # Not a secret — identifies the business location for charges
SQUARE_ENVIRONMENT=sandbox              # 'sandbox' or 'production'
```

Get these from the [Square Developer Dashboard](https://developer.squareup.com/apps):

- Create an application if one does not exist
- `SQUARE_APPLICATION_ID` — Credentials tab, "Sandbox Application ID" for dev / "Production Application ID" for prod
- `SQUARE_LOCATION_ID` — Locations tab; use a sandbox location for dev
- `SQUARE_ACCESS_TOKEN` — Credentials tab, "Sandbox Access Token" for dev

`SQUARE_APPLICATION_ID` and `SQUARE_LOCATION_ID` are safe to expose to the frontend. `SQUARE_ACCESS_TOKEN` must remain server-side.

Company-level Square credentials (`SQUARE_APPLICATION_ID`, `SQUARE_LOCATION_ID`, `SQUARE_ACCESS_TOKEN`) need to be stored per-company in the database so each company can connect their own Square account. The company settings API and schema are the right place for this. The frontend reads its public values (`SQUARE_APPLICATION_ID`, `SQUARE_LOCATION_ID`) from the company settings API, not directly from environment variables — this allows each tenant to have separate Square accounts. The API server reads `SQUARE_ACCESS_TOKEN` from the company record for charge and refund operations.

---

## 2. Idempotency and errors

Always use idempotency keys to prevent duplicate charges on network retries. Generate a fresh unique key per payment or refund attempt; on a network-error retry of the *same* attempt, reuse the same key to avoid double-charging.

Common Square error codes:
| Code | Meaning |
|------|---------|
| `CARD_DECLINED` | Card was declined — show user-facing error |
| `INVALID_CARD` | Card number is invalid |
| `CVV_FAILURE` | CVV did not match |
| `INSUFFICIENT_FUNDS` | Card has insufficient balance |
| `CARD_EXPIRED` | Card is expired |
| `VERIFY_CVV_FAILURE` | CVV verification failed |

Full error code reference: https://developer.squareup.com/reference/square/error-codes

---

## 3. Refunds

Use the `externalChargeId` stored when the original payment was made to issue a refund.

Refund constraints enforced by Square:

- Cumulative refunds cannot exceed the original payment amount — Square will reject the request
- Refunds can only be issued within **1 year** of the original payment date
- Partial refunds are supported — refunds can be issued multiple times against the same payment, up to the cumulative cap

---

## 4. Card form lifecycle — critical rules

The Web Payments SDK renders a PCI-compliant card input form inside a Square-hosted iframe — it appears embedded in your page but Square handles all card data.

- **Always release the card form on cleanup/unmount.** Failing to do so causes multiple form instances to stack up.
- **The container element must exist in the DOM** before the card form is attached to it.
- **The card form is only ready for submission once attaching resolves** — disable the submit control until then.

---

## 5. Storing payment data

When a Square charge succeeds, record it against the transaction with:

- `amount` — positive integer (cents)
- `externalChargeId` — Square's `payment.id` from the charge result
- `description` — e.g. `'Card payment'`
- `refundMethod` — left unset on charges; only set on refund rows

On a Square refund row:

- `amount` — negative integer (cents)
- `externalChargeId` — Square's `refund.id` from the refund result
- `refundReason` — the reason given
- `refundMethod` — `'square_card'`, distinguishing it from `'check'` refunds

Use `refundMethod === 'square_card'` to gate which rows can be refunded via Square vs. the manual check path.

---

## 6. Sandbox Testing

Square provides a full sandbox environment. Always use `SQUARE_ENVIRONMENT=sandbox` with sandbox credentials during development.

Test card numbers (any future expiry date, any CVV):
| Card Number | Result |
|-------------|--------|
| `4111 1111 1111 1111` | Visa — success |
| `5105 1051 0510 5100` | Mastercard — success |
| `4000 0000 0000 0002` | Declined |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0000 0000 0101` | CVV failure |

In sandbox mode, the Web Payments SDK card form also shows a "Test card" button automatically — use it to pre-fill test card details without typing.

For unit/integration tests, **mock the Square client at your dependency-injection or test-double boundary** — never make live Square API calls in automated tests. Follow the same mocking patterns used in existing service tests.

---

## 7. Key Principles

1. **Tokenize on the frontend, charge on the backend.** The payment token from `card.tokenize()` is the only card-related data that flows through your API. Raw card numbers never touch your server.
2. **Always use idempotency keys.** Generate a fresh unique key per payment or refund attempt. On network error retries, reuse the same key to avoid double-charging.
3. **Store the Square payment ID.** Every Square charge must populate `AccountTransaction.externalChargeId` — it is required for future refunds.
4. **Gate refunds on refundMethod.** Only rows with `externalChargeId` set and appropriate `refundMethod` can be refunded via Square. Manual (check) payments use the existing check refund path.
5. **Release card forms on cleanup.** Always destroy/release the card form instance when the component unmounts or is torn down.
6. **Keep `SQUARE_ACCESS_TOKEN` server-side.** Only `SQUARE_APPLICATION_ID` and `SQUARE_LOCATION_ID` are safe to send to the browser.
7. **Per-company credentials.** Each company has its own Square account. Credentials are stored in the company record, not hardcoded in environment variables (those are only used for local dev defaults).

## Stack-specific guidance

Read `references/typescript.md` for TypeScript/Node-specific implementation detail before applying this skill to a TypeScript repo. A Go equivalent (`references/golang.md`) does not exist yet — if this skill applies to a Go repo, flag the gap rather than force-fitting the TypeScript reference.
