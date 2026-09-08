# Square — TypeScript

Node.js SDK, React Web Payments SDK integration, and Vite env var wiring.

## Environment Variables — frontend wiring

For React/Vite apps (sites, portal), expose the public values as Vite env vars:

```bash
VITE_SQUARE_APPLICATION_ID=sandbox-sq0idb-...
VITE_SQUARE_LOCATION_ID=LID...
```

The `SQUARE_ACCESS_TOKEN` stays in the API `.env` only.

---

## Backend: Square API Client Setup

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

## Backend: Creating a Payment

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

---

## Backend: Creating a Refund

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

---

## Frontend: Web Payments SDK

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

## Storing Payment Data in AccountTransaction

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

## Sandbox Testing

For unit/integration tests, **mock the Square client via the DI container** — never make live Square API calls in automated tests. Follow the same mocking patterns used in existing service tests.

## Key Principles

5. **Destroy card forms on cleanup.** Always call `card.destroy()` in React `useEffect` cleanup.
