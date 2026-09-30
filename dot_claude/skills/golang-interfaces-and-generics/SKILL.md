---
name: golang-interfaces-and-generics
description: Use when writing or reviewing Go code that defines or consumes interfaces, chooses a method receiver type, embeds a struct or interface, writes a type switch, defines enum-like constants, or decides whether a function or type should use generics.
---

# Golang Interfaces and Generics

## Overview

Go interfaces are implicit and satisfied structurally — a type never
declares which interfaces it implements. This flips where interfaces
belong: the *consumer* defines the interface it needs, not the provider.
Generics (1.18+) add compile-time type parameters, but replace fewer
interfaces than newcomers expect, and the standard library (1.21+) now
covers most of what people used to hand-roll.

## Interfaces belong to the consumer, and should be small

Define an interface where it's used, not where the concrete type lives.
The provider package exports only concrete types and never references the
consumer's interface — that's what lets you swap an implementation without
touching the interface declaration.

```go
// in package billing — NOT in package customer
type CustomerLookup interface {
    CustomerByID(id string) (Customer, error)
}
```

Keep the interface to exactly the methods the consumer calls, even if the
concrete type has more. A one-method interface named for what it does
(`Closer`, `Validator`) is the Go norm, not a sign the design is
incomplete. Do reuse a standard-library interface when one already fits
(`io.Reader`, `fmt.Stringer`) — it plugs your code into everything that
already knows how to use it. Don't invent a project-specific duplicate.

## Accept interfaces, return structs

Function parameters should be narrow, consumer-defined interfaces; return
values should be concrete structs.

```go
// good — new fields/methods on *OrderService are backward compatible
func NewOrderService(db OrderStore) *OrderService { ... }

// avoid — adding a method to the returned interface breaks every caller
func NewOrderService(db OrderStore) OrderService { ... }
```

Reserve returning an interface for when the caller must swap in genuinely
different concrete types it doesn't control (e.g. a driver registry), and
even then prefer one constructor per concrete type over a factory branching
on input. `error` is the standard exception to this rule.

## Receiver choice and the method-set trap

- Pointer receiver: the method mutates the receiver, the struct is large,
  or it holds something that must not be copied (`sync.Mutex`).
- Value receiver: small, effectively-immutable types.
- Don't mix receiver kinds on one type without a specific reason — it
  produces an inconsistent method set (see below).
- A nil receiver isn't automatically a bug: a pointer-receiver method can
  check `if r == nil` and handle it (useful for recursive structures). A
  value-receiver method can never do this — it panics before the check is
  possible.

The method set of a pointer instance includes both pointer- and
value-receiver methods; a *value* instance's method set has only
value-receiver methods. So if any interface method has a pointer receiver,
only `*T` satisfies the interface — `T` does not, even though `T` has the
method:

```go
type Incrementer interface{ Increment() }
type Counter struct{ n int }
func (c *Counter) Increment() { c.n++ }

var i Incrementer = Counter{}   // compile error
var i Incrementer = &Counter{}  // ok
```

This is the usual cause of "why doesn't my struct satisfy this interface" —
check receiver types on both sides first. Also: don't write getters/setters
for plain field access — direct field access is the Go idiom; reserve
methods for real logic or multi-field updates.

## The nil-interface trap

An interface value is nil only when *both* its type and value pointers are
nil. Assigning a nil concrete pointer to an interface produces a *non-nil*
interface, because the type pointer is now set:

```go
var p *MyError          // p == nil: true
var err error = p       // err == nil: false!
```

Do return the interface's zero value directly on the success path (`var
err error`, or `return nil`), never a typed nil pointer through an
interface-typed return. Compare only against literal `nil`. Detecting
whether the *value inside* a non-nil interface is nil requires reflection
(`reflect.Value.IsNil`) — plain `== nil` can't see it. This trap is most
commonly hit with `error` specifically; see `golang-errors` for the
error-typed version of this same mechanism and how to structure a function
so it can't happen.

## Type switches over ad hoc assertions

Use `v, ok := x.(T)` for one specific type; use a type switch when a value
could legitimately be several types, and always include `default` so a
newly added implementation shows up as a visible gap instead of silently
falling through:

```go
switch v := shape.(type) {
case Circle:
    return v.Radius * 2
case Square:
    return v.Side
default:
    return 0 // decide deliberately — don't let this be an accident
}
```

Don't use a type assertion as a substitute for a properly typed parameter —
ask for the type you need directly. Legitimate uses: detecting an
*optional* extra interface a value might also implement (`io.Copy` checking
for `io.WriterTo`), and dispatching over a closed set of types behind one
interface. Note a switch/assertion can't see through a decorator/wrapper —
it only sees the wrapping type, not what's inside it.

## Embedding is composition, never inheritance

```go
type Base struct{ ID string }
func (b Base) Describe() string { return "id:" + b.ID }

type Widget struct {
    Base
    Name string
}
```

- No upcast: `Widget` cannot be assigned to a `Base` variable without an
  explicit `w.Base`.
- Same-named methods/fields on the outer type shadow the embedded one;
  reach the embedded version explicitly (`w.Base.Describe()`).
- **No dynamic dispatch.** If `Base.Describe` calls another `Base` method
  and `Widget` overrides that other method, the call inside `Describe`
  still runs `Base`'s version — embedded methods don't know they're
  embedded. Don't design a template-method/override pattern around
  embedding; Go doesn't have that.
- You can embed an interface in a struct (common in test stubs: embed it,
  override only what the test needs) and embed an interface in another
  interface (`io.ReadCloser` = `Reader` + `Closer`).
- An embedded field's methods count toward the outer struct's method set,
  which is how embedding one struct in another commonly makes the outer
  struct satisfy an interface the inner one already satisfies.

## iota — internal enumerations only

```go
type Status int
const (
    StatusPending Status = iota
    StatusActive
    StatusDone
)
```

Use `iota` only when the numeric value is purely internal — nothing
outside your program (a DB column, wire format, another service) depends
on the specific integer. Inserting a constant mid-block renumbers
everything after it, silently breaking anything that persisted the old
value. If a spec assigns specific values, write them explicitly instead.
If there's no natural zero value, reserve the first `iota` slot for an
explicit "unset/invalid" constant so an un-initialized variable is
detectable rather than reading as a valid member.

## Generics: when to use, and when not to

Use a generic type or function for near-identical logic you'd otherwise
duplicate per type purely because of the compiler — containers (stack,
tree), or slice algorithms with no type-specific behavior:

```go
func Keys[K comparable, V any](m map[K]V) []K {
    out := make([]K, 0, len(m))
    for k := range m {
        out = append(out, k)
    }
    return out
}
```

Don't reach for generics:
- **As a performance fix.** Turning an interface parameter into a generic
  type parameter isn't reliably faster in current Go — for small functions
  it has measured *slower*, since the compiler still dispatches at runtime
  across the concrete types plugged in, plus an extra lookup. Profile
  first; never do this speculatively.
- **When one interface, one implementation, already works.** A generic
  `Repository[T]` with a single concrete usage is a wrapper, not reuse.
- **To get operator overloading or custom `range`/indexing.** Go generics
  don't support either — a generic container type alone doesn't make
  `c[i]` or `for range c` work.

## Constraints and type terms

`any` permits every type with no operators; `comparable` permits `==`/`!=`
and map-key use. For arithmetic/ordering, list concrete types explicitly:

```go
type Number interface {
    ~int | ~int32 | ~int64 | ~float32 | ~float64
}
```

- `~T` matters: bare `int` matches only the literal `int` type; `~int`
  also matches any user-defined type whose underlying type is `int`.
  Omitting `~` is the usual cause of "MyInt does not satisfy Number" on a
  type with the right underlying type.
- A constraint can combine a type element with required methods:
  `interface { ~int; String() string }`.
- A type element (`|`-separated list) is legal only inside a constraint —
  never as the type of a variable, field, parameter, or return value.
- Prefer `cmp.Ordered`/`cmp.Compare`/`cmp.Less` (1.21+) over a hand-rolled
  ordering constraint — it composes with code that already expects it.

## Generic limitations to design around

- **No type parameters on methods.** A generic type's methods reuse the
  type's own parameters but can't introduce a new one — no generic `Map`
  method on a generic slice type. Write a standalone generic function
  instead of chaining methods.
- **No variadic type parameters** — only variadic value parameters.
- **Constants must be valid for every type term** — a function constrained
  to include `int8` can't add a literal like `1000` inside its body.
- **Type inference needs the parameter in an input argument.** If a type
  parameter appears only in the return type, supply it explicitly:
  `Convert[int, int64](x)`.
- Prefer `slices.*`/`maps.*` (1.21+ — `slices.Contains`, `slices.SortFunc`,
  `maps.Clone`, `maps.Keys`, etc.) over writing your own generic
  `Map`/`Filter`/`Reduce`/slice helpers.

## Standard library additions worth knowing (1.21+)

- `cmp`: `Ordered` constraint plus `Compare`/`Less`.
- `slices`/`maps`: generic equality, search, sort, clone, delete-func —
  check here before writing a generic helper yourself.
- `sync.OnceValue`/`OnceValues`: generic "compute once, cache" wrappers,
  replacing a hand-rolled `sync.Once` + package-level variable.
- Use `any` in new code, not `interface{}` — the standard library itself
  made this switch.
