# Confluence Conventions

## Space structure

Each repo's Confluence space has (at minimum) a `spikes` parent page at the space root, with five child pages representing lifecycle state:

```
<Space Root>
└── spikes
    ├── Open
    ├── Needs Decision
    ├── In Progress
    ├── Complete
    └── Rejected
```

Check whether these five status pages already exist before creating them — create once per space, not once per spike. New spike docs are created as children of `Open`. Moving a page between these parents is a **human** action (see SKILL.md) — agents create and populate, humans reclassify.

## Linking a spike page to its ticket

Do both directions:

- **Confluence → Jira:** insert a Jira link/macro on the page referencing the ticket key (see macro snippet below, or a simple issue-link macro if you just want a single-issue chip rather than a query).
- **Jira → Confluence:** add the page URL to the ticket via whatever link mechanism your MCP tool exposes (remote link, web link field, or a comment if that's the only option available).

## Auto-updating "resulting tickets" list

When a spike is accepted and yields implementation tickets grouped under an epic/feature, embed a JQL-backed Jira Issues macro on the spike page instead of a hand-typed list. Because the macro re-runs its query on every page view, tickets added to the epic later appear automatically — nothing to edit.

Confluence storage-format (XHTML) snippet, for use when creating/updating the page body via API:

```xml
<ac:structured-macro ac:name="jira" ac:schema-version="1">
  <ac:parameter ac:name="jqlQuery">project = ABC AND "Epic Link" = ABC-123 ORDER BY status</ac:parameter>
  <ac:parameter ac:name="columns">key,summary,status,assignee</ac:parameter>
</ac:structured-macro>
```

Notes:
- `ac:name` may be `jira` or `jira-legacy-metadata`-adjacent depending on Confluence Cloud vs Data Center; this should already be resolved and, ideally, noted in `.project-management.yml` the first time you work in a given space. If it isn't yet, confirm via MCP tool introspection once and record it, rather than re-guessing per spike.
- Which grouping mechanism to use — classic epic link, next-gen parent link, or a shared label — comes from `jira.epic_link_mode` in `.project-management.yml`, not a per-spike decision:
  - `epic_link` → `"Epic Link" = ABC-123`
  - `parent` → `"Parent" = ABC-123`
  - `label` → `labels = <grouping_label_prefix><spike-ticket-key>` (e.g. `labels = spike-ABC-123`), applied to the epic and every child ticket at creation time
  - If `.project-management.yml` doesn't have `jira.epic_link_mode` set yet, this is a Step-0 resolution: introspect which mechanism the project actually uses, then write it into the config so this decision isn't repeated on the next spike.
- Always apply whichever grouping mechanism the config specifies at ticket-creation time — don't create the tickets first and the macro's query second without making sure they'll actually match.
- If your MCP server can't write raw storage-format XHTML (some expose a simplified content API instead), fall back to whatever macro-insertion capability it does expose, or note in the doc that the list needs manual upkeep until that's available — don't silently omit the link.

## Page metadata

Set the Confluence page's Jira-ticket reference as actual linked content (macro or link), not just plain text — plain text doesn't survive ticket renames/moves and isn't clickable.
