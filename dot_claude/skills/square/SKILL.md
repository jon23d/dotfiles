---
name: square
description: Square payments integration guide for TypeScript/Node.js. Load whenever implementing Square card payments, the Web Payments SDK embedded card form, the Payments API (server-side charge creation), the Refunds API, or phone/MOTO card entry in the portal. Covers SDK setup, card tokenization flow, idempotency, environment variables, and sandbox testing. Load when you see Square imports or the task involves card payments, phone payments, or refunds of Square charges.
---

# Square Integration for TypeScript/Node.js

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

For React/Vite apps (sites, portal), expose the public values as Vite env vars:

```bash
VITE_SQUARE_APPLICATION_ID=sandbox-sq0idb-...
VITE_SQUARE_LOCATION_ID=LID...
```

The `SQUARE_ACCESS_TOKEN` stays in the API `.env` only.

Company-level Square credentials (`SQUARE_APPLICATION_ID`, `SQUARE_LOCATION_ID`, `SQUARE_ACCESS_TOKEN`) need to be stored per-company in the database so each company can connect their own Square account. The company settings API and schema are the right place for this. The frontend reads its public values (`SQUARE_APPLICATION_ID`, `SQUARE_LOCATION_ID`) from the company settings API, not directly from environment variables — this allows each tenant to have separate Square accounts. The API server reads `SQUARE_ACCESS_TOKEN` from the company record for charge and refund operations.

---

## 2. Backend: Square API Client Setup

Install the Square Node.js SDK:

```bash
npm install squareup
```

Create a client factory (not a singleton — each company may have different credentials):

```typescript
// services/square.ts
import { SquareClient, SquareEnvironment } from 'squareup';

export function createSquareClient(accessToken: string): SquareClient {
  return new SquareClient({
    token: accessToken,
    environment:
      process.env.SQUARE_ENVIRONMENT === 'production'
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
  });
}
```

Register via Awilix following the project's DI container patterns (`container.types.ts`). Resolve the company's access token from the company record when constructing the client per-request or per-service call.

---

## 3. Backend: Creating a Payment

Always use idempotency keys to prevent duplicate charges on network retries:

```typescript
import { randomUUID } from 'crypto';
import { SquareApiError } from 'squareup';
import { createSquareClient } from '#api/services/square.js';

export async function chargeCard(params: {
  sourceId: string; // Payment token from the frontend (card.tokenize() result)
  amountCents: number;
  accessToken: string; // Company's Square access token
  locationId: string; // Company's Square location ID
}): Promise<string> {
  const client = createSquareClient(params.accessToken);
  const idempotencyKey = randomUUID();

  try {
    const { result } = await client.paymentsApi.createPayment({
      sourceId: params.sourceId,
      idempotencyKey,
      amountMoney: {
        amount: BigInt(params.amountCents),
        currency: 'USD',
      },
      locationId: params.locationId,
    });

    return result.payment!.id!; // Store as AccountTransaction.externalChargeId
  } catch (error) {
    if (error instanceof SquareApiError) {
      const code = error.errors?.[0]?.code;
      const detail = error.errors?.[0]?.detail ?? 'Payment failed';
      throw new PaymentDeclinedError(detail, code);
    }
    throw error;
  }
}
```

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

## 4. Backend: Creating a Refund

Use the `externalChargeId` stored when the original payment was made:

```typescript
import { randomUUID } from 'crypto';
import { SquareApiError } from 'squareup';

export async function refundSquarePayment(params: {
  paymentId: string; // AccountTransaction.externalChargeId from the original charge
  amountCents: number;
  accessToken: string;
}): Promise<string> {
  const client = createSquareClient(params.accessToken);
  const idempotencyKey = randomUUID();

  try {
    const { result } = await client.refundsApi.refundPayment({
      idempotencyKey,
      paymentId: params.paymentId,
      amountMoney: {
        amount: BigInt(params.amountCents),
        currency: 'USD',
      },
    });

    return result.refund!.id!;
  } catch (error) {
    if (error instanceof SquareApiError) {
      const code = error.errors?.[0]?.code;
      if (code === 'REFUND_AMOUNT_INVALID') throw new RefundAmountExceedsPaymentError();
      throw new PaymentRefundError(error.errors?.[0]?.detail ?? 'Refund failed');
    }
    throw error;
  }
}
```

Refund constraints enforced by Square:

- Cumulative refunds cannot exceed the original payment amount — Square will reject the request
- Refunds can only be issued within **1 year** of the original payment date
- Partial refunds are supported — call `refundPayment` multiple times against the same `paymentId`

---

## 5. Frontend: Web Payments SDK

The Web Payments SDK renders a PCI-compliant card input form. The actual card fields are inside a Square-hosted iframe — they appear embedded in your page but Square handles all card data.

Install:

```bash
npm install @square/web-payments-sdk
```

Add TypeScript types for the global:

```typescript
// src/global.d.ts
declare global {
  interface Window {
    Square: import('@square/web-payments-sdk').Square;
  }
}
export {};
```

React component integrating the card form:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { Card, Payments } from '@square/web-payments-sdk';

interface SquareCardFormProps {
  applicationId: string;
  locationId: string;
  onToken: (token: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

export function SquareCardForm({
  applicationId,
  locationId,
  onToken,
  onError,
  disabled,
}: SquareCardFormProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<Card | null>(null);
  const paymentsRef = useRef<Payments | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !window.Square) return;

    let cancelled = false;

    (async () => {
      const payments = window.Square.payments(applicationId, locationId);
      paymentsRef.current = payments;
      const card = await payments.card();
      if (cancelled) {
        await card.destroy();
        return;
      }
      await card.attach(containerRef.current!);
      cardRef.current = card;
      setReady(true);
    })().catch((err: unknown) => {
      if (!cancelled) onError(String(err));
    });

    return () => {
      cancelled = true;
      cardRef.current?.destroy().catch(() => {});
      cardRef.current = null;
    };
  }, [applicationId, locationId, onError]);

  const handleTokenize = async () => {
    if (!cardRef.current) return;
    const result = await cardRef.current.tokenize();
    if (result.status === 'OK' && result.token) {
      onToken(result.token);
    } else {
      const msg = result.errors?.map((e) => e.message).join(', ') ?? 'Card entry failed';
      onError(msg);
    }
  };

  return (
    <div>
      <div ref={containerRef} id="square-card-container" />
      <button type="button" onClick={handleTokenize} disabled={!ready || disabled}>
        Pay
      </button>
    </div>
  );
}
```

Critical rules:

- **Always destroy on cleanup.** `card.destroy()` must be called in the `useEffect` cleanup function. Failing to do so causes multiple form instances to stack up.
- **The container div must be in the DOM** when `card.attach()` is called.
- **The card form is ready** only after `card.attach()` resolves — disable the submit button until then.

---

## 6. Storing Payment Data in AccountTransaction

When a Square charge succeeds, record it in `AccountTransaction` with:

```typescript
// On a successful Square charge:
{
  amount: amountCents,           // Positive integer (cents)
  externalChargeId: squarePaymentId, // result.payment!.id! from Square
  description: 'Card payment',
  // refundMethod is null on charges — only set on refund rows
}
```

On a Square refund row:

```typescript
{
  amount: -refundCents,          // Negative integer
  externalChargeId: squareRefundId, // result.refund!.id! from Square
  refundReason: reason,
  refundMethod: 'square_card',   // Distinguishes from 'check' refunds
}
```

Use `refundMethod === 'square_card'` to gate which rows can be refunded via Square vs. the manual check path.

---

## 7. Sandbox Testing

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

For unit/integration tests, **mock the Square client via the DI container** — never make live Square API calls in automated tests. Follow the same mocking patterns used in existing service tests.

---

## 8. Key Principles

1. **Tokenize on the frontend, charge on the backend.** The payment token from `card.tokenize()` is the only card-related data that flows through your API. Raw card numbers never touch your server.
2. **Always use idempotency keys.** Generate a new `randomUUID()` per payment or refund attempt. On network error retries, reuse the same key to avoid double-charging.
3. **Store the Square payment ID.** Every Square charge must populate `AccountTransaction.externalChargeId` — it is required for future refunds.
4. **Gate refunds on refundMethod.** Only rows with `externalChargeId` set and appropriate `refundMethod` can be refunded via Square. Manual (check) payments use the existing check refund path.
5. **Destroy card forms on cleanup.** Always call `card.destroy()` in React `useEffect` cleanup.
6. **Keep `SQUARE_ACCESS_TOKEN` server-side.** Only `SQUARE_APPLICATION_ID` and `SQUARE_LOCATION_ID` are safe to send to the browser.
7. **Per-company credentials.** Each company has its own Square account. Credentials are stored in the company record, not hardcoded in environment variables (those are only used for local dev defaults).
