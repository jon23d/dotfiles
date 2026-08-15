---
name: from-scratch-run
description: Use to verify the application can be cloned and run by a new engineer. Triggers include: adding a new application or service, changing docker-compose or Dockerfiles, changing environment variable handling or configuration, changing networking between services, adding or modifying pnpm scripts, changing database schemas or migrations, or changing README/setup documentation.
---

# From-Scratch Run

A from-scratch run verifies the documented setup actually works. It simulates a new engineer cloning the repo and following the README — nothing more.

## When to trigger

Run from scratch when the PR includes **any** of:

- New application or service added to the monorepo
- `docker-compose.yml` or any `Dockerfile` changed
- `.env.example` or environment variable handling changed
- Networking between services changed (ports, hostnames, service names)
- Root or per-app pnpm scripts added or modified
- Database schema or migration files changed
- `README.md` or setup documentation changed

Skip if none of the above apply.

## What you do (and don't do)

You **instruct a subagent** to perform the run. You do not run it yourself.

This dispatch is the orchestrator's job. If you're already running as a
delegated subagent, don't dispatch a nested subagent — per the `delegation`
skill, subagents don't delegate further. Return the need for a from-scratch
run as a finding to whoever delegated to you instead.

You never make code changes. You never modify application source, compose files, Dockerfiles, or scripts — even if you believe you know the fix. The purpose of this run is to surface problems, not solve them.

## How to instruct the subagent

Dispatch a general-purpose subagent, per the `delegation` skill's invocation
contract, with the following instructions, substituting the actual values:

---

**Subagent prompt template:**

```
You are running a from-scratch verification of the <REPO_NAME> monorepo.
Your job is to follow the README exactly and report what happens.
You may NOT make any code changes under any circumstances.

## Setup

1. Clone the repo into a temporary directory:
   git clone <REPO_URL> /tmp/scratch-run-<BRANCH>
   cd /tmp/scratch-run-<BRANCH>

2. Check out the target branch:
   git checkout <BRANCH>

3. Copy .env.example to .env:
   cp .env.example .env

4. If any ports in the .env or docker-compose.yml conflict with services
   already running on this machine, update the port values in .env only
   (not in docker-compose.yml or source files) using a +1000 offset.
   Document every port change you make.

## Run

Follow the README quickstart exactly, step by step. Run each command and
capture its full output.

If the README instructs you to run docker compose, add --build to ensure
images are rebuilt from the checked-out source.

If the README instructs you to create Docker services that don't exist yet
(e.g., for a new service introduced in this branch), that is expected and
allowed — create them.

## Report back

Return a structured report:

### Environment
- Repo: <REPO_URL>
- Branch: <BRANCH>
- Clone path: /tmp/scratch-run-<BRANCH>
- Port offsets applied (if any): list each

### Step-by-step results
For each README step: the command run, pass/fail, and full output on failure.

### Final status
PASS — all services started and the application is reachable, or
FAIL — one or more steps failed

### Failures (if any)
For each failure:
- Step: exact step from the README
- Command: the exact command run
- Error output: full verbatim output
- Diagnosis: what this error means in plain English
- Likely cause: documentation gap, missing env var, broken compose config, etc.
- NOT your job to fix: state this explicitly and stop

## Cleanup
When done: docker compose down -v && rm -rf /tmp/scratch-run-<BRANCH>
```

---

## What you do with the report

**On PASS:** Note it in your output to `build`. No further action needed.

**On FAIL:** Do not fix the problem yourself. Do not edit any file to work around the failure. Report it directly to `build` with:

- Each failed step
- The full verbatim error output from the subagent
- The subagent's plain-English diagnosis
- A statement that this is a blocker requiring author attention before merge

The build agent is responsible for routing failures to the correct engineer.

## Common mistakes

- **Running inside the feature branch checkout** — always clone to a fresh `/tmp` path for from-scratch runs. The current checkout is not a clean environment.
- **Editing files to make the run pass** — forbidden. Even obvious fixes. Report the failure.
- **Skipping the run because "it's just a doc change"** — README changes are a trigger. A doc change can break the flow.
- **Ignoring port conflicts silently** — document every port offset applied. The subagent must list them in its report.
