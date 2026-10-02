---
name: golang-modules-and-tooling
description: Use when writing or reviewing Go code that names packages or shapes an exported API, edits go.mod/go.sum or bumps a dependency version, adds an init function, adds build tags or cross-compiles, or wires go vet/staticcheck/golangci-lint/govulncheck/go generate into a build pipeline.
---

# Go Modules and Tooling

Covers package/API design, `internal/` semantics, `init` pitfalls, module
versioning and `go.mod` hygiene, the static-analysis stack, `govulncheck`,
build tags, cross-compilation, and `go generate`. Not directory layout or
`.golangci.yml` scaffolding — see `golang-project-layout` for that; this
skill is the judgment calls layered on top.

## Package naming and API design

A package name is a noun (the thing), not a description of what's inside —
functions are the verbs. This kills the `util`/`common`/`helpers` grab-bag
reflex: a function doesn't need a wrapper package, it needs a package named
after what it operates on.

- Do: package `extract` with `Extract()`, package `format` with `Format()`.
  Don't: package `util` with `ExtractNames()` and `FormatNames()` — every
  call site repeats the redundant word, and the package name teaches the
  reader nothing.
- Don't stutter the package name inside identifiers (`names.ExtractNames`).
  Exception: when the identifier name *is* the package's whole purpose
  (`sort.Sort`, `context.Context`) — that's idiomatic, not stutter.
- Two packages can both export `Names()` — callers disambiguate via the
  package prefix (`extract.Names`, `format.Names`). That's a feature of
  Go's import model, not a naming collision to work around.
- Export deliberately, not by default. Every exported identifier is a
  promise: per Hyrum's Law, enough callers will end up depending on any
  observable behavior regardless of what the doc comment says. Keep
  anything not meant for outside consumption unexported or under
  `internal/`.
- Renaming/moving an exported identifier without a major-version bump:
  keep the old name as a thin wrapper (function/method), or a `type Bar =
  Foo` alias for a type. An alias can't expose the original's unexported
  fields/methods across a package boundary — that limitation is intentional,
  since the API surface is exported-only by definition.
- Doc comments: first word is the symbol's name (`// Convert converts...`),
  one blank-`//`-line between paragraphs, `[pkg.Symbol]` to cross-link. Every
  exported identifier gets one — a linter (below) will flag the ones that
  don't.

## internal/ pitfalls

`internal/<pkg>` is visible only to the package tree rooted at `internal`'s
*parent* — that parent package plus its other direct/indirect children, not
just files textually "under" `internal`. A sibling tree that isn't a
descendant of that parent gets a compile error trying to import it. Verify
the boundary by where `internal`'s parent directory sits, not by assuming
"internal/" is a repo-wide free-for-all.

- Moving code *out of* `internal` is always safe (you're only adding
  visibility). Moving code *into* `internal` after it was already exported
  is a breaking change under Hyrum's Law — treat it like removing an
  exported symbol, with a deprecation path, not a quiet refactor.
- Circular imports (A imports B, B imports A, directly or transitively) are
  a compile error, not a lint warning. The fix is almost never "add an
  interface to break the cycle" in the same two packages — either merge the
  packages (they were probably one concept split too early), or pull the
  shared piece into a third, lower-level package that both import.

## init pitfalls

Prefer no `init` at all; when one exists, treat it with suspicion in review.

- `init` takes no arguments and returns nothing, so it can only act through
  package-level side effects — that makes it untestable in isolation and
  invisible at every call site that triggers it indirectly.
- Multiple `init` funcs (even across files in one package) run in a defined
  but easy-to-get-wrong order. Don't write code whose correctness depends on
  that order — if two `init`s must run in sequence, that's a sign they
  should be one function called explicitly from `main`.
- The blank-import registration pattern (`_ "github.com/lib/pq"` to trigger
  a driver's `init`) is legacy, kept alive only by the stdlib's
  compatibility guarantee (`database/sql`, `image` codecs). Don't add a new
  registry that depends on it — register plugins explicitly by calling a
  function.
- The one defensible use left: initializing an effectively-immutable
  package-level value that can't be built in a single `var` assignment
  (e.g., compiling a regexp, building a lookup table). If a package-level
  var needs to *change* at runtime, that's a sign it belongs inside a
  struct returned by a constructor, not at package scope.
- If `init` does I/O (reads a file, hits the network), say so in the
  package-level doc comment — it runs the moment the package is imported,
  with no call site to grep for.

## Module versioning and go.mod hygiene

- **`go directive` gates language behavior, per module.** The clearest
  example: with `go 1.22`+, a `for range` loop gets a fresh index/value
  variable each iteration (the old shared-variable capture bug is gone).
  This is decided by each imported module's own `go` line, not a global
  toggle — a dependency built against `go 1.21` still gets the old
  semantics even inside a `go 1.22` build. Don't assume bumping your own
  `go.mod` changes a vendored dependency's loop-var behavior.
- **Semantic import versioning for v2+.** Bumping the major version isn't
  just a git tag — the import path itself must end in `/vN` for N ≥ 2
  (`.../simpletax/v2`), because an import path is defined to identify one
  API contract. v0 and v1 share a path; v2+ don't. Skipping this and just
  retagging main is a known anti-pattern: don't do it, and don't accept a
  PR that does.
- **Minimal version selection, not "latest wins."** When two dependencies
  require different versions of the same module, Go picks the *lowest*
  version that satisfies every `go.mod` in the graph — not the newest
  available. Inspect the resolved graph with `go mod graph`; don't assume a
  transitive dependency is on its latest release just because you didn't
  pin it.
- **`go get` semantics differ by form:**
  - `go get ./...` scans your source and adds only what's actually
    imported, correctly marking direct vs `// indirect`.
  - `go get <module>` (no scan) adds/updates that module but marks it
    `// indirect` regardless of whether you use it directly — run `go mod
    tidy` afterward to fix the comments and drop anything actually unused.
  - `go get -u=patch <module>` bumps only the patch version; `go get -u
    <module>` takes the latest minor/patch. Prefer the smallest version
    bump that fixes the problem — smaller diffs in a dependency's behavior
    are less likely to break you.
- **Commit `go.mod` and `go.sum` both, always up to date.** They're what
  make the build reproducible; an out-of-date `go.sum` is a build-breaking
  bug, not a formatting nit.
- **Don't commit a local `replace` directive** (`replace foo => ../foo`) —
  it silently breaks the build for anyone without that exact path on disk.
  For simultaneous cross-module development, use `go work init` /
  `go work use` instead: `go.work` resolves local modules automatically and
  is explicitly meant to never be committed (put it in `.gitignore`).
  `replace` pointing at a specific *pinned fork version* (not a local path)
  is fine and often the right call for an unmaintained upstream.
- `retract` (in your own `go.mod`) marks a version of *your* module as
  "don't select this" for consumers — for a bad release, not for blocking a
  dependency. `exclude` does the opposite: it blocks a version of *someone
  else's* module from being selected in your build. Don't confuse the two.
- Vendoring (`go mod vendor`) is rarely worth it now that the module proxy
  exists; it's still a legitimate call for CI runners with no cache and no
  reliable network access to the proxy.

## Static analysis: vet, staticcheck, golangci-lint

Layer them; don't reach for the heaviest tool by default.

- `go vet` catches near-certain bugs (bad `Printf` verbs, unreachable code,
  struct tag typos) with essentially no false positives — always on, no
  debate.
- `staticcheck` adds 150+ checks with a low false-positive rate — catches
  things `vet` structurally can't, like an assigned-but-never-checked `err`
  reused across multiple calls, or a needless `fmt.Sprintf("literal")`.
  Add it right after `vet`.
- `golangci-lint` aggregates `vet`, `staticcheck`, and dozens more under one
  config; it's the practical team default, but its extra linters (shadow
  checks, `revive` style rules) are fuzzier — false positives are expected.
  Suppress a specific finding inline with a reason in the comment, don't
  disable the whole check repo-wide over one disagreement, and don't put a
  personal config in your home directory when working with a team — one
  shared `.golangci.yml`, committed, or every review turns into a
  formatting argument.
- Treat linter output as "trust, but verify," not gospel — the fix is
  sometimes the code, sometimes a documented suppression.

## govulncheck

- Scans your actual call graph against the Go vulnerability database, not
  just your dependency list — if a vulnerable function in a dependency is
  never reachable from your code, you get a lower-severity "affected
  module, not affected code" notice instead of a hard hit. Don't treat
  every CVE-affected dependency as equally urgent; read which result you
  got.
- Run it two ways: `govulncheck ./...` against source during development/CI,
  and `govulncheck -mode binary <path>` against a built/deployed artifact
  when you need to audit what's actually running (every Go binary embeds
  its module versions — `go version -m <binary>` dumps them even without
  govulncheck).
- When a fix is available, prefer the smallest version bump that resolves
  it (`go get -u=patch`) over jumping to latest, for the same
  minimal-blast-radius reason as any other dependency bump.

## Build tags and cross-compilation

Two mechanisms pick which files build for which target — use the filename
form for a plain OS/arch split (discoverable at a glance), the comment form
when the condition is compound or isn't OS/arch at all:

- **Filename suffix**: `foo_linux.go`, `foo_windows_arm64.go` — matched
  automatically by `GOOS`/`GOARCH` in the name.
- **`//go:build` comment**: supports `&&`, `||`, `!`, parens, and custom
  tags (`-tags mytag`), e.g. `//go:build (!darwin && !linux) || windows`.
  Must sit immediately before the `package` clause with a blank line after,
  and **no space** between `//` and `go:build` — a stray space silently
  turns it into an ordinary comment that constrains nothing.
- Custom tags aren't just for platforms: `//go:build ignore` is the
  idiomatic way to exclude a file that doesn't compile yet or is a scratch
  experiment, without deleting it.
- Cross-compiling is just `GOOS=<os> GOARCH=<arch> go build` — no target
  toolchain or VM required, because Go emits native code directly and (with
  `CGO_ENABLED=0`, the default when cross-compiling) statically links the
  result. `CGO_ENABLED=1` reintroduces a dependency on a C toolchain for the
  target platform, so cross-compiling cgo-using code needs one.

## go generate

- `//go:generate <command>` is inert until someone runs `go generate ./...`
  — it is never invoked implicitly by `go build`, `go test`, or CI unless
  you wire it in yourself.
- Commit the generated output to version control. This lets anyone build
  the repo without installing the generator toolchain (`protoc`, `stringer`,
  etc.), and lets reviewers see what generation actually produced instead
  of trusting a black box.
- Wire `go generate` as an explicit, separate step before `build`/`lint` in
  CI — don't rely on contributors remembering to run it by hand; a stale
  generated file next to a changed schema/enum is a routine, easy-to-miss
  bug.
- Never hand-edit a generated file — fix the input (the `.proto`, the
  `//go:generate` source, the schema) and regenerate.
- If a generator's output isn't byte-for-byte deterministic on identical
  input (embeds a timestamp, e.g.), don't force a regenerate-and-diff step
  into CI for it — that just produces review noise. Note the exception
  instead of fighting the tool.
