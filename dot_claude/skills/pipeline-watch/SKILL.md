---
name: pipeline-watch
description: Use when a PR has been opened and CI/pipeline checks must be monitored before declaring the task complete. Use when asked to "watch the pipeline", "wait for CI", "make sure checks pass", or "don't declare done until CI is green". Apply after every PR is opened.
---

# Pipeline Watch

Opening a PR is not done. Done means CI is green — all required checks pass and the PR is ready for the human to review and merge.

**NEVER merge a PR.** Merging is always the human's decision. Your job ends when you report CI status to the user.

## When to use

Apply immediately after a PR is opened. The task is not complete until all required checks pass or a failure is handled.

## What "done" means

- **Wrong:** PR exists
- **Wrong:** PR is merged
- **Correct:** PR exists AND all required CI checks are green AND CI status has been reported to the user

Pre-PR quality gates (local tests, linting, code review) are not the same as CI pipeline checks. CI may run matrix builds, integration tests, deployment previews, or security scans that never ran locally.

## Steps

After opening the PR:

1. **Derive owner and repo** from `git remote get-url origin` (same convention as other skills)
2. **Get the branch name** — `git branch --show-current`
3. **Wait for the run to register** — `sleep 30`
4. **Poll until terminal** — see Commands below
5. **Handle the result:**
   - All green → proceed to completion (notify)
   - Any failing → see Failure Handling below
   - Timeout (>20 min still pending) → report to user, do not declare done

## Commands

Derive `owner` and `repo` from `git remote get-url origin`. The branch name comes from `git branch --show-current`.

**List runs:**

Use `gitea-mcp_actions_run_read`:

- `method: "list_runs"`
- `owner`, `repo` (required)
- `status` (optional): filter by status

**Poll run status for the current branch:**

Call `gitea-mcp_actions_run_read` with `method: "list_runs"` periodically. Filter the returned runs by `head_branch` matching the current branch, and check the first (most recent) run's `status` field. Poll every 30 seconds until the status is `success`, `failure`, or `cancelled`.

**Get a specific run:**

Use `gitea-mcp_actions_run_read`:

- `method: "get_run"`
- `owner`, `repo`, `run_id` (required)

**List jobs for a run:**

Use `gitea-mcp_actions_run_read`:

- `method: "list_run_jobs"`
- `owner`, `repo`, `run_id` (required)

**Get job log preview:**

Use `gitea-mcp_actions_run_read`:

- `method: "get_job_log_preview"`
- `owner`, `repo`, `job_id` (required)
- `tail_lines` (optional): number of tail lines (default: 200)

**Download job log:**

Use `gitea-mcp_actions_run_read`:

- `method: "download_job_log"`
- `owner`, `repo`, `job_id` (required)
- `output_path` (required): path to save the log file

**Re-run a failed workflow:**

Use `gitea-mcp_actions_run_write`:

- `method: "rerun_run"`
- `owner`, `repo`, `run_id` (required)

**Cancel a run:**

Use `gitea-mcp_actions_run_write`:

- `method: "cancel_run"`
- `owner`, `repo`, `run_id` (required)

## Failure Handling

When a check fails:

1. Get the run ID and list jobs using `gitea-mcp_actions_run_read` with `method: "list_run_jobs"`
2. For each failed job, get the log preview or download the full log
3. Classify the failure from the log output:
   - **Formatting/lint** (e.g., prettier, eslint) → delegate fix to the responsible engineer, push, re-watch
   - **Flaky test** (intermittent, unrelated to this change) → re-run via `gitea-mcp_actions_run_write` with `method: "rerun_run"`; if it passes on retry, proceed
   - **Real test failure** → delegate fix to the responsible engineer (Wave 2 again), re-run quality gates, push, re-watch
   - **Infrastructure/env failure** (e.g., missing secret, misconfigured runner) → escalate to user with details; do not block on it
4. After a fix is pushed, re-watch from step 2

## Completion message

Only after checks are green, include in your final user message:

```
PR #<N>: <title>
URL: <url>
CI: ✓ all checks passed
```

If checks are still pending at timeout:

```
PR #<N> is open but CI is still running after 20 minutes.
Pipeline URL: <url>
You may want to monitor it directly.
```

## Rationalizations to reject

- "All quality gates passed before the PR was opened" → Pre-PR and CI are different. CI runs separately. You must check it.
- "The user can monitor the PR themselves" → Your job isn't done until you have reported CI status to the user.
- "CI takes too long, I'll skip it" → Waiting is required. Delegate the watch; don't skip it.
- "I already notified the user about the PR" → Notifying about PR creation ≠ notifying about CI status.
- "CI is green so I should merge it" → **No. Never. Merging is the human's decision, not yours.**
- "The task says 'ship it' or 'get it to main'" → Open the PR and report CI status. Do not merge.

## Red flags — stop and reassess

- Writing "task complete" before seeing CI results
- Treating PR notification as final completion
- Assuming local tests passing = CI passing
- Skipping delegation because "CI probably passes"
- Issuing any merge command (e.g. `gh pr merge`, `git merge`) — this is never permitted
