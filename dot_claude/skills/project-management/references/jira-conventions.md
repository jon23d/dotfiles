# Jira Conventions

Applies when `.project-management.yml` sets `tracker.type: jira`. If the repo
is on `tracker.type: openproject` instead, use
`references/openproject-conventions.md` — don't mix the two.

## Config fields (`tracker.jira` in `.project-management.yml`)

- `project_key` — the Jira project key (e.g. `ABC`). Never guess this from the
  repo name; resolve via MCP (list projects) and confirm with the human if
  more than one plausible match exists.
- `fields.agent_vm` — the real field key (e.g. `customfield_10087`) behind the
  human-readable "Agent VM" field. Custom field keys are per-instance; always
  resolve via MCP field-listing, never assume the number.
- `fields.epic_link` — the field key for the classic Epic Link field, when
  `epic_link_mode` is `epic_link`. Omit/null when the project uses next-gen
  parent-links or a label instead.
- `statuses.{todo,in_progress,in_review}` — the literal status names on this
  project's workflow. Don't assume "Todo"/"In Progress"/"In Review" are the
  actual names; resolve via MCP (list statuses/transitions) once and record
  them.
- `epic_link_mode` — which mechanism this project uses to group tickets under
  an epic: `epic_link` (classic Jira, `"Epic Link" = ABC-123`), `parent`
  (next-gen/team-managed projects, `"Parent" = ABC-123`), or `label`
  (`labels = <grouping_label_prefix><spike-ticket-key>`, applied to the epic
  and every child ticket at creation time). Resolve once via introspection —
  don't guess based on what another project in the same Jira instance uses,
  since classic and next-gen projects commonly coexist.
- `grouping_label_prefix` — only used when `epic_link_mode: label`.

## Introspecting fields and statuses

Before writing to a field or transitioning a status for the first time on a
given project, list the project's fields and workflow via MCP rather than
reusing values memorized from a different project — custom field IDs and
status names are not portable across Jira projects even within the same
instance.

## JQL and the epic-grouping macro

See `references/confluence-conventions.md` for the exact JQL snippet used to
embed a project's resulting tickets on a wiki page — it reads
`epic_link_mode` from this same config section to decide which clause to use.

## Assignment and transitions

- Assign via the MCP tool's assignee field (account ID, not display name,
  where the tool distinguishes the two).
- Transition via the resolved transition ID/name from `statuses.*` — never
  hand-type a status string that wasn't confirmed to exist on this project's
  workflow.
