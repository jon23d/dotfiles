---
name: golang-idioms
description: Use when writing or reviewing Go code that uses := in nested scopes, slices or maps passed as parameters (aliasing, append, nil vs empty), pointer vs value receivers, defer or named returns, goroutines or closures in loops, or constructors with optional parameters.
---

# Golang Idioms

## Overview

Go's zero-value defaults, its call-by-value semantics for pointer-shaped
types (slices, maps), and `:=`'s dual role (declare vs. reuse) produce a
small set of recurring bugs. This skill is a checklist of those traps and
the idiomatic fix for each — not a Go language tutorial.

## Shadowing and `:=` traps

`:=` only reuses a variable already declared **in the current block**. Any
name on the left that doesn't yet exist in that block is newly declared,
even if a variable of the same name exists in an outer block (an `if`,
`for`, or `switch` body is its own block).

```go
x, err := step1()
if x > 0 {
    y, err := step2() // err is a NEW variable, shadowing the outer err
    _ = y
    // outer err is unchanged — a caller checking it after this block
    // will not see step2's failure
}
```

- Do declare all new variables with `var` first, then use `=` for
  assignment, whenever you're not sure `:=` will target the outer
  variable — this makes intent explicit, not `:=` everywhere.
- Do check: any `:=` inside `if`/`for`/`switch` that mentions a name from
  an enclosing scope is a shadowing risk worth a second look, especially
  with `err`.
- Never shadow a predeclared identifier (`nil`, `true`, `len`, `error`,
  a package name like `fmt`) — the compiler allows it, and every use
  after that point silently resolves to the shadow instead of raising an
  error.

## Slices: nil vs. empty, aliasing, append surprises

- `var s []int` (nil) and `s := []int{}` (empty) both have `len(s) == 0`,
  but `s == nil` differs (`true` vs. `false`). Prefer the nil form for a
  slice that might stay empty — it's the zero value, needs no
  initializer, and works identically with `len`, `range`, and `append`.
  Reach for `[]int{}` only when a consumer (e.g. `encoding/json`) treats
  nil and empty differently and you need `[]` instead of `null`.
- A slice expression (`s[a:b]`) does **not** copy — the result shares the
  same backing array. Writes through either slice are visible in both.
  `append` on a subslice can silently corrupt a sibling slice if there's
  spare capacity to write into:

```go
x := make([]int, 3, 5)          // len=3 cap=5
y := x[:2]                      // shares x's backing array, cap=5
y = append(y, 99)               // writes into x[2] — overwrites x's data!
```

Do use the full slice expression `x[:2:2]` to cap a subslice's capacity
at its length, forcing any `append` on it to allocate a new array instead
of overwriting the parent's memory. Do this whenever you hand out a
subslice and don't want the recipient's `append` calls to affect you.

- `append` may or may not reallocate depending on remaining capacity, so
  never assume `append(s, v)` leaves `s`'s old backing array untouched,
  and never rely on a slice passed into a function being grown in place —
  a function that appends past capacity returns a new slice the caller
  never sees unless it's the return value.
- Use `copy(dst, src)` when you need an independent slice, not a slice
  expression.
- Prefer `make([]T, 0, n)` + `append` over `make([]T, n)` + indexing when
  the final count is uncertain — indexing into a `make([]T, n)` slice
  that turns out too long leaves trailing zero values; too short panics.
  `append` never leaves either artifact.
- Use `slices.Equal`/`slices.EqualFunc` (stdlib `slices` package) to
  compare slice contents — `==` on slices is a compile error, and
  `reflect.DeepEqual` is a legacy fallback, not the idiomatic choice (see
  `golang-reflect-unsafe-cgo` for when `DeepEqual` is still the right call).
  See `golang-stdlib` for the fuller `slices`/`maps` package rundown beyond
  this equality check.

## Maps: nil vs. empty, aliasing

- A nil map (`var m map[K]V`) is safe to **read** (misses return the zero
  value) but panics on **write**. Always initialize with `make` or a map
  literal before writing, including on a struct field.
- Maps are reference types like slices: passing one to a function shares
  the underlying data, and writes inside the function are visible to the
  caller — unlike slices, there's no length/capacity to desync, so map
  mutations are always fully visible both ways.
- Iteration order is randomized per run by design (a Hash-DoS mitigation,
  not a bug) — never depend on it; sort keys explicitly if order matters.
  `fmt.Println` on a map is the one exception: it always sorts keys.
- Use `clear(m)` (Go 1.21+) to empty a map in place instead of
  reallocating; use `maps.Equal`/`maps.EqualFunc` to compare two maps (see
  `golang-stdlib` for the rest of the `slices`/`maps` toolkit).
- To simulate a set, prefer `map[T]bool` over `map[T]struct{}` unless
  memory footprint is measured to matter — `struct{}` values save bytes
  but force every read site onto the comma-ok idiom instead of a plain
  boolean check.

## Zero values

- Every declared-but-unassigned variable gets a usable zero value (`0`,
  `""`, `false`, `nil` for pointers/slices/maps/funcs/chans/interfaces, a
  struct with every field zeroed). Design types so the zero value is
  useful on its own (`var buf bytes.Buffer` works with no init) rather
  than requiring a constructor — this is idiomatic Go, not a shortcut.
- A zero-value struct is not the same signal as "no value was provided."
  If a caller needs to distinguish "field unset" from "field is the zero
  value," use a pointer field or a second `bool`/comma-ok-style
  indicator — don't overload the zero value to mean absence unless the
  domain genuinely can't distinguish it (e.g., JSON round-tripping, where
  a `*string` field is the standard way to represent an optional value).

## Pointer vs. value semantics

- Go is strictly call-by-value. Passing a struct copies it; passing a
  pointer copies the pointer (still pointing at the original). A
  function can never make a nil pointer parameter non-nil for the
  caller — it can only mutate `*p` when `p` is already non-nil.
- Use a pointer receiver/parameter only when the function must mutate the
  receiver, the struct is large enough that copying is measurably
  expensive, or the type must satisfy an interface requiring a pointer
  receiver (see below). Otherwise return a new value instead of mutating
  through a pointer — it keeps data flow readable.
- Once a type has *any* pointer-receiver method, use pointer receivers
  for all its methods, even non-mutating ones, for method-set
  consistency.
- A pointer receiver's method set is not a superset available on the
  value automatically in every context: a value stored in an interface
  variable only has the value receiver methods; calling a pointer-only
  method through that interface fails to compile, whereas calling it on
  an addressable local variable works because Go auto-takes `&`.
- Don't use a pointer parameter just to avoid a copy without measuring —
  small structs (a few words) copy about as fast as a pointer indirection
  and keep the compiler's escape analysis happier (more stays on the
  stack, less garbage-collector pressure).

## `defer` rules

- Deferred calls run in LIFO order, after the surrounding function's
  `return` statement executes, but before control returns to the caller.
- Arguments to a deferred call are evaluated immediately when `defer`
  runs, not when the deferred call executes:

```go
func f() {
    x := 1
    defer fmt.Println("x was", x) // captures 1 now
    x = 2
    // prints "x was 1" when f returns, not "x was 2"
}
```

Wrap the whole thing in a closure (`defer func() { fmt.Println(x) }()`)
when you want the deferred call to see the value at exit time instead.

- A deferred function can only read or modify the caller's return value
  when that value is a **named** return — this is the main legitimate
  reason to use named returns (e.g. converting a panic into an error, or
  rolling back a transaction only if `err` ended up non-nil).
- `defer` inside a tight loop accumulates all deferred calls until the
  *function* returns, not the loop iteration — a `defer f.Close()` inside
  a loop over many files leaks file handles until the function exits.
  Extract the loop body into its own function (or call `Close` directly)
  when the loop can run many times.

## Closures and loop variables

- Since Go 1.22, `for` and `for range` create a **new** copy of the
  index/value variable on every iteration (set the `go` directive in
  `go.mod` to `1.22` or later to get this). Before 1.22, the loop
  variable was reused across iterations, so a closure or goroutine
  capturing it by reference saw whatever value it held when the closure
  *ran*, not when it was created — almost always the final iteration's
  value.
- On Go < 1.22 (or when the module's `go` directive pins an older
  version), pass the loop variable explicitly into the closure/goroutine
  to capture the value as of that iteration:

```go
for _, v := range items {
    v := v // shadow: bind a fresh copy for this iteration
    go func() { process(v) }()
}
```

- Even on 1.22+, `for i, v := range slice { ... }`'s `v` is still a
  **copy** of each element (see "for-range value is a copy" — mutating
  `v` never mutates the slice). Index into the slice (`slice[i] = ...`)
  to mutate elements in place.

## Named returns

- Named returns predeclare the return variables at their zero values;
  `return` with no arguments (a "naked" return) returns whatever they
  currently hold. Avoid naked returns in anything but the shortest
  functions — they force the reader to scan backward to find the last
  assignment to know what's actually returned.
- A named return can still be shadowed like any other variable — a
  `result, err := ...` inside a nested block creates new locals that
  never reach the named return unless you use `=` instead of `:=`, or
  assign the outer names explicitly before `return`.
- Use named returns primarily to give a `defer` access to the return
  values (see `defer` rules above); using them purely as inline
  documentation is a matter of taste and easy to overuse.

## Functional options

For constructors with several optional parameters, don't grow a
multi-argument constructor or add a mutable "config" struct with public
fields callers forget to set correctly. Use the functional options
pattern: a variadic slice of functions that each mutate an unexported
config struct, applied inside the constructor.

```go
type serverConfig struct {
    timeout time.Duration
    maxConn int
}

type Option func(*serverConfig)

func WithTimeout(d time.Duration) Option {
    return func(c *serverConfig) { c.timeout = d }
}

func NewServer(addr string, opts ...Option) *Server {
    cfg := serverConfig{timeout: 30 * time.Second, maxConn: 100} // defaults
    for _, opt := range opts {
        opt(&cfg)
    }
    return &Server{addr: addr, cfg: cfg}
}
```

- Do this when a constructor has more than two or three optional
  parameters, or when new optional parameters are expected over time —
  adding an `Option` is backward compatible; adding a positional
  parameter is not.
- Don't reach for it for one or two required parameters — plain
  arguments are clearer and it's not idiomatic to wrap mandatory
  parameters in options.
- Keep the config struct unexported so callers can only construct it
  through options, preserving the ability to add fields later without
  breaking callers.
