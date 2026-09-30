---
name: golang-errors
description: Use when writing or reviewing Go code that creates errors, wraps them with fmt.Errorf, inspects error trees with errors.Is/As/Join, defines a sentinel or custom error type, or uses panic/recover.
---

# Golang Errors

## Overview

An error is just a value implementing `error`. The design questions are: does
this error need to be checked for a specific cause later (sentinel or typed),
does the caller need the original error preserved (wrap) or just the fact
that something failed (don't wrap), and is this actually exceptional enough
for `panic` (almost never).

## Creating errors

- Plain failures: `errors.New("message")` or `fmt.Errorf("message: %v", x)`.
- Sentinel errors (caller checks "was it *this*"): a package-level
  `var ErrNotFound = errors.New("not found")`. Do not build sentinels from a
  string-cast type (`type Sentinel string; func (s Sentinel) Error() string`).
  That pattern makes two unrelated sentinels in different packages compare
  equal whenever their strings match, because `errors.Is`'s default
  comparison is `==`. `errors.New` values are only ever equal to themselves.
- Typed errors (caller needs *data*, e.g. a status code or field name): a
  struct implementing `Error() string`. Use this when the caller needs more
  than a yes/no.
- Function/method signatures always return the `error` interface, never the
  concrete sentinel or struct type — callers should be free to ignore the
  concrete type entirely.
- Error message text: lowercase, no trailing punctuation, no capitalized
  first word. Messages get concatenated into other messages via wrapping, and
  `in FooBar: could not open file` reads worse than `in fooBar: could not
  open file`.

**The typed-nil trap:** this is the general nil-interface trap (see
`golang-interfaces-and-generics` for the mechanism: an interface is nil only
when *both* its type and value are nil) applied to `error` specifically — a
custom error type's zero value, stored in an `error`-typed variable, is a
non-nil interface even when unset.

```go
// Don't: returns non-nil error even when flag is false.
func check(flag bool) error {
	var e StatusErr
	if flag {
		e = StatusErr{Status: NotFound}
	}
	return e // interface has a concrete type even when e is the zero value
}

// Do: explicit nil, or keep the local variable typed as error.
func check(flag bool) error {
	if flag {
		return StatusErr{Status: NotFound}
	}
	return nil
}
```

Never declare a local variable as your concrete error type and return it
bare. Either return `nil` explicitly on the success path, or declare the
local as `var err error` from the start.

## Wrapping vs. not wrapping

Wrap when the caller (or a log line) benefits from the original error plus
context about where it happened. Don't wrap when the underlying error is an
implementation detail the caller shouldn't depend on — return a fresh error
instead, or use `%v` to fold in the message without exposing it to
`errors.Is`/`As`.

```go
// Wrap: preserves the original for errors.Is/As, adds context.
return fmt.Errorf("fetching widget %d: %w", id, err)

// Don't wrap: caller shouldn't be able to match on a driver-internal error.
if err != nil {
	return fmt.Errorf("widget store unavailable: %v", err)
}
```

Rules of thumb:

- Put `%w` last in the format string, after a `": "` separator — this is the
  convention every `errors.Is`-aware caller expects.
- Wrap at a boundary where you're adding real information (which operation,
  which ID). Wrapping the same error at every stack frame with no new detail
  is noise.
- A custom error type that wraps something implements `Unwrap() error`
  (returning the inner error, or nil). Without `Unwrap`, `errors.Is`/`As`
  can't see past it.
- If several calls in one function would wrap with the identical message, use
  a `defer` that rewraps `err` once instead of repeating `fmt.Errorf` at each
  `if err != nil`:

```go
func doThings() (err error) {
	defer func() {
		if err != nil {
			err = fmt.Errorf("doThings: %w", err)
		}
	}()
	if err = step1(); err != nil {
		return err
	}
	return step2()
}
```

## Combining multiple errors

- `errors.Join(errs...)` merges a `[]error` (e.g. from field validation) into
  one `error`; skip entirely when `errs` is empty — `errors.Join` of a nil
  slice returns nil, but building the slice conditionally is still clearer.
- `fmt.Errorf` also accepts more than one `%w` verb: `fmt.Errorf("a: %w, b:
  %w", err1, err2)`.
- A custom multi-wrap type implements `Unwrap() []error` instead of
  `Unwrap() error` — Go has no method overloading, so pick one shape, not
  both. `errors.Is`/`As` walk into both `Unwrap() error` and `Unwrap()
  []error` correctly; plain `errors.Unwrap` does not (it always returns nil
  for the `[]error` shape) — that's a reason to prefer `Is`/`As` over calling
  `Unwrap` directly in your own code, not just a note about internals.

## errors.Is vs errors.As

- `errors.Is(err, target)` — "does this error tree contain *this specific
  instance*?" Use for sentinels. Walks `Unwrap()` recursively, comparing with
  `==` by default.
- `errors.As(err, &target)` — "does this error tree contain a value of *this
  type*?" `target` must be a pointer to a type implementing `error`, or a
  pointer to an interface; anything else panics. On a match, the found error
  is assigned into `*target`.
- Never use a type assertion/switch (`err.(MyErr)`) to pull fields out of a
  possibly-wrapped error — a wrapping layer defeats it silently. Use
  `errors.As`.
- Override comparison only when needed: implement `Is(target error) bool` on
  a noncomparable error type (e.g. one holding a slice), or to pattern-match
  on a subset of fields (treat a zero field on `target` as "don't care").
  Implementing `As` yourself needs reflection and is rarely worth it — reach
  for it only when one error type should also match as a different type.

```go
if errors.Is(err, sql.ErrNoRows) { /* sentinel */ }

var statusErr StatusErr
if errors.As(err, &statusErr) { /* typed, need statusErr.Status */ }
```

## panic and recover

- `panic` is for programming bugs and unrecoverable states (out-of-bounds
  access, out of memory) — not a control-flow or "expected failure"
  mechanism. If a condition is expected and reportable, return an `error`.
- `recover` only works called directly inside a deferred function; check its
  return for non-nil inside an `if`.
- A goroutine's panic is not caught by a `recover` in a different goroutine —
  each goroutine needs its own recover, or an unrecovered panic in any
  goroutine kills the whole program.
- Library/public-API boundary rule: a public function should `recover` any
  panic that could otherwise escape and convert it into a returned `error` —
  callers of a library should never see a panic they didn't cause themselves.
  Do not blanket-recover inside application/handler code just to "keep
  serving" after an unexpected panic; log and let the process restart unless
  you've identified the specific, safe-to-continue case.
- `panic(nil)` (Go 1.21+) is normalized to a real `*runtime.PanicNilError`
  instead of leaving `recover()` with an empty/nil value — don't rely on
  older `panic(nil)` behavior.

```go
func Do() (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("recovered: %v", r)
		}
	}()
	return risky()
}
```

## Common mistakes

- Comparing a wrapped error with `==` or a bare type assertion instead of
  `errors.Is`/`As` — silently fails to match once anything wraps the error.
- Forgetting `Unwrap()` on a custom wrapping type — `errors.Is`/`As` stop
  dead at that layer.
- Returning a bare, possibly-zero-value custom error type instead of `nil` or
  `error` (see the typed-nil trap above).
- Reaching for `panic`/`recover` to get a stack trace. Go doesn't attach
  stack traces to errors by default; if you need one, use a third-party
  wrapping library (e.g. cockroachdb's `errors` package) rather than abusing
  panic for control flow.
- Wrapping the same error with the same message at every call site up the
  stack — adds noise, not information. Wrap where you add a fact the caller
  doesn't already have.
