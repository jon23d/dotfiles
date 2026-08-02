---
name: pull-requests
description: Use when opening, updating, or listing pull requests. Use when asked to "open a PR", "create a pull request", "submit for review", or "raise a PR". Apply when work on a feature branch is complete and ready for review.
---

# Pull Requests

All pull request operations use the `gitea-mcp` tools. These are tool calls available to every agent — not bash commands.

## Before opening a PR

1. **Run prettier and fix all formatting issues.** Run `npx prettier --check .` (or the project's equivalent). If it fails, run `npx prettier --write .`, commit the changes, and push. Do not open a PR until prettier passes with zero errors.
2. **Confirm the branch is pushed.** Run `git status` and `git push` if needed. A PR against an unpushed branch will fail or be empty.
3. **Confirm there are no merge conflicts.** Run `git fetch origin` then `git merge origin/<base>` (or `git rebase origin/<base>`). Resolve any conflicts before proceeding.
4. **Confirm the branch name and PR title follow the `project-management` skill's branch-naming and PR-title conventions** (both require the ticket ID when a ticket exists — e.g. branch `feature/PROJ-42-add-auth`, PR title `PROJ-42: Add auth`). That skill is the source of truth for the exact convention; don't re-derive or restate it here.

## Resolving merge conflicts

If `git merge` or `git rebase` reports conflicts:

1. Open each conflicted file and resolve manually
2. Stage resolved files with `git add`
3. Continue the rebase (`git rebase --continue`) or commit the merge (`git commit`)
4. Push the resolved branch before opening the PR

Never open a PR on a branch with unresolved conflicts.

## Prerequisites

Derive `owner` and `repo` from `git remote get-url origin`:

```bash
git remote get-url origin
```

Examples:

- `git@gitea.example.com:myorg/myrepo.git` → `owner: "myorg"`, `repo: "myrepo"`
- `https://gitea.example.com/myorg/myrepo.git` → `owner: "myorg"`, `repo: "myrepo"`

Strip trailing `.git` and extract the last two path segments.

Determine the base branch from git:

```bash
git symbolic-ref refs/remotes/origin/HEAD | sed 's|refs/remotes/origin/||'
```

Falls back to `main` if unset.

## Commands

**Create a PR:**

Use `gitea-mcp_pull_request_write`:

- `method: "create"`
- `owner`, `repo`, `title`, `head` (required). `title` must follow the `project-management` skill's PR-title convention (ticket ID prefix when a ticket exists, e.g. `PROJ-42: Add auth`).
- `body` (required — write the PR body to `/tmp/pr-body.md` first, read it, and pass as a string; see PR body template below)
- `base` (required — the target branch, e.g. `"main"`)
- `head` (required — the feature branch name, e.g. `"feature/my-slug"`)
- `draft` (optional): set `true` to create as draft (uses `WIP:` title prefix)
- `labels` (optional): array of label ID numbers
- `assignees` (optional): array of username strings
- `milestone` (optional): milestone ID number

**View a specific PR:**

Use `gitea-mcp_pull_request_read`:

- `method: "get"`
- `owner`, `repo`, `pull_number` (required)

Returns title, body, state, head, base, assignees, and more.

**View PR diff:**

Use `gitea-mcp_pull_request_read`:

- `method: "get_diff"`
- `owner`, `repo`, `pull_number` (required)

**View PR changed files:**

Use `gitea-mcp_pull_request_read`:

- `method: "get_files"`
- `owner`, `repo`, `pull_number` (required)

**View PR reviews:**

Use `gitea-mcp_pull_request_read`:

- `method: "get_reviews"`
- `owner`, `repo`, `pull_number` (required)

**List PRs:**

Use `gitea-mcp_list_pull_requests`:

- `owner`, `repo` (required)
- `state` (optional): `"open"`, `"closed"`, or `"all"` (default: `"all"`)
- `sort` (optional): `"oldest"`, `"recentupdate"`, `"leastupdate"`, `"mostcomment"`, `"leastcomment"`, `"priority"` (default: `"recentupdate"`)

**Update a PR:**

Use `gitea-mcp_pull_request_write`:

- `method: "update"`
- `owner`, `repo`, `pull_number` (required)
- `title` (optional)
- `body` (optional)
- `assignees` (optional): array of username strings
- `state` (optional): `"open"` or `"closed"`
- `milestone` (optional): milestone ID number
- `labels` (optional): array of label ID numbers

**Close / reopen:**

Use `gitea-mcp_pull_request_write`:

- Close: `method: "close"`, `owner`, `repo`, `pull_number`
- Reopen: `method: "reopen"`, `owner`, `repo`, `pull_number`

**Add / remove reviewers:**

Use `gitea-mcp_pull_request_write`:

- `method: "add_reviewers"` — `owner`, `repo`, `pull_number`, `reviewers` (array of username strings)
- `method: "remove_reviewers"` — `owner`, `repo`, `pull_number`, `reviewers` (array of username strings)

**Update branch from base:**

Use `gitea-mcp_pull_request_write`:

- `method: "update_branch"`
- `owner`, `repo`, `pull_number` (required)

**Submit a review:**

Use `gitea-mcp_pull_request_review_write`:

- `method: "create"` — `owner`, `repo`, `pull_number`, `commit_id`, `body` (required), `comments` (optional array of inline comments), `state` (optional: `"APPROVED"`, `"REQUEST_CHANGES"`, `"COMMENT"`, `"PENDING"`)
- `method: "submit"` — `owner`, `repo`, `pull_number`, `review_id`, `state`

## PR body template

Always use this template. Fill every section — do not leave sections empty or omit them.

```markdown
# {PR title — concise imperative phrase}

{Brief summary — 2–4 sentences. What changed and why.}

# Detail

## Changes

<!-- Bullet list of notable changes. Be specific. -->

## How to Test

<!-- Starting from main running locally, numbered steps a reviewer must follow to test this PR.
     If no setup is needed beyond checking out the branch, write exactly:
     "No setup needed — check out the branch and run the app." -->

## Tests added

<!-- List test files added or modified and what they cover. -->

## Quality gate verdicts

<!-- @reviewer verdict. @qa verdict if run. -->

## Errors and complications

<!-- Any blockers hit and how they were resolved. "None" if clean. -->

## Follow-up items

<!-- Anything deferred, known gaps, or suggestions for future work. "None" if clean. -->

## Ticket

{JIRA-TICKET-KEY}
```

## Writing the How to Test section

Before writing this section, scan the diff for signals that require reviewer action:

- **New or changed env vars** — `.env.example`, config files, new `process.env` references
- **Database changes** — new migration files, schema changes, seed data files
- **New dependencies** — `package.json`, `requirements.txt`, `go.mod`, etc. that require an install step
- **New scripts** — entries added to `package.json scripts`, Makefile targets, shell scripts
- **Infrastructure changes** — Docker, Kubernetes, or other config that needs applying
- **External service setup** — new API keys, webhooks, third-party config
- **Feature flags** — any flag references that need enabling in a local config or dashboard
- **Test data / seed files** — scripts the reviewer must run to get usable data in the DB
- **Port or URL changes** — if the service now runs on a different port or a new endpoint is the entry point

Write one numbered step per action. Start from: _reviewer has `main` checked out and running locally._

This section is always required. If none of the above apply, write: "No setup needed — check out the branch and run the app."

Issue tracking lives in Jira, not Gitea, so there is no `Closes #N` auto-close mechanism here. The Jira ticket key is already in the branch name and PR title per the `project-management` skill's convention, and should also be written into the PR body's `## Ticket` section.

## After opening the PR

Use the `project-management` skill to update the linked Jira ticket (e.g. add the PR URL as a comment or link, move status) — do not use `gitea-mcp_issue_write`, which operates on Gitea issues, not Jira tickets.
