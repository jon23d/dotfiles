---
name: delegation
description: >-
  How to hand work to a subagent: selecting a subagent type, writing the
  invocation, and what must come back. USE THIS WHENEVER YOU DELEGATE. Covers
  the shared-working-tree constraint, the prohibition on nested delegation, and
  the return format callers depend on. Not for deciding what work to delegate
  or how to slice it — that is the caller's judgment.
---

# Delegation

A subagent starts with no memory of this conversation and no view of your
context. Everything it knows, you wrote.

Expertise comes from skills, named in the invocation. There are no specialist
agents to summon.

## Select the type

Your harness exposes general-purpose subagent types. Two properties matter:

- **Can it modify files?** Write-capable for implementation, documentation, and
  memory commits. Read-only for investigation, planning, and review.
- **Nothing else.** Do not select on subject matter. There is no backend type,
  no database type, no reviewer type.

## Invocation contract

Include all seven. If you cannot fill one, the task is not ready to delegate.

1. **Task** — what to accomplish, in specifics.
2. **Required skills to load, by name** — loaded before reading any files.
   Tell the subagent it can load additional skills its work requires. It may
   not load skills for work outside its brief.
3. **Context** — what it needs to read, as paths, shas, or commands. Not pasted
   content.
4. **Branch** — the branch name, plus: confirm with `git branch --show-current`
   before acting.
5. **Definition of done** — the command that must succeed, or the artifact that
   must exist.
6. **Return format** — per the contract below.
7. **Prohibitions** — everything outside the task. Always includes: do not
   delegate further, do not open PRs, do not notify, do not push.

## The shared working tree

Every subagent operates on the same checkout you do. There is no isolation.

- **One writer at a time.** Two concurrent write-capable subagents will overwrite
  each other's edits and interleave each other's commits, with no error
  reported.
- **Read-only subagents may overlap** with each other, never with a writer.
- **A writer commits its own work** before reporting back. A reviewer reads the
  working tree; `git push` ships only commits.

## No nested delegation

Subagents do not delegate. Every invocation forbids it explicitly.

A subagent that needs work outside its brief returns that as a finding.

## Return contract

- **Outcome** — done, blocked, or partial. One word first.
- **Changes** — files touched, one line each. Not a diff.
- **Verification** — the command run and its result.
- **Artifacts** — paths to anything written for another agent to read.
- **Blockers** — what stopped it, and what it tried.

Large output — findings, plans, memory candidates — goes to a file under
`.agent/`. The subagent returns the path and a summary line. Pass the path
onward, not the contents.

## What not to delegate

Anything that changes what gets built — scope, priorities, an accepted tradeoff,
a deferred requirement, a contract another team depends on — is yours, and often
the user's. Anything about how it gets built belongs to a subagent, architecture
and schema design included.

Anything not on that list: if getting it wrong would mean building the wrong thing
rather than building it badly, it is a decision. Ask.

## Failure handling

A subagent reports failure → re-delegate with the full error output. Do not
diagnose it yourself.

Same failure three times → escalate to the user.

A return that violates the contract — no verification, missing artifacts,
narrative instead of structure — gets re-invoked with the contract restated. Do
not fill the gaps yourself.
