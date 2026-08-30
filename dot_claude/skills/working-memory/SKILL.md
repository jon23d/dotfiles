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
  dependency (Square, Postgres, pg-boss), or work across a service
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

## The storage layer: two projects, on purpose

The `basic-memory` server holds exactly two projects. This is deliberate, not
the "silently holds more than one" failure mode this skill used to warn about —
each project has one fixed, non-overlapping job:

- **`vault`** — the one real content project. Every `repo/`, `dep/`, `edge/`,
  and `global/` note lives here. **Always pass `project=vault` explicitly on
  every read and write against this skill's taxonomy.** Never omit `project`
  and trust the default.
- **`memory-configuration`** — the *default* project (what you land in if you
  ever forget to pass `project=`). It deliberately holds no domain
  knowledge — only two notes: a `Start Here` guard note, and the
  **`Canonical Names` registry** (see below). Landing here by accident is a
  loud, obvious signal you omitted `project=vault` — not a silent partial view
  of the real store.

If a tool result ever looks emptier than expected, the first thing to check is
whether you actually passed `project=vault` — not whether the fact was never
written.

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
- **Always pass `project=vault` on every `search_notes`/`read_note` call.**
  Do not omit it and trust default resolution — the default project
  (`memory-configuration`) intentionally holds no domain content, so an
  unscoped call will look empty or irrelevant rather than returning a partial
  view. This is a safety property, not a bug to work around by guessing.
- Read scope = the **union** of `{ repo/<this-repo>, dep/<each declared dep>,
  edge/<each declared edge>, everything listed in this repo's `always_load`
  (typically just `global/infra`) }`. This set comes from
  `memory.manifest.yaml` — **do not** reason about which cross-cutting scopes
  to load; the manifest declares them.
- Use `search_notes` scoped to `project=vault`, filtered to that union. From a
  hit, follow relations with `build_context` on the `memory://` links to pull
  the connected dependency/edge notes.
- **Treat every result as a lead, not a fact.** Verify against the current code
  before you rely on it, especially if the entry's `@sha` anchor predates recent
  changes.

---

## WRITE protocol

### Which project to write into
Every write against this skill's taxonomy goes to `project=vault`, always
passed explicitly, never inferred. `memory-configuration` is not yours to
write to except when explicitly asked to maintain the `Canonical Names`
registry (see below) — never write ticket-scoped facts there.

### Before minting a new `repo/`, `dep/`, or `edge/` name
Read `Canonical Names` in `project=memory-configuration` **first**, in
addition to `search_notes`. Semantic search misses synonyms
(`postgres`/`pgsql`/`psql`/`db` don't share tokens) — the registry is a flat
list precisely so that lookup doesn't depend on search matching. If a
plausible synonym is already listed, reuse it — never create a variant.

When you do mint a genuinely new canonical name, append one row to
`Canonical Names` in the same session (`edit_note`, `project=memory-configuration`).
This is a small, mechanical, low-risk edit — do it every time, don't defer it.

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
   (square, postgres, pg-boss, s3, litellm, …)
2. **About the seam between two services?** → `edge/<a>--<b>`. Two shapes
   share this namespace and must stay disambiguated:
   - **Cross-repo edge** — both sides are independently-registered `repo/`
     or `dep/` names, already globally unique by construction. Name as
     `edge/<repo-a>--<repo-b>` (e.g. `edge/chatty--dotfiles`).
   - **Intra-monorepo seam** — both sides are packages inside ONE monorepo,
     not independently registered names (e.g. `portal`, `api`, `pricing`
     inside one product's monorepo). These generic package names are NOT
     guaranteed unique across different repos — another monorepo could
     easily have its own `api` package. Qualify BOTH sides with their
     owning repo, joined by `.`: `edge/<repo>.<sub-a>--<repo>.<sub-b>`
     (e.g. `edge/abcinnkeeper.portal--abcinnkeeper.api`). This makes
     collision structurally impossible since `<repo>` is already
     registry-unique.

   Either way, every participant must already be an existing `repo/`/`dep/`
   name from `Canonical Names` — never an invented label. If a participant
   doesn't have a canonical name yet, mint one there first (per the WRITE
   protocol above), then write the edge.
3. **A repo-local implementation detail?** → `repo/<repo-name>`.
4. **An org-wide infra invariant?** → `global/infra` — **rare; keep thin.**

**No domain hard boundary.** Every repo's facts live in the flat structure
above — there is no mandatory grouping tier, and nothing gates what an agent
can read by product/client/team. If a repo's `memory.manifest.yaml` declares
an optional `group: <name>` tag, treat it as filtering/reporting metadata
only — it never creates a folder (`group/<name>` is not a scope) and it never
restricts a read.

**Naming discipline — this is where taxonomies rot:**
- Entity, dependency, and edge names come from `memory.manifest.yaml`'s
  `dependencies`/`edges` lists **and** the `Canonical Names` registry in
  `memory-configuration`. **Do not invent variants.** Check the registry
  before creating one; if `dep/postgres` exists, do not create
  `dep/pgsql` or `dep/psql`.
- One **canonical** note per dependency and per edge. Repos *backlink* to it
  via relations — never fork a per-repo copy of a shared fact.

---

## Bootstrapping a new repo (no `memory.manifest.yaml` yet)

No manifest at the repo root means this repo was never onboarded to shared
memory — the READ protocol has no declared scope to read from, and writes
have nowhere correct to land. Create one before doing anything else, using
`Memory.manifest.example` (next to this skill file) as the literal template —
copy its shape and keep its comments; they're what keeps the *next* agent
from re-deriving all of this from scratch.

1. **`repo`** — `repo/<repo-name>`, from the repo's own name. Check
   `Canonical Names` (`project=memory-configuration`) first in case this repo
   already has a canonical name recorded under something slightly different.
2. **`group`** *(optional)* — only if this repo is one of several related
   repos under one product/client umbrella and you actually expect to filter
   by that grouping later. Skip it otherwise; it's metadata, not structure.
3. **`dependencies`** — list only the *shared* external dependencies this repo
   actually touches (a database, a third-party API, a queue — the kind of
   thing worth a canonical `dep/<name>` note per the scope-routing rules
   above), not every library it imports. For each candidate, check
   `Canonical Names` **and** `search_notes` (`project=vault`) for an existing
   `dep/<name>` note **before** writing the manifest entry — reuse the name
   that already exists rather than inventing a variant (`postgres`, never
   `postgres-db` or `pg`). Also check whether another repo's manifest, or an
   existing `edge/` note, already refers to this dependency under a name you
   weren't expecting, and match it.
4. **`edges`** — for each other service this repo directly calls or is called
   by, add `edge/<a>--<b>` with the two names alphabetical (`edge/portal--api`,
   never `edge/api--portal`), matching whatever the other side's manifest
   already declares if one exists. Both names must already be canonical
   `repo/` or `dep/` names — mint them first if they aren't.
5. **`always_load`** — default to `global/infra` unless there's a specific
   reason to add more; keep this tier thin, same as the naming-discipline rule
   above. Repo-local cross-cutting facts (e.g. invariants shared by several
   apps inside one monorepo) belong in this repo's own `repo/<name>` scope,
   not in a separate always-loaded tier.
6. Write the file at the repo root, **and** add a row for `repo/<repo-name>`
   (plus any new `dep/`/`edge/` names) to `Canonical Names`
   (`project=memory-configuration`) in the same pass. Treat the first draft as
   **provisional**: flag the `dependencies`/`edges` choices for human review
   rather than treating them as settled — a wrong scope here silently
   misroutes every future read and write for this repo, and nothing else will
   catch it.

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
  (as of abcinnkeeper@a1b2c3d)
- [procedure] Sandbox device pairing codes expire in 5m; regenerate per test run

## Relations
- surfaced_in [[repo/portal]]
- surfaced_in [[repo/owners]]
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
> `dep/postgres` — `- [root-cause] Row-level security policies are silently
> bypassed when the app connects as a superuser role; connection pooling must
> use the non-superuser app role, not the migration role. (as of
> abcinnkeeper@7f3a1c9)`
> with relations `surfaced_in [[repo/api]]`.

Why: root cause not just symptom, correct scope (the dependency), anchored,
actionable.

**Bad — and why:**
> `repo/portal` — "Square was flaky today, added a retry."
- Wrong scope (belongs to `dep/square`), no root cause, no anchor, narration.

> `dep/postgres` — "The connection pool might be slow sometimes?"
- Speculation, unconfirmed. Unstorable.

> Pasting the full `OwnerSignup` type into a note.
- Belongs in shared-types + tests. Store only the delta the types can't express.

---

## Quick reference — tool calls

| Intent | Tool |
|---|---|
| Search vault | `search_notes` with `project=vault` (filter by permalink prefix) |
| Pull connected notes from a hit | `build_context` on `memory://` links |
| Read a full note | `read_note` with `project=vault` |
| Check/update canonical names before minting a new scope | `read_note`/`edit_note` on `Canonical Names`, `project=memory-configuration` |
| Create/replace a canonical note | `write_note` with `project=vault` |
| Refine in place / supersede | `edit_note` with `project=vault` |

Read scope, dependency names, and edges are all declared in
`memory.manifest.yaml` (see the example beside this skill). When in doubt about
where a fact goes, the manifest's dependency list — and the `Canonical Names`
registry — are your menu. Pick from them, don't invent.
