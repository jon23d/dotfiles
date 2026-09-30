---
name: golang-concurrency
description: Use when writing or reviewing Go code that launches goroutines, uses channels or select, coordinates goroutines with WaitGroup/errgroup/Once/Mutex, builds a worker pool, uses context.Context for cancellation/deadlines/request-scoped values, or needs the race detector run against concurrent code.
---

# Go Concurrency

## Overview

Go's concurrency model is goroutines + channels + `select`, not shared
mutable state guarded by locks. Every goroutine you launch needs a proven
exit path, every channel needs exactly one owner responsible for closing it,
and `context.Context` is the mechanism for telling goroutines it's time to
stop. Reach for a mutex only when you're protecting a struct field in place,
not when you're moving or transforming a value between goroutines.

## Goroutine lifecycle and leak prevention

A goroutine that can't exit leaks its stack and everything rooted in it
forever — the Go runtime has no way to detect an abandoned goroutine the way
the GC detects an abandoned variable.

- Before writing `go func() { ... }()`, name the condition that makes it
  return. "The caller stops reading the channel" is not an exit condition —
  it's a leak waiting to happen.
- Wrap business logic in a closure that handles the concurrency bookkeeping,
  and keep the wrapped function itself unaware it's running in a goroutine.
  This keeps the logic testable without goroutines at all.
- Do use a `select` with `ctx.Done()` inside any loop that writes to or reads
  from a channel a consumer might stop draining early:

```go
func countTo(ctx context.Context, max int) <-chan int {
	ch := make(chan int)
	go func() {
		defer close(ch)
		for i := 0; i < max; i++ {
			select {
			case <-ctx.Done():
				return
			case ch <- i:
			}
		}
	}()
	return ch
}
```

- Don't rely on "the program will exit anyway" — that only covers `main`
  exiting, not long-lived servers where a leaked goroutine per request adds
  up.

## Channel ownership and closing rules

- **The writer closes the channel, never the reader.** Writing to, or
  closing, an already-closed channel panics. Closing is only required when
  something is blocked waiting for the channel to end (e.g. a `for range`) —
  an unreferenced open channel is garbage collected fine.
- **When multiple goroutines write to one channel**, none of them may close
  it individually — a second `close` panics. Use a `sync.WaitGroup` and a
  dedicated closer goroutine (`go func() { wg.Wait(); close(out) }()`) so
  close happens exactly once, after every writer is done. See the worker
  pool example below for this pattern in full.
- **Reading a closed channel always succeeds immediately**, returning
  buffered values first, then the zero value forever. Use the comma-ok form
  (`v, ok := <-ch`) whenever a channel might be closed — `ok == false` means
  closed, not "zero was sent."
- Annotate channel parameters and fields with direction (`in <-chan T`,
  `out chan<- T`) so the compiler — not a comment — enforces who reads and
  who writes.
- **Never expose a raw channel or mutex in a public API.** That hands the
  caller responsibility for buffering, closing, and nil-checking it, and
  lets them deadlock your package from outside it. Unexported fields and
  function parameters are fine.
- To silence one branch of a `select` after its channel is drained (e.g.
  merging two closing channels), set that channel variable to `nil` instead
  of `continue`-ing past it — a `nil` channel's case never becomes ready,
  effectively removing it from the `select` without extra branching state.

## select

- When multiple cases are ready, `select` picks one at random — this avoids
  starving any one case and sidesteps the classic "acquired locks in
  inconsistent order" deadlock, so don't try to bias `select` toward a
  "priority" case with duplicated cases or sleeps.
- A `for { select { ... } }` loop (a "for-select loop") needs an explicit
  case that returns/breaks — almost always `case <-ctx.Done():` — or it never
  exits.
- `default` makes a `select` non-blocking: use it for a single try-then-move-on
  check (e.g. a token-bucket-style backpressure gate). **Never put `default`
  in a for-select loop** — with nothing to wait on, the loop spins
  continuously and burns a CPU core.

## Loop variables and closures (Go 1.22+)

See `golang-idioms` for the general Go 1.22+ per-iteration loop-variable rule
and the pre-1.22 shadow workaround (`v := v`) — it applies identically to a
`go func()` launched from a loop:

```go
// Go 1.22+: each goroutine sees its own v. No shadowing needed.
for _, v := range values {
	go func() { results <- process(v) }()
}
```

The goroutine-specific consequence worth calling out here: this fix only
covers the loop variable itself — **any other variable a closure captures
that changes after the goroutine is launched still needs to be copied in
explicitly** (shadow it or pass it as an argument), regardless of `go`
directive.

## WaitGroup, errgroup, Once, Mutex

- **`sync.WaitGroup`**: zero value is ready to use. `Add` before launching
  (usually once, with the total count), `defer wg.Done()` inside each
  goroutine so it still runs on panic, `Wait` in the coordinator. Capture the
  WaitGroup via closure (don't pass it by value — a copy has its own
  counter). Reach for a WaitGroup only when you need cleanup *after* every
  launched goroutine finishes, like the close-once pattern above — it is not
  a general-purpose coordination tool.
- **`errgroup.Group`** (`golang.org/x/sync/errgroup`): prefer this over a bare
  WaitGroup when any goroutine in the set can fail — it collects the first
  error and `g.Wait()` returns it, and `errgroup.WithContext` cancels the
  shared context as soon as one goroutine errors, so siblings can stop early
  instead of finishing wasted work.
- **`sync.Once`**: zero value ready to use; `once.Do(f)` runs `f` exactly
  once under concurrent calls. Declare it at package/struct level, never
  inside a function called repeatedly (a fresh `Once` remembers nothing).
  For lazy-init-and-cache, prefer `sync.OnceValue`/`OnceValues` (Go 1.21+)
  over a package variable plus a manual `Once`.
- **Mutex vs. channel** — decide with this order:
  1. Coordinating goroutines, or moving/transforming a value as it passes
     between them → channel.
  2. Guarding access to a field or map shared in place, with no ownership
     transfer → mutex (`sync.RWMutex` if reads dominate writes).
  3. Switch a channel to a mutex only after profiling shows the channel is
     the actual bottleneck — not preemptively.
- Pair `Lock`/`Unlock` (or `RLock`/`RUnlock`) with `defer` immediately after
  acquiring. `sync.Mutex` is **not reentrant** — locking it twice from the
  same goroutine deadlocks, so never hold a lock across a call into code that
  might reacquire it.
- Never copy a `Mutex`, `RWMutex`, `WaitGroup`, or `Once` — store them as a
  field and access via a pointer receiver; a copy has independent state and
  breaks the synchronization silently.
- `sync.Map` is a narrow-purpose type (disjoint keys written once, read many
  times by many goroutines) and isn't generic. Default to a plain `map`
  guarded by a `sync.RWMutex` unless you're specifically in that case.
- `sync/atomic` is for measured, single-word hot paths. Use a mutex first;
  reach for atomics only after profiling justifies it.

## Worker pools

Launch a fixed number of goroutines that range over one input channel and
write to a buffered output channel sized to what you're gathering, so
workers never block waiting on a slow consumer:

```go
func processAll[T, R any](in <-chan T, f func(T) R, workers int) []R {
	out := make(chan R, workers)
	var wg sync.WaitGroup
	wg.Add(workers)
	for i := 0; i < workers; i++ {
		go func() {
			defer wg.Done()
			for v := range in {
				out <- f(v)
			}
		}()
	}
	go func() { wg.Wait(); close(out) }()

	var results []R
	for r := range out {
		results = append(results, r)
	}
	return results
}
```

Close `in` from the single producer when there's no more work; workers exit
their `range` loop naturally, and the close-once pattern shuts down `out`.

## Context: cancellation, deadlines, and values

- `context.Context` is always the first parameter, named `ctx`, never stored
  on a struct — derive it fresh per call chain and pass it down.
- A context is immutable; adding to it (`context.WithValue`,
  `WithCancel`, `WithTimeout`) wraps it in a child. Reassigning the same
  `ctx` variable to the child (`ctx = context.WithValue(ctx, ...)`) is the
  idiomatic style.
- **Cancellation**: `ctx, cancel := context.WithCancel(parent)` — `defer
  cancel()` immediately, even on the success path, or you leak the internal
  goroutine/timer backing the context. Calling `cancel` more than once is a
  safe no-op. `Done()` returns a channel closed on cancellation; on a context
  that's never cancellable it returns `nil`, which blocks forever if you read
  it outside a `select` — always pair `<-ctx.Done()` with other cases.
- Use `context.WithCancelCause` + `context.Cause(ctx)` when callers need to
  know *why*, not just that a context was cancelled.
- **Deadlines**: `WithTimeout`/`WithDeadline` cancel automatically; a child's
  deadline is capped by its parent's — whichever fires first wins, even if
  the child requested more time. After cancellation, `ctx.Err()` is
  `context.Canceled` (explicit) or `context.DeadlineExceeded` (timed out);
  use `WithTimeoutCause`/`WithDeadlineCause` for a custom sentinel via
  `context.Cause`.
- **Values**: use `context.WithValue` only for cross-cutting request
  metadata that can't flow through normal parameters — an auth identity
  extracted by middleware, a request/trace ID — never for required business
  inputs; those stay explicit parameters. Key with an unexported type
  (`type userKey int` + `iota`, or `type userKey struct{}`), never a bare
  `string` — a string key can collide with one from another package. Name
  the accessor pair `ContextWithX` / `XFromContext`, and extract the value
  into an explicit parameter as soon as you reach the business logic that
  needs it.
- In your own long-running code (not a library call), support cancellation
  by checking `context.Cause(ctx)` periodically in compute loops, and by
  including `case <-ctx.Done():` in any `select` on channels. A call to
  another service or a database doesn't need this — pass `ctx` through
  (`http.NewRequestWithContext`, etc.) and let that library handle it.
- For the top-level `signal.NotifyContext` + graceful-shutdown wiring in
  `main`, see `golang-project-layout`.

## Race detector

- Run `go test -race ./...` (and `go run -race` / `go build -race` for a
  binary) whenever a package launches goroutines or shares state — it
  instruments memory access and flags genuine data races (unsynchronized
  concurrent read/write of the same memory) at runtime.
- It only catches races on code paths actually executed during that run —
  a clean `-race` run is not proof of no races, just no races *observed*.
  Prefer tests that actually exercise concurrent goroutines over ones that
  happen to run sequentially.
- Fix a flagged race with a channel handoff or a mutex around the shared
  data — never by adding a `time.Sleep` or reordering statements to make the
  race less likely to trigger.
- `-race` adds real CPU and memory overhead; keep it in tests/CI, not
  production builds.

## Common mistakes

- Launching a goroutine with no path to exit if the consumer stops early —
  add a `ctx.Done()` case.
- Two goroutines racing to `close()` the same channel — route through a
  `WaitGroup` + single closer goroutine instead.
- A `default` case inside a `for-select` loop — spins the CPU.
- Passing a `sync.WaitGroup`/`Mutex`/`Once` by value — copies break the
  shared state.
- A context stored on a struct instead of threaded through as a parameter.
- Forgetting `defer cancel()` on a cancellable/timeout context — leaks its
  backing goroutine.
- Reading `ctx.Value()` for data that should be an explicit function
  parameter.
