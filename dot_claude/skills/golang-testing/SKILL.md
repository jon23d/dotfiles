---
name: golang-testing
description: Use when writing or reviewing Go tests that use t.Run subtests, t.Parallel, t.Helper, t.Cleanup, or t.TempDir; when writing table-driven tests, benchmarks (testing.B), or fuzz tests (testing.F); when stubbing a dependency behind an interface for a unit test; when a test uses net/http/httptest; or when deciding whether to add -race, -cover, or -count=1 to a go test invocation.
---

# Go Testing (stdlib `testing` toolkit)

## Overview

This is the stdlib `testing` package's mechanics, not the TDD loop itself —
see `tdd` for red-green-refactor and the testify/fake-over-mock defaults, and
`go-testcontainers-shared-db` for DB-backed integration test infrastructure.
This skill is what to reach for once you're inside a `_test.go` file: how to
structure table tests, control subtest lifecycle, fake a dependency, and use
the benchmark/fuzz/race/coverage tooling correctly.

## Error vs. Fatal

- `t.Errorf`/`t.Error`: test keeps running. Use when checking several
  independent things (e.g. multiple struct fields) — one failing check
  shouldn't hide the others.
- `t.Fatalf`/`t.Fatal`: test function stops immediately (other test
  *functions* still run). Use when a failed check means every later check in
  this test would panic or be meaningless (e.g. `err != nil` before
  dereferencing the result).
- Do: `if err != nil { t.Fatal(err) }` before using the value. Don't:
  `t.Error(err)` then dereference a possibly-nil result on the next line —
  that turns one real failure into a nil-pointer panic that obscures it.

## Table-driven tests

Slice of anonymous structs, one `t.Run` per case, name each case for `-run`
targeting and readable `-v` output:

```go
func TestValidate(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		wantErr bool
	}{
		{"valid", "WIDGET-1", false},
		{"empty", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := Validate(tt.in)
			if (err != nil) != tt.wantErr {
				t.Errorf("err = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
```

Comparing error *message strings* is brittle (no compatibility guarantee on
wording). If the function returns a sentinel or a custom error type, assert
with `errors.Is`/`errors.As` instead of comparing `err.Error()`.

## t.Helper, t.Cleanup, t.TempDir

- **`t.Helper()`**: first line of any function that itself calls
  `t.Fatal`/`t.Error` on behalf of a test. Without it, a failure reports the
  line *inside the helper*, not the call site that actually has the bad
  input — useless in a helper called from a dozen tests. Do: put it in every
  `assertX`/`setupY` test helper. Don't: skip it "because the helper is
  simple" — the line number is wrong the moment there's more than one call
  site.
- **`t.Cleanup(fn)`** over `defer` inside a shared setup helper: `defer` only
  unwinds when *that function* returns, so a `defer` inside a helper called
  from the test runs at the *helper's* return, not the test's — often too
  early if the helper is called multiple times or the resource must outlive
  it. `t.Cleanup` always fires when the *test* ends, runs LIFO across
  multiple registrations (even across several helpers), and still fires if
  the test calls `t.Fatal`. Prefer it in any helper that hands back a
  resource the test body will use.
- **`t.TempDir()`**: creates a fresh directory and registers its own cleanup
  automatically. Do: `dir := t.TempDir()`. Don't: hand-roll
  `os.MkdirTemp` + a `defer os.RemoveAll` in every test — that's what
  `t.TempDir()` replaces.
- `t.Setenv(key, val)` also auto-reverts via `Cleanup`, but **panics if the
  test (or its parent) is marked `t.Parallel()`** — env vars are process-wide
  and unsafe to mutate under parallel execution. A subtest can't do both
  (confirmed the hard way — see `tdd`'s Go reference).

## Subtests and parallelism

- `t.Run(name, func(t *testing.T) {...})` gives independent pass/fail per
  case and lets `-run TestX/case_name` target one row.
- `t.Parallel()` as the *first* line of a subtest marks it to run
  concurrently with other parallel subtests. A non-parallel parent doesn't
  finish until all its parallel children have run — the call *pauses* the
  parent's goroutine, it doesn't return early.
- **Loop-variable capture**: see `golang-idioms` for the general Go 1.22+
  per-iteration loop-variable rule. Applied here: with `go 1.22`+ in
  `go.mod`, each `for _, tt := range tests` iteration gets its own `tt`, so
  capturing `tt` in the `t.Run` closure above is safe as written — this
  matters more in tests than most loops because a *parallel* subtest's
  closure runs after the loop has finished queuing all subtests, so on `go`
  directive `1.21` or earlier every one of them captured the same shared
  `tt` and saw the final row's value by the time it actually ran. Fix on old
  versions: shadow inside the loop before the closure, `tt := tt`. `go vet`
  flags this as "loop variable captured by func literal" — don't silence
  that instead of either upgrading the `go` directive or shadowing.
- Don't `t.Parallel()` subtests that share mutable state (a package var, a
  shared non-pooled DB connection, a shared file) — you'll get flaky, not
  faster, tests. Parallelize only cases that are genuinely independent.

## Test doubles via interfaces

Two shapes for hand-written fakes (prefer these over a mocking
library/codegen — see `tdd`'s stance on this):

- **Embed the interface, override what you use**: `type stub struct {
  Entities }` (embedded, unimplemented) then define only the one or two
  methods the test under test actually calls. Fast to write; the trap is
  that calling *any other* method on the embedded zero-value panics at
  runtime (nil interface) — fine as long as you've verified the code path
  under test never reaches them, risky otherwise.
- **Function-field proxy stub**, when different test cases need different
  behavior from the *same* method: give the stub struct one func-typed field
  per interface method, implement each interface method by calling its
  field, and set only the fields a given table-test case needs:

```go
type entitiesStub struct {
	getPets func(userID string) ([]Pet, error)
}

func (s entitiesStub) GetPets(id string) ([]Pet, error) { return s.getPets(id) }
// ... other Entities methods, unused ones can be left nil and unexercised
```

  This scales to per-case behavior in a table test without either
  reimplementing the whole stub per case or cramming every case's expected
  return into one giant switch.
- Naming matters in review: a **stub** returns a canned value for given
  input; a **mock** asserts the *sequence and arguments* of calls made
  against it. Don't call a canned-response fake a "mock" — say what it
  actually checks.

## Benchmarks

```go
func BenchmarkParse(b *testing.B) {
	for i := 0; i < b.N; i++ {
		result = Parse(data) // assign to a package var so the compiler
	}                          // can't optimize the call away
}
```

- Function name starts `Benchmark`, parameter is `*testing.B`, loop to
  `b.N` — the framework reruns with larger `N` until timing stabilizes.
  Assign the result to a package-level variable ("sink"); otherwise the
  compiler can prove the result is unused and eliminate the call.
- `b.Run(name, fn)` (parallel to `t.Run`) to benchmark a matrix of inputs
  (e.g. varying buffer sizes) in one benchmark function.
- Flags: `-bench=<regex>` (`-bench=.` for all), `-benchmem` to add
  bytes/op and allocs/op columns. All regular tests must pass before
  benchmarks run.
- Don't benchmark speculatively. Confirm there's an actual performance or
  allocation problem (profiling, or a benchmark showing an unacceptable
  number) before spending review/maintenance budget on a `Benchmark*`
  function — an untriggered benchmark is dead weight in CI time.

## Fuzzing

```go
func FuzzParse(f *testing.F) {
	f.Add([]byte("3\nfoo\n"))           // seed corpus
	f.Fuzz(func(t *testing.T, in []byte) {
		_, err := Parse(bytes.NewReader(in))
		if err != nil {
			t.Skip("handled error") // not every input needs to succeed
		}
	})
}
```

- `Fuzz<Name>(f *testing.F)`; seed with `f.Add(...)`, whose argument types
  and order must exactly match the extra parameters (after `*testing.T`) of
  the function passed to `f.Fuzz`. Allowed corpus types: integers (incl.
  unsigned/rune/byte), floats, `bool`, `string`, `[]byte`.
- Since inputs are generated, don't assert an exact expected output — assert
  an **invariant**: no panic, an error is returned instead of garbage, or a
  round-trip (encode then decode) reproduces the input.
- Run the corpus as ordinary fast tests with plain `go test` (no `-fuzz`
  flag) — safe for CI. Only `go test -fuzz=FuzzName` actually fuzzes, and
  it's resource-heavy (can run for minutes, allocate heavily) — don't wire
  that into a normal CI run; it's a manual/scheduled tool.
- Every crash the fuzzer finds gets written to `testdata/fuzz/<FuzzName>/`
  and becomes a permanent regression case run on every future `go test` —
  commit these files, don't gitignore `testdata/fuzz`.

## Race detector and coverage

- `go test -race`: instruments the binary to catch unsynchronized
  concurrent access (a goroutine reading what another writes with no
  lock/channel between them). Run it on anything with goroutines, channels,
  or shared state — it won't find every race, but a race it does report is
  real and needs a real fix (a lock, a channel, `sync/atomic`), never a
  `time.Sleep` inserted to "space out" the access.
- `-race` costs roughly 10x runtime — fine for a package's test suite, worth
  weighing before making it the unconditional default for a large monorepo
  CI run; still run it at least in CI even if not in every local iteration.
- `go test -cover`, or `-coverprofile=c.out` then
  `go tool cover -html=c.out` to see exactly which lines a suite exercises.
- 100% coverage proves every line *ran*, not that every line is *correct* —
  a table test that never varies its expected multiplication result would
  hit the multiply branch at 100% coverage and still miss a `+` typo where
  `*` was meant. Treat coverage as a checklist for untested branches, not a
  correctness proof.
- `-count=1` on `go test` forces a real rerun instead of trusting the test
  cache — needed when external state (DB rows, files) changed without any
  Go-visible input changing; see `tdd`'s Go reference for the fuller
  explanation of what the cache does and doesn't track.

## httptest

- `httptest.NewServer(handler)` starts a real listener on a random port for
  testing a client that calls out over HTTP — no need to mock the transport.
  Use `srv.URL` and `srv.Client()`, and always `defer srv.Close()`.
- `httptest.NewRecorder()` + `httptest.NewRequest(...)` (or
  `NewRequestWithContext`, which `golangci-lint`'s `noctx` linter prefers
  even in tests) to call an `http.Handler` directly in-process, with no
  network involved — the cheaper option when you own the handler under test
  and don't need a real client/transport round trip.
- `srv.Close()`'s `defer` **blocks until in-flight handlers return** (same
  gotcha documented in `tdd`'s Go reference). If a handler under test can
  block (e.g. waiting on a channel with a timeout), register any `defer`
  that unblocks it *after* the `defer srv.Close()` line — defers run LIFO,
  so the unblocking one must be added later in the function to fire first.
  Otherwise the test silently pays the handler's full timeout instead of
  returning immediately.
- A closure shared between the fake handler and the table-test loop (e.g. a
  variable the handler reads and the test body writes per case) is fine in
  test code for wiring per-case expected request/response pairs, even
  though the same pattern would be a data race in production code — there's
  no concurrency between the write and the read within one subtest.
