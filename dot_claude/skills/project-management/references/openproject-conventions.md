# OpenProject Conventions

Applies when `.project-management.yml` sets `tracker.type: openproject` and/or
`wiki.type: openproject` (in practice these are set together — OpenProject's
tracker and wiki are the same product/project). If the repo is on
`tracker.type: jira` or `wiki.type: confluence` instead, use
`references/jira-conventions.md` / `references/confluence-conventions.md` —
don't mix the two.

## No MCP server — use the REST API v3 directly

OpenProject's native MCP server (Administration → AI → Model Context
Protocol) is an **Enterprise-plan** feature. Don't assume it's available, and
don't wire one up speculatively — this org runs Community edition, so
OpenProject access goes through direct HTTPS calls to its REST API v3
(`{OPENPROJECT_URL}/api/v3/...`), not an MCP tool. In practice that means
`curl` via Bash rather than an MCP tool call — there is no read-only fetch
tool that supports the required `Authorization` header and non-GET verbs, so
this is a Bash operation. This is the one place this skill requires Bash
access for a tracker/wiki action rather than an MCP tool; see the
`project-management` compatibility note and the orchestrator's Bash-access
rule.

- **Base URL:** `OPENPROJECT_URL` env var (no trailing slash).
- **Auth:** `Authorization: Bearer $OPENPROJECT_API_TOKEN` — a normal personal
  API token works fine (verified against this instance); no special scope is
  needed since this isn't going through the MCP gate.
- **Verify connectivity once per session:** `curl -s "$OPENPROJECT_URL/api/v3" -H "Authorization: Bearer $OPENPROJECT_API_TOKEN"` — confirms the token and base URL both work before relying on either.
- Prefer `curl -s` with `-H "Authorization: Bearer $OPENPROJECT_API_TOKEN"`
  and let the shell read the token from the env var — never hardcode the
  token value in a command that gets logged or committed.

## Concepts, mapped from Jira/Confluence

- Jira project → OpenProject **project** (`project_identifier`, the slug in
  the project's URL/API, not its display name — e.g. `fritzed-platform`).
- Jira issue → OpenProject **work package**.
- Jira issue type → OpenProject work package **type** (`GET /api/v3/types`).
  Types are configurable per instance; don't assume the default set — always
  fetch it.
- Jira custom field → OpenProject **custom field**, addressed as
  `customFieldN` in a work package's attributes. There is no general
  `/api/v3/custom_fields` collection endpoint (confirmed 404 on this
  instance) — discover which custom fields exist for a given project+type via
  its work package **schema** instead (see below).
- Jira status/workflow → OpenProject **status** (`GET /api/v3/statuses`),
  also per-instance; don't assume defaults like "New" or "In progress" map to
  what this instance actually uses without checking.
- Confluence page → OpenProject **wiki page**, scoped to the same project as
  the work packages (OpenProject wikis are per-project, not a separate global
  space). See "Wiki API coverage" below — this is the one area where the API
  is thin.
- Jira epic link / JQL → OpenProject **parent/child hierarchy** (native to
  every work package type, set via a work package's `parent` relationship) or
  a filtered work-package query (`GET /api/v3/work_packages?filters=...`).

## Discovering fields, types, and statuses via the API

Do this via API calls, not by memorizing values from a different OpenProject
project — these are commonly customized per project even within the same
instance:

- `GET /api/v3/projects` — list projects, find `identifier` (confirm with the
  human if more than one plausible match).
- `GET /api/v3/types` — list work package types available instance-wide.
- `GET /api/v3/statuses` — list all statuses and their `isClosed` flag.
- `GET /api/v3/work_packages/schemas/{projectId}-{typeId}` — the authoritative
  way to find which custom fields (and their `customFieldN` keys) are enabled
  for a given project + type combination, plus every other attribute's
  writability and allowed values. Do this before writing to any field you
  haven't used on this project before — including the "Agent VM" equivalent
  custom field.

## Config fields

`tracker.openproject` in `.project-management.yml`:
- `project_identifier` — from `GET /api/v3/projects`, not the display name.
- `fields.agent_vm` — the `customFieldN` key backing the "Agent VM"
  equivalent, found via the schema endpoint above. If no such custom field
  exists yet on the project, tell the human rather than silently skipping the
  step — creating/enabling a custom field is an admin action outside this
  skill's scope.
- `statuses.{todo,in_progress,in_review}` — the literal status names (from
  `GET /api/v3/statuses`) this project's workflow actually uses for whichever
  work package type tickets use.
- `hierarchy_mode` — how tickets are grouped under an initiative:
  - `parent` (recommended default — OpenProject's native mechanism: set the
    child work package's `parent` link to the initiative's work package ID;
    no special type required)
  - `epic_type` (mirrors Jira's classic epic link: a dedicated `Epic`-like
    work package type at the top of the hierarchy — set `epic_type_name` to
    match whatever this instance calls it, from `GET /api/v3/types`)
  - `version` (mirrors a Jira "Fix Version" style grouping: an OpenProject
    **version**, `GET /api/v3/projects/{id}/versions`, shared by all child
    work packages — rarely the right choice for spike-driven grouping, prefer
    `parent` unless the team already organizes work this way)
- `epic_type_name` — only used when `hierarchy_mode: epic_type`.

`wiki.openproject`:
- `spikes_root_slug` — the wiki page slug/title that acts as the `spikes`
  parent page for this project, mirroring the Confluence `spikes` structure
  (see below) — subject to the API-coverage caveat immediately below.

## Wiki API coverage is thin — verify before relying on it

Confirmed on this instance: `GET /api/v3/wiki_pages` returns 404, and the API
root (`GET /api/v3`) advertises no `wiki` link at all. Don't assume OpenProject's
REST API v3 exposes full wiki CRUD the way it does work packages — coverage
varies by version and may be partial or absent.

Before doing any wiki work:
1. Check `GET {OPENPROJECT_URL}/api/v3` for a wiki-related `_links` entry on
   this instance/version, and check `{OPENPROJECT_URL}/api/docs` for a wiki
   section, rather than assuming the shape from Jira/Confluence or from a
   different OpenProject version.
2. If the API supports it, use it, and mirror the Confluence spike-hierarchy
   convention (a `spikes` page with `Open`/`Needs Decision`/`In
   Progress`/`Complete`/`Rejected` children).
3. If it doesn't, **say so to the human explicitly** rather than silently
   skipping the wiki step or fabricating an endpoint — offer to record the
   spike research directly in the ticket description/comments instead (a
   degraded but honest fallback), or ask whether they want to create/edit the
   wiki page manually via the OpenProject web UI while the agent handles
   everything else. Never guess at a wiki endpoint shape and call it silently.

## Linking a ticket to its research (whichever medium ends up holding it)

- If wiki pages are usable: reference work packages inline via their ID
  (e.g. `#123`, which OpenProject's rich text usually auto-links), and add
  the wiki page URL back to the work package via a relation/link field if the
  API exposes one, or a comment otherwise (`POST
  /api/v3/work_packages/{id}/activities`).
- If falling back to ticket-only documentation (per the wiki-coverage caveat
  above): keep the research in the ticket description or comments and skip
  the bidirectional-link requirement — there's only one artifact.

## Auto-updating "resulting tickets" list

There is no confirmed OpenProject equivalent of Confluence's JQL-backed Jira
Issues macro. If wiki pages are usable at all on this instance (see above),
prefer linking to a **filtered work-package view URL** (a saved/shareable
query scoped by whichever `hierarchy_mode` the config specifies — parent ID,
epic type, or shared version) over a hand-typed list — the view stays live
even though it isn't literally embedded on the page. Note in the page that
the list is a link-out, not an inline embed, so nobody expects auto-embedding
that the API doesn't support.

## Work package CRUD (confirmed shape)

- Create: `POST /api/v3/projects/{projectId}/work_packages` (or
  `.../work_packages/form` first if you need server-side validation/allowed
  values before committing).
- Update: `PATCH /api/v3/work_packages/{id}` with a `lockVersion` matching the
  current resource (fetch first) — OpenProject uses optimistic locking, so a
  stale `lockVersion` will reject the write; re-fetch and retry rather than
  guessing a version number.
- Assign: set the `assignee` link in the same PATCH, addressed by user `id`
  (`GET /api/v3/users` or `/api/v3/memberships` to resolve a name to an id).
- Comment/activity: `POST /api/v3/work_packages/{id}/activities`.
- Transition status: PATCH the `status` link to the target status's `id`
  from `GET /api/v3/statuses` — never hand-type a status name without
  confirming its id first.
