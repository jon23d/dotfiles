---
name: golang-stdlib
description: Use when writing or reviewing Go code that reads/writes streams (io), handles durations or timestamps (time), marshals or unmarshals JSON (encoding/json), builds an HTTP client or server (net/http), logs (log/slog), or operates on slices/maps — especially when the code relies on a stdlib default (client/server timeouts, JSON "empty" semantics, ServeMux globals) without setting it explicitly.
---

# Go Standard Library

## Overview

The stdlib's dangerous defaults are silent: no timeout, no error, just a
program that hangs or leaks under load instead of failing fast in dev. This
skill is a checklist of where the zero-value default is wrong and what to set
instead, plus the idiomatic shape for io, time, encoding/json, net/http,
log/slog, and slices/maps.

## io: Reader/Writer contracts

- `Read` can return `n > 0` **and** a non-nil error in the same call — process
  `buf[:n]` before checking `err`, not after. Checking `err` first the way you
  would for every other stdlib call silently drops the last chunk.
- `io.EOF` is not a failure; it means "no more data." `io.ErrUnexpectedEOF`
  means the stream stopped mid-record — treat that one as a real error.
- Compose readers/writers instead of buffering fully: `io.MultiReader`
  (concatenate), `io.LimitReader` (cap bytes read), `io.MultiWriter` (fan-out
  writes, e.g. body + hash). Chain them; don't write a bespoke wrapper.
- `io.ReadAll` / `os.ReadFile` / `os.WriteFile` are fine for small, bounded
  data. For anything unbounded (uploads, large files), stream through
  `bufio.Scanner`/`io.Copy` against an `*os.File` or request body instead —
  `ReadAll` on an attacker-controlled body is an unbounded-memory footgun.
- Need to satisfy `io.ReadCloser` from a bare `io.Reader` (e.g.
  `strings.Reader` has no `Close`)? Use `io.NopCloser`, not a hand-rolled
  wrapper struct.
- Accept the narrowest interface your function actually uses
  (`io.Reader`, not `*os.File`) — it documents intent and lets callers pass a
  network body, a buffer, or a file interchangeably.
- Always `defer f.Close()` for a `Closer` acquired outside a loop. Inside a
  loop, call `Close` explicitly at the end of each iteration (and on every
  early-exit path) — a `defer` there doesn't run until the whole function
  returns, so it accumulates open handles.

## time: Duration vs Time

- `time.Duration` is int64 nanoseconds; build one from typed constants
  (`2*time.Hour + 30*time.Minute`), never a bare integer — the constants make
  the unit unambiguous and buy compile-time type safety.
- **Never compare `time.Time` with `==`.** Two values can represent the same
  instant with different monotonic-clock readings or locations and compare
  unequal. Use `t1.Equal(t2)`, and `Before`/`After` for ordering.
- `time.Now()` embeds a monotonic reading used automatically by `Sub` for
  elapsed-time math, so wall-clock adjustments (NTP, DST) don't corrupt a
  duration measurement — but only when *both* sides came from `time.Now()`.
  A `time.Time` built via `Parse` or a literal has no monotonic component, so
  mixing one into a `Sub` falls back to wall-clock subtraction.
- Formatting uses the reference layout `Mon Jan 2 15:04:05 MST 2006`
  (mnemonic: 1 2 3 4 5 6 7), not `%Y-%m-%d`-style verbs — reach for the
  predefined layout constants (`time.RFC3339`, etc.) before hand-writing one.
- `time.Tick` leaks: its ticker is never garbage-collected because nothing
  can stop it. Use `time.NewTicker` (gives you `.Stop()`) for anything
  outside a short-lived example program. Prefer `time.AfterFunc` over a
  goroutine + `time.After` when you just need "run this once, later."

## encoding/json

- Struct tags (`` `json:"name,omitempty"` ``) are plain strings the compiler
  doesn't validate — `go vet` does; keep it enabled. Set the tag explicitly
  even when the field name already matches, and use `json:"-"` to exclude a
  field entirely.
- `omitempty`'s "empty" is **not** the zero value: a zero-length slice/map is
  empty, but a zero-value struct is not. A `time.Time{}` field with
  `omitempty` still gets marshaled.
- `json.Unmarshal(data, &v)` writes into `v` in place — pass a pointer to a
  reused struct rather than allocating a fresh one per call when processing
  many records.
- For a stream, an HTTP body, or a large file, use `json.NewDecoder(r).Decode(&v)`
  / `json.NewEncoder(w).Encode(v)` directly against the `io.Reader`/`io.Writer`
  — don't `io.ReadAll` into a byte slice first just to call `json.Unmarshal`.
  `Decoder` also handles NDJSON-style streams (repeated top-level values, no
  wrapping array): loop `Decode` until `errors.Is(err, io.EOF)`.
- Custom field encoding (e.g. a non-RFC3339 timestamp): implement
  `MarshalJSON`/`UnmarshalJSON` on a named type that embeds the real one
  (`type RFC822ZTime struct{ time.Time }`), not on the containing struct —
  keeps the parsing concern isolated to the one field.
- If you must override just one field's encoding on an existing struct without
  changing its type, use the "shadow type" trick: define
  `type Dup <ContainingStruct>` (strips the methods, keeps the fields) inside
  `MarshalJSON`, embed `Dup` in an anonymous struct alongside the overridden
  field, and marshal that. Calling `json.Marshal` on the struct itself from
  inside its own `MarshalJSON` recurses infinitely — `Dup` is what breaks the
  loop.
- Do **not** reach for `encoding/gob` or `net/rpc` for new code — both are
  Go-specific wire formats. Use gRPC or plain JSON/HTTP so non-Go clients can
  talk to the service.
- `map[string]any` round-trips arbitrary JSON but throws away the compiler's
  help. Use it only while exploring an unfamiliar payload shape; replace with
  a concrete struct before merging.

## net/http: client

- **`http.DefaultClient` (and the package-level `http.Get`/`Post`/`Head`
  helpers that use it) has no timeout.** A hung server on the other end hangs
  your goroutine forever. Always construct your own:
  ```go
  client := &http.Client{Timeout: 30 * time.Second}
  ```
- One `*http.Client` is safe for concurrent use — build it once (it pools
  connections) and share it, don't construct one per request.
- Build requests with `http.NewRequestWithContext(ctx, method, url, body)`,
  not `http.NewRequest` — a context-less request can't be canceled or
  deadlined by its caller, only by the client's blanket `Timeout`.
- `Timeout` on the client is a ceiling on the *whole* round trip (connect +
  redirects + read body); a context deadline lets a caller impose a tighter,
  per-call limit on top of it. Use both when call sites have different
  latency budgets.
- Always check `resp.StatusCode` before decoding the body — a non-2xx
  response can still carry a JSON body shaped like an error, and skipping the
  check feeds error payloads to your success-path decoder.
- Always `defer resp.Body.Close()`, even on non-2xx responses — the
  connection isn't returned to the pool until the body is drained and closed.

## net/http: server

- `http.Server{}` with a bare `Addr`/`Handler` has **no read, write, or idle
  timeout** — a slow or malicious client can hold a connection open
  indefinitely. Set all three:
  ```go
  srv := &http.Server{
      Addr: ":8080", Handler: mux,
      ReadHeaderTimeout: 5 * time.Second,
      ReadTimeout:       30 * time.Second,
      WriteTimeout:      90 * time.Second,
      IdleTimeout:       120 * time.Second,
  }
  ```
- `http.ResponseWriter` methods have a required call order: `Header()` to set
  response headers, then `WriteHeader(code)`, then `Write(body)`. Calling
  `Write` first implicitly sends a `200` and any headers set afterward are
  ignored — set headers before you write.
- Status codes (`http.StatusOK`, etc.) are untyped int constants, not a
  dedicated type — nothing stops passing a garbage int to `WriteHeader`, so
  stick to the named constants.
- Go 1.22+'s `http.ServeMux` supports method-prefixed patterns and path
  wildcards natively — prefer it over a third-party router until you need
  something it genuinely lacks (regex constraints, header-based routing):
  ```go
  mux.HandleFunc("GET /widgets/{id}", func(w http.ResponseWriter, r *http.Request) {
      id := r.PathValue("id")
  })
  ```
- Nest routers with `http.StripPrefix`: `mux.Handle("/v1/", http.StripPrefix("/v1", v1Mux))`.
  A sub-mux still needs its own patterns written without the prefix.
- **Never build against the package-level `http.DefaultServeMux`** (i.e.
  `http.HandleFunc`, `http.Handle`, `http.ListenAndServe` used directly) in
  anything beyond a throwaway script. It's global mutable state: any
  imported package can register a handler on it via `init()`, and you have
  no `http.Server` to attach timeouts to. Always create your own
  `http.NewServeMux()` and `http.Server`.
- To use functionality added to `http.ResponseWriter` after an implementation
  shipped (flushing, deadlines) without a fragile type assertion, wrap it:
  `rc := http.NewResponseController(w)`, then `rc.Flush()` /
  `rc.SetWriteDeadline(...)`, checking the returned error against
  `http.ErrNotSupported` via `errors.Is`.

## net/http: middleware

- The idiomatic shape is `func(http.Handler) http.Handler` returning a
  closure — do setup/checks, call `next.ServeHTTP(w, r)` if they pass, run
  cleanup after. See `golang-project-layout` for a concrete `Chain` helper;
  stdlib has no built-in chaining.
- Configurable middleware is a function that *returns* that shape:
  `func WithAuth(secret string) func(http.Handler) http.Handler` — call it
  once at wiring time to get the actual middleware, then compose:
  `withAuth(RequestTimer(mux))` runs `withAuth` first (outermost) on every
  request, `RequestTimer` second, `mux` last.
- Middleware wraps `*http.ServeMux` too (it implements `http.Handler`), so
  one call applies a stack to every registered route at once instead of
  wrapping each handler individually.
- To pass a value (user ID, request ID) from middleware down to a handler,
  put it on the request's context via `r = r.WithContext(ctx)` and read it
  back with `r.Context()` in the handler — don't invent a side channel.

## log/slog

- `log/slog` (structured) and `log` (unstructured) are deliberately separate
  packages — don't route one through the other except via the explicit
  bridge (`slog.NewLogLogger`) when a dependency still expects a
  `*log.Logger`.
- Package-level `slog.Debug/Info/Warn/Error` use a default logger whose
  minimum level is `Info` — a `slog.Debug` call is silently dropped unless
  you build a logger with `slog.HandlerOptions{Level: slog.LevelDebug}`.
- Structured fields are variadic key/value pairs after the message:
  `slog.Info("user login", "id", userID, "login_count", n)`. Keys should be
  string constants you control, not user input — an attacker-controlled key
  can shadow a field you rely on downstream.
- Build a custom logger for anything beyond default stderr text:
  `slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: lvl}))`. Swap
  `NewJSONHandler` for `NewTextHandler`, or implement `slog.Handler` yourself
  for a custom sink.
- On a hot path, prefer `logger.LogAttrs(ctx, level, msg, slog.String("id", id), ...)`
  over the variadic form — it skips the `any`-boxing/allocation the
  key-value varargs API does per call.
- `log/slog` accepts a `context.Context` in `LogAttrs` (and `InfoContext`,
  etc.) specifically so a `slog.Handler` can pull request-scoped values
  (trace ID) out of context — use the `*Context` variants at request scope
  instead of the plain ones.

## slices / maps (Go 1.21+)

- Prefer `slices.Contains`, `slices.Index`, `slices.Equal`, `slices.Sort`,
  `slices.SortFunc`, `slices.Compact` (dedupe adjacent), `slices.Clone`, and
  `maps.Clone`, `maps.Equal`, `maps.DeleteFunc` over a hand-rolled loop —
  they're generic, allocate less than a naive implementation, and signal
  intent immediately. Don't write a local `contains[T]` helper; it's already
  in `slices`.
- `slices.Sort` is unstable (like `sort.Slice` but generic and faster since
  it avoids reflection); use `slices.SortStableFunc` when input order among
  equal elements must be preserved.
- The builtin `clear(m)` empties a map or zeroes a slice's elements in place
  — use it instead of a `for k := range m { delete(m, k) }` loop.
- `maps.Keys`/`maps.Values` (Go 1.23+) return `iter.Seq[K]`/`iter.Seq[V]`
  (range-over-func), not a slice — range over them directly, or wrap in
  `slices.Collect` if you actually need a `[]K`/`[]V`. Don't assume the
  iteration order is stable; sort explicitly if output order matters.
- These packages replace most cases for a generic container type. Reach for
  a custom `Set[T]` or `OrderedMap[K,V]` only when `slices`/`maps` plus a
  plain `map[T]struct{}` genuinely can't express what you need.

## Common mistakes

- Using `http.DefaultClient`/`http.Get` or a bare `http.Server{}` and
  discovering the hang-forever behavior in production instead of at review
  time — grep for both whenever reviewing HTTP code.
- Checking a `Read` error before using `n` bytes already copied into the
  buffer, silently dropping the tail of a stream.
- `io.ReadAll`-ing a request body before `json.Decode`-ing it — doubles
  memory and is unnecessary; decode straight from `r.Body`.
- Comparing `time.Time` values with `==` in a test or cache key and getting
  intermittent failures depending on monotonic/location state.
- Building global handlers on `http.DefaultServeMux` in a library, silently
  polluting every binary that imports it.
- Calling `w.Write` before setting response headers, then wondering why a
  header never made it to the client.
