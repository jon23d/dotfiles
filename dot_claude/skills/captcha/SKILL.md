---
name: captcha
description: Use when implementing, reviewing, or debugging a CAPTCHA / bot-protection integration — adding proof-of-work or challenge-verify flows to a form, wiring a widget's challenge/redeem endpoints into a backend, choosing between embedded and standalone CAPTCHA deployment modes, or troubleshooting a CAPTCHA widget's CDN/WASM fetch hanging in tests.
---

# Captcha integration

## Scope

Covers **Node.js stacks only**, using **Cap** (github.com/tiagozip/cap) in
**embedded mode**: `capjs-core` (server) + `cap-widget` (client). This is the
exact pattern implemented in `abcinnkeeper` (ABC-603) for a public contact
form.

Not yet covered: PHP or other non-Node stacks. Capito (a community PHP port
of Cap) was evaluated during ABC-603 research but not implemented or
verified — treat it as an unconfirmed lead, not a recommendation, until this
skill is extended.

## Why embedded mode, briefly

Cap has two deployment modes: **Standalone** (separate Docker service,
requires Redis/Valkey) and **Embedded** (a stateless library you call from
your own server, Redis/Valkey not required — replay-prevention just needs a
`consumeNonce` callback, which a single Postgres table satisfies fine).
For a single Node app that already has a database, Embedded avoids running
an extra service and an extra dependency (Redis/Valkey) for no benefit. Cap
also has no per-sitekey domain-count limit (unlike Cloudflare Turnstile's
10-domain cap), so it doesn't have to be re-evaluated per custom domain.
Don't re-derive this further — it was settled in ABC-603 research.

## Backend

### Wire format (dictated by `cap-widget`, not chosen by your server)

- `POST {apiEndpoint}challenge` — no body. Returns
  `{ challenge: { c, s, d }, token, expires }`.
- `POST {apiEndpoint}redeem` — body
  `{ token, solutions, instr?, instr_blocked?, instr_timeout? }`.
  Returns `{ success: true, token, expires }` or
  `{ success: false, error }`.
- **Both redeem outcomes must return HTTP 200.** The widget's fetch-then-
  `.json()` flow doesn't branch on status code, and it reads `resp.error` on
  failure — `capjs-core`'s own failure shape is `{ success: false, reason,
  instr_error? }`, no `error` field. Map `reason` → a user-facing `error`
  string before returning (a `mapReasonToMessage()`-style switch); otherwise
  the widget shows a generic fallback message for every failure.
- `apiEndpoint` gets a trailing `/` auto-appended by the widget if you omit
  one, so routes are typically mounted at `.../challenge` and `.../redeem`
  under a path ending in `/`.

Routes should be thin pass-throughs to `capjs-core`'s
`generateChallenge(secret, { scope })` / `validateChallenge(secret, body,
{ scope, consumeNonce })` — do not reimplement PoW validation.

### Service responsibilities

Wrap the two `capjs-core` calls in a service (not called directly from
route handlers) that owns three things:

1. **`createChallenge()`** — thin call to `generateChallenge`.
2. **`redeemChallenge(body)`** — calls `validateChallenge` with a
   `consumeNonce(sigHex, ttlMs)` callback backed by the DB table below
   (`purpose: 'nonce'`). On success, also persists the result's `tokenKey`
   (`purpose: 'redeem'`) so a later, independent verification can look it
   up. Never throws — both outcomes go through the return value, matching
   what the widget expects to parse.
3. **`verifyAndConsumeToken(token)`** — the *second*, independent
   verification, called from the actual form-submit handler (not from
   inside the redeem route). `capjs-core` does not validate redeem tokens
   for you — a caller that wants single-use enforcement at the point where
   the token is actually spent must do it itself. `capjs-core`'s success
   shape is `token = "${id}:${verToken}"` and `tokenKey =
   "${id}:${sha256Hex(verToken)}"` — there is no exported helper to
   re-derive `tokenKey` from `token` alone, so re-derive it yourself with
   plain `crypto.createHash('sha256')` (confirmed by reading
   `core/src/index.js`/`core/src/crypto.js` in tiagozip/cap — no exported
   helper exists as of this writing). Throw on any failure (malformed
   token, unknown/expired/already-consumed key) and treat every failure
   mode identically (fail closed).

### DB-backed replay prevention: one table, two purposes

A single table serves both jobs — don't split it in two. Shape (Postgres/
Prisma, from `abcinnkeeper`'s `CapCaptchaToken` / `cap_captcha_tokens`):

- `key` (unique) — either the nonce's signature hex (`purpose: 'nonce'`) or
  the derived `tokenKey` string (`purpose: 'redeem'`). The two value
  domains don't collide, so one column is safe.
- `purpose` — scopes lookups/claims to one of the two uses.
- `expiresAt` — TTL for both purposes.
- `consumedAt` (nullable) — only meaningful for `purpose: 'redeem'`; used
  for single-use enforcement.
- No FK/tenant column needed — Cap embedded mode carries no per-tenant
  concept on its own.

Repository needs exactly two operations:

- `claim(key, purpose, expiresAt)` — `INSERT`; catch the unique-constraint
  violation and return `false` (already claimed = replay) instead of
  throwing. This single method backs both `consumeNonce` (called from
  inside `redeemChallenge`) and the post-redeem `tokenKey` claim.
- `consumeIfValid(key, purpose)` — atomic `UPDATE ... WHERE key = $1 AND
  purpose = $2 AND consumedAt IS NULL AND expiresAt > now() SET consumedAt
  = now()`; return whether it affected a row. Backs
  `verifyAndConsumeToken`.

### Where verification goes relative to other checks (e.g. a honeypot)

Call `verifyAndConsumeToken` from the form-submit route handler, **after**
any honeypot/spam-field check, and **skip it entirely** when the honeypot
has tripped. Rationale: PoW verification is a real network + DB round-trip
you're paying to run — don't pay for it on a request you're going to
silently drop anyway, and a honeypot-tripped request may legitimately carry
a missing or garbage captcha token, which would otherwise fail verification
for the wrong reason. This is also why this is a *second* verification —
the first happened inside `capjs-core`'s own PoW check at redeem time; the
submit-time check is what actually enforces single-use, since a bug in
either check alone would allow token reuse.

## Frontend

- One widget instance per component lifetime:
  `const cap = new Cap({ apiEndpoint })`, created once (e.g. in an effect
  on mount) and reused across `solve()` calls, including retries — not
  recreated per attempt.
- **Detached-DOM-node leak gotcha**: `new Cap()` called without an `el`
  argument creates a hidden custom element and appends it directly to
  `document.documentElement`, outside the framework's tree. Unmounting
  your component does *not* remove it — you must explicitly call
  `cap.widget.remove()` yourself (e.g. in the same effect's cleanup),
  or every mount/remount leaks a detached DOM node permanently.
- Only pass `apiEndpoint` in the config unless you've confirmed another key
  is a real recognized attribute — unrecognized config keys are silently
  no-ops (e.g. a `workers` key is not read; the element already defaults
  worker count sensibly on its own).
- Trigger `solve()` as part of the actual submit action, not pre-solved on
  page load — and run your own field validation first, before calling
  `solve()`, so an obviously-invalid submission never pays for a real PoW
  round-trip.
- Wrap `await cap.solve()` in a plain `try/catch` — the widget both
  dispatches an error event *and* re-throws the underlying `Error` on
  failure, so a single try/catch is sufficient; no separate event listener
  is needed. Fall back to a generic user-facing message if the caught
  error has none.
- Redeem tokens are single-use. After a failed *final* submission (not a
  failed `solve()` — a failure at your own form-submit endpoint after a
  successful solve), call the widget's `reset()` so the next `solve()`
  fetches a fresh challenge instead of resubmitting a spent token.

## Testing

The real widget package makes a live outbound fetch for a WASM binary from
a CDN on connect/mount. This is slow (20+ seconds) and can hang or fail
unpredictably in a test sandbox — don't assume a jsdom/happy-dom-style
environment blocks external network calls; it often doesn't.

- Every test file that renders a component tree touching the captcha hook
  or widget (directly or transitively) needs its own module mock — mocks
  are per-file, not global, so mocking it in the hook's own test file does
  not protect a page-level test that renders the same hook through a
  parent component.
- Mock the widget's default export as a class, including a `widget: {
  remove: vi.fn() }` stub — omitting it makes cleanup between tests throw,
  since your effect cleanup calls `cap.widget.remove()`.
- If you need to reference mock functions from inside the mock factory
  (Vitest/Jest-style hoisting), declare them via the hoisting helper your
  test framework provides (e.g. `vi.hoisted()`) rather than a plain
  top-level `const` — mock factories are hoisted above normal
  declarations, so a plain `const` reference throws a
  "used before initialization" error. The same hoisting requirement
  applies to mocking the server-side library's functions (e.g.
  `generateChallenge`/`validateChallenge`) in service-layer tests.
- Add a route-level test asserting the verification call is *not* made
  when the honeypot/spam check trips — this is the concrete assertion
  that the ordering rule above is actually wired up, not just documented.

## Required env vars

- A server-side secret (e.g. `CAP_SECRET`) used to sign challenge/redeem
  JWTs. Required at startup — fail fast rather than generating one
  per-process, since it must stay consistent across all server processes
  serving the same widget. `capjs-core` requires at least 16 bytes; there
  is no published shared test secret, so generate a local dev value (e.g.
  `openssl rand -hex 32`) and document it in an example env file.
