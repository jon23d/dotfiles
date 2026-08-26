---
name: working-memory
description: >-
  Read from and write to the shared engineering memory (the `basic-memory` MCP
  server) that records cross-ticket episodic and procedural knowledge: failures
  and their root causes, non-obvious procedures, decisions with rationale, and
  dependency/seam gotchas. USE THIS ON EVERY TICKET — search it before you plan
  or debug, and stage writes as you discover durable facts. This is NOT for
  product documentation (that lives in Confluence) or repo invariants (AGENTS.md).
  Trigger whenever you start a ticket, hit an unexpected error, touch a shared
  dependency (Square, Couchbase, R2, pg-boss), or work across a service
  seam — even if the ticket doesn't mention memory.
compatibility: >-
  Requires the `basic-memory` MCP server (see the `basic-memory` entry in your
  MCP client config, e.g. `~/.config/opencode/opencode.jsonc`, for connection
  details), and a `memory.manifest.yaml` at the repo root declaring this repo's
  scope and dependencies. Tool names below are Basic Memory's; remap if the
  backend changes.
---

# Working Memory

You share one memory store with every other agent across every project. What you
write, others load into their context. Precision is not politeness here — a
mis-filed or speculative fact silently degrades runs you'll never see.

## The three stores — do not confuse them

- **Confluence** — curated product docs (architecture, data-flow topology, feature
  specs). Human-owned. You *read* it; you *propose* writes for review. Never
  duplicate Confluence content into memory — link to it.
- **The repo** — invariants, conventions, contracts (AGENTS.md, shared types,
  tests). Enforced. Not memory.
- **This memory** — the *surprises*: what broke and why, the workaround, the
  ordering constraint, the decision and its rationale.

Authority order on any conflict: **running code > repo/tests > Confluence > memory.**
Memory is advisory. If memory disagrees with the code, the code is right and the
memory entry is wrong — fix your work, then correct the entry.

---

## READ protocol

No `memory.manifest.yaml` at this repo's root? See **Bootstrapping a new
repo** below before following this protocol — there's no declared scope to
read from yet.

Search before you plan and before you debug. Reading is cheap; re-learning a
painful fact is not.

**Trigger points (search at each):**
1. **Ticket intake** — search the ticket subject, each affected service, and each
   of that service's declared dependencies (from `memory.manifest.yaml`).
2. **Before touching a shared dependency** — load that dependency's note
   (`dep/<name>`).
3. **On any unexpected error or behavior** — search the symptom/error string
   before debugging from scratch. Someone may have paid for this already.
4. **At an integration seam** — load the edge note (`edge/<a>--<b>`) for the two
   services you're wiring together.

**How to search:**
- **Always pass `search_all_projects: true` to every `search_notes` call, and
  never rely on the server's default-project resolution.** The store can
  silently hold more than one project at the storage layer even though there
  is supposed to be exactly one canonical one — an unscoped search or
  `read_note` resolves to a single project via sticky session state, and a
  search that omits this flag can return a partial result set that looks
  complete. Do not assume the store currently holds only one project; verify
  by checking the `project` field on results, and flag anything unrecognized
  rather than silently ignoring it.
- Read scope = the **union** of `{ project/<this-repo>, dep/<each declared dep>,
  edge/<each declared edge>, <domain>/global, global/infra }`. This set comes
  from `memory.manifest.yaml` — **do not** reason about which cross-cutting
  scopes to load; the manifest declares them. Filter the full-store search
  results down to this scope yourself; do not narrow the search itself by
  project — that reintroduces the same silent-partial-view failure.
- Use `search_notes` scoped to that union. From a hit, follow relations with
  `build_context` on the `memory://` links to pull the connected dependency/edge
  notes.
- **Treat every result as a lead, not a fact.** Verify against the current code
  before you rely on it, especially if the entry's `@sha` anchor predates recent
  changes.

---

## WRITE protocol

### Which project to write into
Never write on default-project resolution — the same sticky-session-state
problem that breaks unscoped search also breaks an unscoped `write_note` or
`edit_note`, except worse: a write has no `search_all_projects`-style escape
hatch, since a note has to land in exactly one place. Before your first write
in a session, call `list_memory_projects()` and confirm which project you're
targeting rather than omitting `project` and trusting the default:
- If there is exactly **one** project, pass its name explicitly on every
  write. Don't rely on it also being the default — defaults drift.
- If there is **more than one** project, stop and flag it rather than
  guessing. More than one project existing at all is itself the failure mode
  this protocol exists to prevent recurring — don't silently pick one.

### Store ONLY these
- **Failure + root cause** — never the failure alone. "X broke" is noise;
  "X broke *because* Y" is memory.
- **Non-obvious procedure** — a workaround, an ordering constraint, a required
  pre-step that isn't discoverable from the code or docs.
- **Decision + rationale** — why X over Y, *when it constrains future work.*
- **Dependency / seam gotcha** — behavior of an external API or another service
  that surprised you and isn't captured by types or tests.

### NEVER store
- Anything already in code, tests, repo docs, or Confluence. Link to it instead.
- **Speculation.** "I think", "might be", "seems like" — if you didn't confirm
  it, it does not go in. Unverified guesses poison more than they help.
- A contract or type that belongs in shared-types + tests. Store only the
  **delta the types can't express** ("returns 200 with empty body on missing
  tenant; field nullable despite the annotation"), anchored to the artifact.
- Task-local trivia, ticket status, narration, or secrets/credentials.
- Data-flow topology as prose. The canonical flow lives in Confluence; memory holds
  only the *surprises* found while traversing it. Do not reconstruct
  architecture out of scattered memories.

### Write timing — commit at your workflow's real checkpoint, not an event you can't see
Stage memory writes as you discover facts. Commit them at the **last point
your own workflow actually validates the work** — that is *usually* not
"on merge."

Orchestrator-style workflows commonly never observe a merge at all: an
orchestrating agent opens a PR and stops there by design, with merge handled
later by a human or a separate process outside any agent's context. Gating
writes on "wait for merge" in a workflow like that is a condition that can
never fire — everything staged is silently lost, every time. Before relying
on this, check what your own agent's contract actually says happens at the
end of a task:

- **If your loop's terminal, observable state is "quality gates passed" (tests,
  lint, review) and opens a PR but never merges or learns of the merge** —
  commit staged memory there, once gates pass. Passing gates is most of what
  "don't write from a broken path" was protecting against; a rare post-merge
  revert becomes a staleness problem for `edit_note`/`#stale` to fix later
  (see **Conflict & staleness** below), not something to prevent upfront.
- **If your loop genuinely does perform or get told about the merge**
  (solo/direct workflows, or a later invocation explicitly told "PR #N
  merged") — commit there instead, same intent as before.

Either way, the part that doesn't change: **discard staged memory if the work
is abandoned or fails review within your own session.** Failed approaches are
the highest-value thing to remember *and* the easiest to pollute with — record
the root cause, not the thrash. The goal is committing at a checkpoint you can
actually observe, not chasing an event your workflow structurally never
surfaces.

---

## Scope routing (how to develop the taxonomy)

File each fact under the **most specific thing it is actually about.** A Square
quirk you hit while working in `portal` is a *Square* fact, not a `portal` fact —
file it under `portal` and the next agent hits the same wall from `owners`.

Ask, in order, and stop at the first yes:

1. **About a shared dependency?** → `dep/<name>`
   (square, couchbase, postgres, pg-boss, r2, litellm, …)
2. **About the seam between two services?** → `edge/<a>--<b>`
   (e.g. `edge/portal--api`)
3. **A project-local implementation detail?** → `project/<repo>`
4. **An org-wide infra invariant?** → `global/infra` — **rare; keep thin.**

**Domain separation (hard boundary):** every scope sits under a domain —
`innkeeper/…` or `harness/…`. Only shared infra/tooling (gitea, r2, doks,
litellm) may live in the cross-domain `global/infra`. A Square gotcha must reach
every Innkeeper service and **never** land in a harness agent's context.

**Naming discipline — this is where taxonomies rot:**
- Entity and dependency names come from `memory.manifest.yaml`. **Do not invent
  variants.** `search_notes` for an existing entity before creating one; if
  `Square Terminal API` exists, do not create `square-api`.
- One **canonical** note per dependency and per edge. Projects *backlink* to it
  via relations — never fork a per-project copy of a shared fact.

---

## Bootstrapping a new repo (no `memory.manifest.yaml` yet)

No manifest at the repo root means this repo was never onboarded to shared
memory — the READ protocol has no declared scope to read from, and writes
have nowhere correct to land. Create one before doing anything else, using
`Memory.manifest.example` (next to this skill file) as the literal template —
copy its shape and keep its comments; they're what keeps the *next* agent
from re-deriving all of this from scratch.

1. **`domain`** — `innkeeper` or `harness`. Determine this from what the repo
   actually *is* (an Innkeeper product service vs. agent/harness tooling),
   not by guessing. If genuinely ambiguous, ask rather than pick.
2. **`project`** — `project/<repo-name>`, from the repo's own name.
3. **`dependencies`** — list only the *shared* external dependencies this repo
   actually touches (a database, a third-party API, a queue — the kind of
   thing worth a canonical `dep/<name>` note per the scope-routing rules
   above), not every library it imports. For each candidate, `search_notes`
   for an existing `dep/<name>` note **before** writing the manifest entry —
   reuse the name that already exists rather than inventing a variant
   (`postgres`, never `postgres-db` or `pg`). Also check whether another
   repo's manifest, or an existing `edge/` note, already refers to this
   dependency under a name you weren't expecting, and match it.
4. **`edges`** — for each other service this repo directly calls or is called
   by, add `edge/<a>--<b>` with the two names alphabetical (`edge/portal--api`,
   never `edge/api--portal`), matching whatever the other side's manifest
   already declares if one exists.
5. **`always_load`** — default to `<domain>/global` and `global/infra` unless
   there's a specific reason to add more; keep this tier thin, same as the
   naming-discipline rule above.
6. Write the file at the repo root. Treat the first draft as **provisional**:
   flag the `domain`/`dependencies`/`edges` choices for human review rather
   than treating them as settled — a wrong scope here silently misroutes
   every future read and write for this repo, and nothing else will catch it.

---

## Write format (Basic Memory semantic structure)

Prefer **editing the canonical note in place** over appending a new one. Search
first; if the fact exists, refine it and re-anchor rather than duplicating.

Each note uses observations and relations:

```markdown
---
title: Square Terminal API
type: dependency
permalink: dep/square
---

# Square Terminal API

## Observations
- [gotcha] Terminal checkout webhook can fire before our API commits the local
  record; poll GET /checkouts/{id} instead of trusting webhook ordering
  #innkeeper (as of innkeeper/api@a1b2c3d)
- [procedure] Sandbox device pairing codes expire in 5m; regenerate per test run
  #innkeeper

## Relations
- surfaced_in [[project/portal]]
- surfaced_in [[project/owners]]
- at_seam [[edge/portal--api]]
```

- **Observation categories:** `[failure]`, `[root-cause]`, `[procedure]`,
  `[decision]`, `[gotcha]`, `[contract-delta]`.
- **Anchor every code-describing fact** with `(as of <repo>@<short-sha>)` or
  `(packages/<pkg>@<ref>)`. The anchor is how staleness becomes *detectable*: if
  the anchor moved, the fact is suspect until re-verified.
- **Set relations** so cross-cutting structure is navigable: `surfaced_in`,
  `at_seam`, `about`, and `supersedes` (when replacing an older entry).

---

## Conflict & staleness

- **Memory vs. code** → code wins. Fix your work, then `edit_note` the entry:
  correct it, add a `supersedes` relation to the old wording, re-anchor to the
  current sha.
- **Memory vs. memory** → prefer the entry with the newer/valid anchor. Flag the
  loser: add `#stale` and a `superseded_by` relation. Do not silently trust
  either; verify against code.
- **You invalidated the other side of a seam** → if your change breaks a fact a
  memory describes from the *other* service's perspective, update or `#stale`-flag
  it before you close. You are the only one who knows it moved.

---

## Examples

**Good:**
> `dep/couchbase` — `- [root-cause] Autonomous Operator marks the pod Ready ~40s
> before the cluster actually accepts writes; readiness probe lies. Gate writes
> on a real query, not pod status #innkeeper (as of innkeeper/api@7f3a1c9)`
> with relations `surfaced_in [[project/api]]`.

Why: root cause not just symptom, correct scope (the dependency), anchored,
actionable.

**Bad — and why:**
> `project/portal` — "Square was flaky today, added a retry."
- Wrong scope (belongs to `dep/square`), no root cause, no anchor, narration.

> `dep/couchbase` — "The operator might be slow sometimes?"
- Speculation, unconfirmed. Unstorable.

> Pasting the full `OwnerSignup` type into a note.
- Belongs in shared-types + tests. Store only the delta the types can't express.

---

## Quick reference — tool calls

| Intent | Tool |
|---|---|
| Search a scope | `search_notes` with `search_all_projects: true` (filter by permalink prefix) |
| Pull connected notes from a hit | `build_context` on `memory://` links |
| Read a full note | `read_note` |
| Create/replace a canonical note | `write_note` |
| Refine in place / supersede | `edit_note` |

Read scope, dependency names, and edges are all declared in
`memory.manifest.yaml` (see the example beside this skill). When in doubt about
where a fact goes, the manifest's dependency list is your menu — pick from it,
don't invent.
